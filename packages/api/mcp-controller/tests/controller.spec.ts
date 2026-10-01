/** MCP server management through a real profile Include, Loader, and hot reload. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Hmr from '@deepseek-ai/dsh-hmr'
import {
  boot, initProfile, loadProfileDirectory, readProfileManifest, readProfilePatches, type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
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

async function fixture(reload: 'live' | 'startup' = 'live', patch = '[]\n', overlays: PatchOptions[] = []) {
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
  writeFileSync(join(core, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'controller', name: 'cordis:mcpServersController' }] }]))
  // The configured plugin is an external service here: it records the config it loads with instead of connecting.
  const client = join(dir, 'node_modules', '@deepseek-ai', 'dsh-mcp-client')
  mkdirSync(client, { recursive: true })
  writeFileSync(join(client, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-mcp-client', version: '1.0.0', type: 'module', main: 'index.mjs' }))
  writeFileSync(join(client, 'index.mjs'), 'export const name = "mcp-client"\nexport function apply(ctx, config) { ctx.provide(`mcpProbe_${config.serverName}`, config) }\n')
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
  })
  if (reload === 'live') {
    await ctx.plugin(Timer)
    await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    await ctx.hmr.runExclusive(async () => {})
  }
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
  expect(await controller.remove(id('mcp-web'))).toMatchObject({ changed: true, application: 'applied' })
  expect(await controller.list()).toEqual([])
  expect(read()).not.toContain('mcp-web')
})

it('reports an unknown row', async () => {
  const { controller } = await fixture()
  expect(await controller.remove(id('missing'))).toMatchObject({ application: 'failed', error: { code: 'unknown-server' } })
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
  expect(await controller.remove(id('overlay-mcp'))).toMatchObject({ error: { code: 'read-only' } })
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

it('lists an owned row with an expression as not editable but removable', async () => {
  const patch = '- insert:\n    - id: mcp-x\n      name: "@deepseek-ai/dsh-mcp-client"\n      disabled: true\n      config:\n        serverName: x\n        transport: stdio\n        command: tool\n        cwd: !!js process.cwd()\n'
  const { controller } = await fixture('live', patch)
  expect((await controller.list())[0]).toMatchObject({ readOnlyReason: 'custom-expression', owned: true, enabled: false })
  expect(await controller.upsert({ ...stdio, serverName: 'x' }, { id: id('mcp-x') })).toMatchObject({ error: { code: 'read-only' } })
  expect(await controller.remove(id('mcp-x'))).toMatchObject({ changed: true })
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
