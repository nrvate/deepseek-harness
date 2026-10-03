/** MCP server management through a real profile Include, Loader, and hot reload. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Hmr from '@deepseek-ai/dsh-hmr'
import {
  boot, initProfile, loadProfileDirectory, readProfileManifest, readProfilePatches, type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
import McpStatus, { type McpServerStatus } from '@deepseek-ai/dsh-mcp-status'
import McpPolicyStore from '@deepseek-ai/dsh-mcp-policy'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import type { Agent } from '@deepseek-ai/dsh-agent'
import McpServersController from '../src/index.ts'
import type { McpEntryId, McpHttpSpec, McpStdioSpec } from '../src/types.ts'

const reconcile = vi.hoisted(() => ({ failNext: false }))
vi.mock('@deepseek-ai/dsh-app-boot', async (importOriginal) => {
  const original = await importOriginal<typeof import('@deepseek-ai/dsh-app-boot')>()
  return {
    ...original,
    reconcileProfilePatches: (...args: Parameters<typeof original.reconcileProfilePatches>) => {
      if (reconcile.failNext) {
        reconcile.failNext = false
        return Promise.reject(new Error('reload rejected the change'))
      }
      return original.reconcileProfilePatches(...args)
    },
  }
})

/** Specs the stub client loads with. */
const unreachable: McpHttpSpec = { transport: 'streamable-http', serverName: 'web', url: 'http://127.0.0.1:9/mcp', headers: {} }
const stdio: McpStdioSpec = { transport: 'stdio', serverName: 'files', command: 'mcp-files-test-missing', args: ['--root', '/tmp'], env: {} }

/** What the stub client publishes for one server; tests drive it to simulate the real client's state changes. */
interface StubHandle {
  current: McpServerStatus
  reconnects: number
  reconnectResult: boolean
  set(next: Partial<McpServerStatus>): void
}

/** The stub clients that loaded, by server name. */
function stubs(): Map<string, StubHandle> {
  const registry: unknown = Reflect.get(globalThis, '__mcpStubs')
  return registry as Map<string, StubHandle>
}

async function fixture(reload: 'live' | 'startup' = 'live', patch = '[]\n', overlays: PatchOptions[] = [], status = true, store = false) {
  Reflect.set(globalThis, '__mcpStubs', new Map())
  const temporaryHome = mkdtempSync(join(tmpdir(), 'mcp-controller-'))
  let owner: Context | undefined
  onTestFinished(async () => { await owner?.fiber.dispose(); rmSync(temporaryHome, { recursive: true, force: true }) })
  const home = await realpath(temporaryHome)
  const dir = join(home, 'profiles', 'test')
  const anchor = join(home, 'package.json')
  writeFileSync(anchor, '{"name":"installation","dependencies":{}}\n')
  initProfile(dir, ['core'])
  const core = join(dir, 'node_modules', 'core')
  mkdirSync(core, { recursive: true })
  writeFileSync(join(core, 'package.json'), JSON.stringify({ name: 'core', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(core, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'controller', name: 'cordis:mcpServersController' },
    ...store ? [{ id: 'config-editor', name: 'cordis:configEditor' }, { id: 'mcp-policy', name: 'cordis:mcpPolicy' }] : [],
  ] }]))
  // The configured plugin is an external service here: it records the config it loads with instead of connecting.
  const client = join(dir, 'node_modules', '@deepseek-ai', 'dsh-mcp-client')
  mkdirSync(client, { recursive: true })
  writeFileSync(join(client, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-mcp-client', version: '1.0.0', type: 'module', main: 'index.mjs' }))
  writeFileSync(join(client, 'index.mjs'), [
    'export const name = "mcp-client"',
    'export function apply(ctx, config) {',
    '  ctx.provide(`mcpProbe_${config.serverName}`, config)',
    '  const listeners = new Set()',
    '  const handle = {',
    "    current: { serverName: config.serverName, state: 'connected', attempt: 0, maxAttempts: 10, toolCount: 1 },",
    '    reconnects: 0,',
    '    reconnectResult: true,',
    '    set(next) { handle.current = { ...handle.current, ...next }; for (const listener of listeners) listener() },',
    '  }',
    '  globalThis.__mcpStubs.set(config.serverName, handle)',
    '  ctx.inject([\'mcpStatus\'], (inner) => {',
    '    inner.mcpStatus.register(config.serverName, {',
    '      status: () => handle.current,',
    "      tools: () => [{ name: 'echo', publicName: `mcp__${config.serverName}__echo`, description: 'Echo it', parameters: [] }],",
    '      reconnect: async () => { handle.reconnects += 1; return handle.reconnectResult },',
    "      stats: session => ({ calls: session === undefined ? 4 : 1, errors: 1, inputTokens: 12, outputTokens: 34, totalMs: 50, maxMs: 20, connections: 1, schemaTokens: 9, transport: 'stdio', tools: [] }),",
    '      defaultActive: config.defaultActive !== false,',
    '      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },',
    '    })',
    '  })',
    '}',
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify(readProfileManifest('test', dir)))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, patch)
  const profile: ProfileContext = {
    name: 'test',
    startedBundles: loadProfileDirectory('test', dir, anchor).layers.map(layer => layer.packageName),
    dir, patchPath, installAnchor: anchor, cwd: home, home, overlays, telemetryDisabledEnv: undefined,
  }
  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (root) => {
    owner = root
    root.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    root.provide('profileContext', profile)
    root.loader.builtins.mcpServersController = McpServersController
    root.loader.builtins.configEditor = ConfigEditor
    root.loader.builtins.mcpPolicy = McpPolicyStore
  })
  if (reload === 'live') {
    await ctx.plugin(Timer)
    await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    await ctx.hmr.runExclusive(async () => {})
  }
  if (status) await ctx.plugin(McpStatus)
  const changes: unknown[] = []
  ctx.on('plugin-manager/changed', (change) => { changes.push(change) })
  return { ctx, controller: ctx.mcpServersController, patchPath, read: () => readFileSync(patchPath, 'utf8'), changes }
}

const id = (value: string): McpEntryId => value as McpEntryId

/** The config the stub client loaded one server with. */
function probe(ctx: Context, serverName: string): unknown {
  const config: unknown = Reflect.get(ctx, `mcpProbe_${serverName}`)
  return config
}

it('asks the person to confirm a stdio command before writing anything', async () => {
  const { controller, read } = await fixture()
  const before = read()
  const refused = await controller.upsert(stdio)
  expect(refused).toMatchObject({
    changed: false, application: 'failed',
    error: { code: 'confirmation-required', command: 'mcp-files-test-missing --root /tmp' },
  })
  expect(read()).toBe(before)
  expect(await controller.upsert(stdio, { confirmedCommand: 'something else' })).toMatchObject({ error: { code: 'confirmation-required' } })
  expect(read()).toBe(before)
})

it('adds a server, loads it live, and lists it', async () => {
  const { ctx, controller, read, changes } = await fixture()
  const result = await controller.upsert(unreachable)
  expect(result).toMatchObject({ changed: true, application: 'applied', target: 'mcp-web' })
  expect(result.error).toBeUndefined()
  expect(read()).toContain('serverName: web')
  expect(probe(ctx, 'web')).toMatchObject({ transport: 'streamable-http', url: 'http://127.0.0.1:9/mcp' })
  expect(changes).toEqual([{ reason: 'plugin' }])
  const [row] = await controller.list()
  expect(row).toMatchObject({
    id: 'mcp-web', serverName: 'web', transport: 'streamable-http', summary: 'http://127.0.0.1:9/mcp',
    enabled: true, fiberPhase: 'active', owned: true,
  })
  expect(row?.spec).toMatchObject({ url: 'http://127.0.0.1:9/mcp' })
})

it('adds a confirmed stdio server', async () => {
  const { controller, read } = await fixture()
  const result = await controller.upsert(stdio, { confirmedCommand: 'mcp-files-test-missing --root /tmp' })
  expect(result).toMatchObject({ changed: true, application: 'applied' })
  expect(read()).toContain('command: mcp-files-test-missing')
  expect((await controller.list())[0]).toMatchObject({ summary: 'mcp-files-test-missing --root /tmp', transport: 'stdio' })
})

it('rejects a duplicate server name and a taken row id without touching the file', async () => {
  const taken = {
    insert: [{ id: 'mcp-web2', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'other', transport: 'streamable-http', url: 'http://127.0.0.1:9/t' } }],
  } as PatchOptions
  const { controller, read } = await fixture('live', '[]\n', [taken])
  await controller.upsert(unreachable)
  const before = read()
  expect(await controller.upsert({ ...unreachable, url: 'http://127.0.0.1:9/other' }))
    .toMatchObject({ application: 'failed', error: { code: 'duplicate-server' } })
  const reused = await controller.upsert({ ...unreachable, serverName: 'web2' })
  expect(reused).toMatchObject({ application: 'failed', changed: false, error: { code: 'duplicate-server' } })
  expect(reused.error?.message).toContain('mcp-web2')
  expect(read()).toBe(before)
})

it('renames a server by editing its row', async () => {
  const { controller } = await fixture()
  await controller.upsert(unreachable)
  expect(await controller.upsert({ ...unreachable, serverName: 'web2' }, { id: id('mcp-web') })).toMatchObject({ changed: true })
  expect((await controller.list()).map(row => [row.id, row.serverName])).toEqual([['mcp-web', 'web2']])
})

it('rejects invalid configuration before writing', async () => {
  const { controller, read } = await fixture()
  const before = read()
  expect(await controller.upsert({ ...unreachable, url: 'ftp://127.0.0.1/mcp' })).toMatchObject({ error: { code: 'invalid-config' } })
  expect(await controller.upsert({ ...unreachable, serverName: 'bad name!' })).toMatchObject({ error: { code: 'invalid-config' } })
  expect(await controller.upsert({ ...unreachable, headers: { Authorization: { kind: 'literal', value: 'Bearer x' } } }))
    .toMatchObject({ error: { code: 'literal-secret' } })
  expect(read()).toBe(before)
})

it('edits a row in place, keeping keys the form does not manage', async () => {
  const patch = [
    '- insert:',
    '    - id: mcp-web',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: web',
    '        transport: streamable-http',
    '        url: http://127.0.0.1:9/mcp',
    '        reconnect:',
    '          maxAttempts: 2',
    '',
  ].join('\n')
  const { ctx, controller, read } = await fixture('live', patch)
  const result = await controller.upsert({ ...unreachable, url: 'http://127.0.0.1:9/changed' }, { id: id('mcp-web') })
  expect(result).toMatchObject({ changed: true, application: 'applied' })
  expect(read()).toContain('url: http://127.0.0.1:9/changed')
  expect(read()).toContain('maxAttempts: 2')
  expect(probe(ctx, 'web')).toMatchObject({ url: 'http://127.0.0.1:9/changed', reconnect: { maxAttempts: 2 } })
})

it('disables and re-enables a row, and removes it', async () => {
  const { controller, read } = await fixture()
  await controller.upsert(unreachable)
  expect(await controller.setEnabled(id('mcp-web'), false)).toMatchObject({ changed: true, application: 'applied' })
  expect((await controller.list())[0]).toMatchObject({ enabled: false, fiberPhase: null })
  expect(await controller.setEnabled(id('mcp-web'), false)).toMatchObject({ changed: false })
  expect(await controller.setEnabled(id('mcp-web'), true)).toMatchObject({ changed: true })
  expect((await controller.list())[0]).toMatchObject({ enabled: true, fiberPhase: 'active' })
  expect(await controller.removeServer(id('mcp-web'))).toMatchObject({ changed: true, application: 'applied' })
  expect(await controller.list()).toEqual([])
  expect(read()).not.toContain('mcp-web')
})

it('reports an unknown row', async () => {
  const { controller } = await fixture()
  expect(await controller.removeServer(id('missing'))).toMatchObject({ application: 'failed', error: { code: 'unknown-server' } })
  expect(await controller.setEnabled(id('missing'), true)).toMatchObject({ error: { code: 'unknown-server' } })
  expect(await controller.upsert(unreachable, { id: id('missing') })).toMatchObject({ error: { code: 'unknown-server' } })
})

it('lists rows from an overlay as read-only and refuses to change them', async () => {
  const overlay: PatchOptions = {
    insert: [{ id: 'overlay-mcp', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'overlay', transport: 'streamable-http', url: 'http://127.0.0.1:9/o' } }],
  }
  const { controller, read } = await fixture('live', '[]\n', [overlay])
  const before = read()
  expect(await controller.list()).toEqual([expect.objectContaining({
    id: 'overlay-mcp', serverName: 'overlay', owned: false, readOnlyReason: 'unaddressable',
  })])
  expect(await controller.removeServer(id('overlay-mcp'))).toMatchObject({ error: { code: 'read-only' } })
  expect(await controller.setEnabled(id('overlay-mcp'), false)).toMatchObject({ error: { code: 'read-only' } })
  expect(await controller.upsert({ ...unreachable, serverName: 'overlay2' }, { id: id('overlay-mcp') })).toMatchObject({ error: { code: 'read-only' } })
  expect(await controller.upsert({ ...unreachable, serverName: 'overlay' })).toMatchObject({ error: { code: 'duplicate-server' } })
  expect(read()).toBe(before)
})

it('never returns a literal secret already in the file, and keeps it on edit', async () => {
  const patch = [
    '- insert:',
    '    - id: mcp-files',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: files',
    '        transport: stdio',
    '        command: mcp-files-test-missing',
    '        env:',
    '          API_TOKEN: hunter2-literal',
    '',
  ].join('\n')
  const { controller, read } = await fixture('live', patch)
  const rows = await controller.list()
  expect(JSON.stringify(rows)).not.toContain('hunter2')
  expect(rows[0]?.spec).toMatchObject({ env: { API_TOKEN: { kind: 'kept' } } })
  const spec = rows[0]?.spec as McpStdioSpec
  expect(await controller.upsert({ ...spec, args: ['--x'] }, { id: id('mcp-files'), confirmedCommand: 'mcp-files-test-missing --x' })).toMatchObject({ changed: true })
  expect(read()).toContain('API_TOKEN: hunter2-literal')
})

it('lists a row with embedded URL credentials without exposing them', async () => {
  const patch = '- insert:\n    - id: mcp-x\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: x\n        transport: streamable-http\n        url: http://user:hunter2@127.0.0.1:9/mcp?token=abc\n'
  const { controller } = await fixture('live', patch)
  const rows = await controller.list()
  expect(rows[0]).toMatchObject({ readOnlyReason: 'embedded-credentials', summary: 'http://127.0.0.1:9/mcp', owned: true })
  expect(rows[0]?.spec).toBeUndefined()
  expect(JSON.stringify(rows)).not.toMatch(/hunter2|abc/)
})

it('lists a row whose arguments carry a credential as read-only, with the value masked', async () => {
  const patch = [
    '- insert:', '    - id: mcp-x', '      name: "@deepseek-ai/dsh-mcp-client"', '      config:', '        serverName: x', '        transport: stdio',
    '        command: srv', '        args: ["--api-key", "sk-live-1", "--port=8"]', '',
  ].join('\n')
  const { controller } = await fixture('live', patch)
  const [row] = await controller.list()
  expect(row).toMatchObject({ readOnlyReason: 'embedded-credentials', summary: 'srv --api-key *** --port=8', owned: true })
  expect(row?.spec).toBeUndefined()
  expect(JSON.stringify(row)).not.toContain('sk-live-1')
})

it('lists an owned row with an expression as not editable but removable', async () => {
  const patch = '- insert:\n    - id: mcp-x\n      name: "@deepseek-ai/dsh-mcp-client"\n      disabled: true\n      config:\n        serverName: x\n        transport: stdio\n        command: tool\n        cwd: !!js process.cwd()\n'
  const { controller } = await fixture('live', patch)
  expect((await controller.list())[0]).toMatchObject({ readOnlyReason: 'custom-expression', owned: true, enabled: false })
  expect(await controller.upsert({ ...stdio, serverName: 'x' }, { id: id('mcp-x') })).toMatchObject({ error: { code: 'read-only' } })
  expect(await controller.removeServer(id('mcp-x'))).toMatchObject({ changed: true })
})

it('restores the file when the reload rejects the change', async () => {
  const { controller, read } = await fixture()
  const before = read()
  reconcile.failNext = true
  const result = await controller.upsert(unreachable)
  expect(result).toMatchObject({ changed: false, application: 'failed', error: { code: 'operation-error', message: 'reload rejected the change' } })
  expect(read()).toBe(before)
  expect(await controller.list()).toEqual([])
})

it('reports restart-required when the profile has no hot reload', async () => {
  const { controller, read } = await fixture('startup')
  expect(await controller.upsert(unreachable)).toMatchObject({ changed: true, application: 'restart-required' })
  expect(read()).toContain('serverName: web')
  expect(await controller.list()).toEqual([expect.objectContaining({ id: 'mcp-web', enabled: true, fiberPhase: null, owned: true })])
})

it('rejects an expression the file does not hold', async () => {
  const { controller, read } = await fixture()
  const before = read()
  const forged = { ...stdio, env: { X: { kind: 'expression', source: 'process.exit(1)' } } } as McpStdioSpec
  const result = await controller.upsert(forged, { confirmedCommand: 'mcp-files-test-missing --root /tmp' })
  expect(result).toMatchObject({ changed: false, error: { code: 'invalid-config' } })
  expect(result.error?.message).toContain('expression')
  expect(read()).toBe(before)
})

it('lists rows from nested groups and rows without a config', async () => {
  const nested = {
    insert: [
      { id: 'group', group: true, config: [{ id: 'bare', name: '@deepseek-ai/dsh-mcp-client' }] },
    ],
  } as PatchOptions
  const { controller } = await fixture('live', '[]\n', [nested])
  expect(await controller.list()).toEqual([expect.objectContaining({
    id: 'bare', serverName: '', summary: '', transport: 'stdio', owned: false, readOnlyReason: 'unaddressable',
  })])
})

it('creates the patch file when it does not exist', async () => {
  const { controller, patchPath, read } = await fixture()
  rmSync(patchPath)
  expect(await controller.list()).toEqual([])
  expect(await controller.upsert(unreachable)).toMatchObject({ changed: true })
  expect(read()).toContain('serverName: web')
})

it('reports a patch path that cannot be read', async () => {
  const { controller, patchPath } = await fixture()
  rmSync(patchPath)
  mkdirSync(patchPath)
  expect(await controller.upsert(unreachable)).toMatchObject({ changed: false, application: 'failed', error: { code: 'operation-error' } })
})

it('leaves a malformed patch untouched', async () => {
  const { controller, patchPath, read } = await fixture()
  writeFileSync(patchPath, '{ not: a sequence }\n')
  const result = await controller.upsert(unreachable)
  expect(result).toMatchObject({ changed: false, application: 'failed', error: { code: 'unreadable-patch' } })
  expect(read()).toBe('{ not: a sequence }\n')
})

it('lists each row with the live status its client publishes', async () => {
  const { controller } = await fixture()
  await controller.upsert(unreachable)
  const [row] = await controller.list()
  expect(row?.status).toMatchObject({ serverName: 'web', state: 'connected', toolCount: 1 })
  stubs().get('web')?.set({ state: 'reconnecting', attempt: 2, error: 'refused' })
  expect((await controller.list())[0]?.status).toMatchObject({ state: 'reconnecting', attempt: 2, error: 'refused' })
})

it('lists a row without a status while its plugin is off or no status service is mounted', async () => {
  const off = await fixture()
  await off.controller.upsert(unreachable)
  await off.controller.setEnabled(id('mcp-web'), false)
  expect((await off.controller.list())[0]?.status).toBeUndefined()

  const none = await fixture('live', '[]\n', [], false)
  await none.controller.upsert(unreachable)
  expect((await none.controller.list())[0]?.status).toBeUndefined()
  expect(await none.controller.tools(id('mcp-web'))).toEqual({ tools: [] })
  expect(await none.controller.reconnectServer(id('mcp-web'))).toEqual({ started: false })
})

it('serves one server\'s tools with its state, and nothing for an unknown row', async () => {
  const { controller } = await fixture()
  await controller.upsert(unreachable)
  const result = await controller.tools(id('mcp-web'))
  expect(result.status).toMatchObject({ state: 'connected' })
  expect(result.tools).toEqual([{ name: 'echo', publicName: 'mcp__web__echo', description: 'Echo it', parameters: [] }])
  expect(await controller.tools(id('missing'))).toEqual({ tools: [] })
})

it('asks the client to reconnect and reports whether an attempt started', async () => {
  const { controller } = await fixture()
  await controller.upsert(unreachable)
  expect(await controller.reconnectServer(id('mcp-web'))).toEqual({ started: true })
  expect(stubs().get('web')?.reconnects).toBe(1)
  const handle = stubs().get('web')
  if (handle !== undefined) handle.reconnectResult = false
  expect(await controller.reconnectServer(id('mcp-web'))).toEqual({ started: false })
  expect(await controller.reconnectServer(id('missing'))).toEqual({ started: false })
})

it('announces a burst of status changes once, after the burst', async () => {
  const { controller, changes } = await fixture()
  await controller.upsert(unreachable)
  changes.length = 0
  const handle = stubs().get('web')
  handle?.set({ state: 'reconnecting' })
  handle?.set({ state: 'failed' })
  handle?.set({ state: 'connecting' })
  expect(changes).toEqual([])
  await vi.waitFor(() => { expect(changes).toEqual([{ reason: 'plugin' }]) }, { timeout: 2000 })
  await new Promise(resolve => setTimeout(resolve, 400))
  expect(changes).toHaveLength(1)
})

it('reads every server\'s state and usage together, without usage for a row that has no client', async () => {
  const { controller } = await fixture()
  await controller.upsert(unreachable)
  await controller.upsert({ ...unreachable, serverName: 'second', url: 'http://127.0.0.1:9/second' })
  await controller.setEnabled(id('mcp-second'), false)
  const before = Date.now()
  const overview = await controller.overview()
  expect(overview.readAt).toBeGreaterThanOrEqual(before)
  const [first, second] = overview.servers
  expect(first).toMatchObject({ id: 'mcp-web', serverName: 'web', enabled: true, defaultActive: true })
  expect(first?.status).toMatchObject({ state: 'connected' })
  expect(first?.stats).toMatchObject({ calls: 4, errors: 1, inputTokens: 12 })
  expect(first?.sessionStats).toBeUndefined()
  expect(second).toEqual({ id: 'mcp-second', serverName: 'second', enabled: false, defaultActive: true })
})

it('adds one Session\'s share of the usage when the overview names a Session', async () => {
  const { controller } = await fixture()
  await controller.upsert(unreachable)
  await controller.upsert({ ...unreachable, serverName: 'second', url: 'http://127.0.0.1:9/second' })
  await controller.setEnabled(id('mcp-second'), false)
  const [first, second] = (await controller.overview('session-a')).servers
  expect(first?.stats?.calls).toBe(4)
  expect(first?.sessionStats?.calls).toBe(1)
  expect(second?.sessionStats).toBeUndefined()
})

it('writes whether new Sessions use a server and lists it, for owned and overlay rows', async () => {
  const overlay: PatchOptions = { insert: [
    { id: 'mcp-overlay', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'streamable-http', serverName: 'overlay', url: 'http://127.0.0.1:9/o', defaultActive: false } },
  ] }
  const { ctx, controller, read } = await fixture('live', '[]\n', [overlay])
  await controller.upsert({ ...unreachable, defaultActive: false })
  expect(read()).toContain('defaultActive: false')
  expect(probe(ctx, 'web')).toMatchObject({ defaultActive: false })
  const rows = await controller.list()
  expect(rows.map(row => [row.serverName, row.defaultActive])).toEqual(expect.arrayContaining([['overlay', false], ['web', false]]))
  expect(rows.find(row => row.serverName === 'web')?.spec).toMatchObject({ defaultActive: false })
  expect((await controller.overview()).servers.map(server => server.defaultActive)).toEqual([false, false])

  await controller.upsert({ ...unreachable }, { id: id('mcp-web') })
  expect(read()).not.toContain('defaultActive')
  expect((await controller.list()).find(row => row.serverName === 'web')?.defaultActive).toBe(true)
})

it('selects one Session\'s servers through the selection service, and refuses without one', async () => {
  const { ctx, controller } = await fixture()
  const agent = {} as Agent
  expect(() => controller.setSessionServers(agent, ['web'])).toThrow('This profile does not support choosing MCP servers per session')
  const select = vi.fn((_agent: Agent, servers: readonly string[]) => [...servers].sort())
  ctx.provide('mcpSelection', { select } as never)
  expect(controller.setSessionServers(agent, ['web', 'docs'])).toEqual({ active: ['docs', 'web'] })
  expect(select).toHaveBeenCalledExactlyOnceWith(agent, ['web', 'docs'])
})

it('reads an overview without usage when no status service is mounted', async () => {
  const { controller } = await fixture('live', '[]\n', [], false)
  await controller.upsert(unreachable)
  expect((await controller.overview('session-a')).servers).toEqual([{ id: 'mcp-web', serverName: 'web', enabled: true, defaultActive: true }])
})

it('sets a server\'s tool-call policy without a command confirmation, and lists every row\'s policy', async () => {
  const overlay: PatchOptions = { insert: [
    { id: 'mcp-overlay', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'streamable-http', serverName: 'overlay', url: 'http://127.0.0.1:9/o', toolPolicy: { default: 'deny' } } },
    { id: 'mcp-odd', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'streamable-http', serverName: 'odd', url: 'http://127.0.0.1:9/p', toolPolicy: 'allow' } },
  ] }
  const { ctx, controller, read } = await fixture('live', '[]\n', [overlay])
  await controller.upsert(stdio, { confirmedCommand: 'mcp-files-test-missing --root /tmp' })
  const policies = Object.fromEntries((await controller.list()).map(row => [row.serverName, row.toolPolicy]))
  expect(policies).toEqual({
    overlay: { default: 'deny', tools: {} },
    odd: { default: 'ask', tools: {} },
    files: { default: 'ask', tools: {} },
  })

  const policy = { default: 'allow' as const, tools: { write_file: 'ask' as const } }
  expect(await controller.setToolPolicy(id('mcp-files'), policy)).toMatchObject({ changed: true, application: 'applied' })
  expect(read()).toContain('write_file: ask')
  expect(probe(ctx, 'files')).toMatchObject({ toolPolicy: policy })
  expect((await controller.list()).find(row => row.serverName === 'files')?.toolPolicy).toEqual(policy)

  expect(await controller.setToolPolicy(id('mcp-overlay'), policy)).toMatchObject({ error: { code: 'read-only' } })
})

it('refuses a tool-call policy for an owned row the form cannot edit', async () => {
  const patch = '- insert:\n    - id: mcp-x\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        transport: stdio\n        serverName: x\n        command: !!js "process.execPath"\n'
  const { controller, read } = await fixture('live', patch)
  const before = read()
  expect(await controller.setToolPolicy(id('mcp-x'), { default: 'allow', tools: {} })).toMatchObject({ error: { code: 'read-only' } })
  expect(read()).toBe(before)
})

describe('the policy store', () => {
  async function stored() {
    const made = await fixture('live', '[]\n', [], true, true)
    await made.controller.upsert(stdio, { confirmedCommand: 'mcp-files-test-missing --root /tmp' })
    return made
  }

  it('keeps a server\'s policy in the store, applies it live, and lists it in force', async () => {
    const { ctx, controller, read } = await stored()
    const before = probe(ctx, 'files')
    const policy = { default: 'deny' as const, tools: { echo: 'allow' as const } }
    expect(await controller.setToolPolicy(id('mcp-files'), policy)).toEqual({ changed: true, application: 'applied', target: 'mcp-files' })
    // The client row was not reloaded: it still holds the config it loaded with.
    expect(probe(ctx, 'files')).toBe(before)
    expect(ctx.mcpPolicy.policyOf('files')).toEqual(policy)
    expect(read()).toContain('id: mcp-policy')
    expect(read()).not.toMatch(/toolPolicy:/)
    const row = (await controller.list()).find(candidate => candidate.serverName === 'files')
    expect(row?.toolPolicy).toEqual(policy)
    expect(row?.spec?.toolPolicy).toEqual(policy)
  })

  it('routes the form\'s policy to the store, and drops it when the server is removed', async () => {
    const { ctx, controller, read } = await stored()
    const policy = { default: 'allow' as const, tools: {} }
    expect(await controller.upsert({ ...stdio, toolPolicy: policy }, { id: id('mcp-files'), confirmedCommand: 'mcp-files-test-missing --root /tmp' }))
      .toMatchObject({ application: 'applied' })
    expect(ctx.mcpPolicy.policyOf('files')).toEqual(policy)
    expect(read()).not.toMatch(/toolPolicy:/)
    expect(await controller.removeServer(id('mcp-files'))).toMatchObject({ application: 'applied' })
    expect(ctx.mcpPolicy.policyOf('files')).toBeUndefined()
  })

  it('sets the policy of a row from an overlay, which the store can hold although the row is read-only', async () => {
    const overlay: PatchOptions = { insert: [{ id: 'overlay-mcp', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'overlay', transport: 'streamable-http', url: 'http://127.0.0.1:9/o' } }] }
    const { ctx, controller } = await fixture('live', '[]\n', [overlay], true, true)
    expect(await controller.setToolPolicy(id('overlay-mcp'), { default: 'allow', tools: {} })).toMatchObject({ application: 'applied' })
    expect(ctx.mcpPolicy.policyOf('overlay')).toEqual({ default: 'allow', tools: {} })
    expect(await controller.setToolPolicy(id('missing'), { default: 'allow', tools: {} })).toMatchObject({ error: { code: 'unknown-server' } })
  })

  it('always allows one tool by its model-facing name, keeping the rest of the policy', async () => {
    const { ctx, controller } = await stored()
    await controller.setToolPolicy(id('mcp-files'), { default: 'ask', tools: { other: 'deny' } })
    expect(await controller.allowTool('mcp__files__echo')).toMatchObject({ changed: true, target: 'mcp-files' })
    expect(ctx.mcpPolicy.policyOf('files')).toEqual({ default: 'ask', tools: { other: 'deny', echo: 'allow' } })
    expect(await controller.allowTool('mcp__nobody__echo')).toMatchObject({ error: { code: 'unknown-server' } })
  })

  it('reports a store write the editor refuses', async () => {
    const { controller } = await stored()
    expect(await controller.setToolPolicy(id('mcp-files'), { default: 'sometimes' as never, tools: {} })).toMatchObject({ error: { code: 'operation-error' } })
  })

  it('reports a store the overlay owns: refused writes, and a stale policy left after removal', async () => {
    const overlay: PatchOptions = { id: 'mcp-policy', config: { servers: { files: { default: 'deny' } } } }
    const { ctx, controller } = await fixture('live', '[]\n', [overlay], true, true)
    expect(ctx.mcpPolicy.policyOf('files')).toEqual({ default: 'deny', tools: {} })
    const added = await controller.upsert({ ...stdio, toolPolicy: { default: 'allow', tools: {} } }, { confirmedCommand: 'mcp-files-test-missing --root /tmp' })
    expect(added).toMatchObject({ application: 'failed', error: { code: 'operation-error' } })
    expect(added.error?.message).toContain('overridden by a home patch or command-line overlay')
    const removed = await controller.removeServer(id('mcp-files'))
    expect(removed).toMatchObject({ changed: true, application: 'applied' })
    expect(removed.warnings?.[0]).toContain('overridden by a home patch or command-line overlay')
  })

  it('always allows a tool of a server that no row lists, such as one an integration connects', async () => {
    const { ctx, controller } = await stored()
    ctx.mcpStatus.register('ghost', {
      status: () => ({ serverName: 'ghost', state: 'connected', attempt: 0, maxAttempts: 1, toolCount: 1 }),
      tools: () => [{ name: 'look', publicName: 'mcp__ghost__look', description: '', parameters: [] }],
      reconnect: () => Promise.resolve(false),
      stats: () => ({ calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, totalMs: 0, maxMs: 0, connections: 1, schemaTokens: 0, transport: 'stdio', tools: [] }),
      subscribe: () => () => {},
      defaultActive: true,
    })
    expect(await controller.allowTool('mcp__ghost__look')).toMatchObject({ changed: true, target: 'mcp__ghost__look' })
    expect(ctx.mcpPolicy.policyOf('ghost')).toEqual({ default: 'ask', tools: { look: 'allow' } })
  })

  it('writes the row when a store service runs outside the profile, where the editor cannot reach it', async () => {
    const { ctx, controller, read } = await fixture()
    await ctx.plugin(McpPolicyStore, {})
    await ctx.plugin(ConfigEditor)
    await controller.upsert(stdio, { confirmedCommand: 'mcp-files-test-missing --root /tmp' })
    expect(await controller.setToolPolicy(id('mcp-files'), { default: 'allow', tools: {} })).toMatchObject({ application: 'applied' })
    expect(read()).toContain('toolPolicy:')
  })

  it('cannot always allow without a store, and keeps the row path for policies', async () => {
    const { controller } = await fixture()
    await controller.upsert(unreachable)
    expect(await controller.allowTool('mcp__web__echo')).toMatchObject({ error: { code: 'operation-error', message: 'This profile does not mount the MCP policy store' } })
  })
})
