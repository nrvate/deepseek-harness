/** The `mcpServers` Remote through a real profile Include, Loader, and config editor. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  boot, initProfile, loadProfileDirectory, readProfileManifest, readProfilePatches, type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
import McpStatus, { type McpServerHandle } from '@deepseek-ai/dsh-mcp-status'
import McpPolicyStore from '@deepseek-ai/dsh-mcp-policy'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import type { Agent } from '@deepseek-ai/dsh-agent'
import McpServersController from '../src/index.ts'

/** A stand-in client handle: one tool and fixed usage, a Session's share being one call. */
function handle(serverName: string, defaultActive = true): McpServerHandle {
  return {
    defaultActive,
    tools: () => [{ name: 'echo', publicName: `mcp__${serverName}__echo`, description: 'Echo it', parameters: [] }],
    stats: session => ({ calls: session === undefined ? 4 : 1, errors: 1, inputTokens: 12, outputTokens: 34, totalMs: 50, maxMs: 20, connections: 1, schemaTokens: 9, transport: 'stdio', tools: [] }),
    subscribe: () => () => {},
  }
}

/**
 * Boot a profile whose bundle mounts the controller and, with `store`, the config editor and policy store.
 * @param store - whether the profile mounts the policy store the editor can write.
 * @param overlays - command-line overlays layered over the profile.
 * @param status - whether the status service is mounted.
 */
async function fixture(store = true, overlays: PatchOptions[] = [], status = true) {
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
  writeFileSync(join(dir, 'package.json'), JSON.stringify(readProfileManifest('test', dir)))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, '[]\n')
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
  if (status) await ctx.plugin(McpStatus)
  return { ctx, controller: ctx.mcpServersController, read: () => readFileSync(patchPath, 'utf8') }
}

it('serves one server\'s tools, and nothing for an unknown server or without a status service', async () => {
  const { ctx, controller } = await fixture()
  ctx.mcpStatus.register('web', handle('web'))
  expect(controller.tools('web').tools.map(tool => tool.publicName)).toEqual(['mcp__web__echo'])
  expect(controller.tools('missing')).toEqual({ tools: [] })
  const bare = await fixture(false, [], false)
  expect(bare.controller.tools('web')).toEqual({ tools: [] })
  expect(bare.controller.overview().servers).toEqual([])
})

it('reads every running client\'s usage, adding one Session\'s share when named', async () => {
  const { ctx, controller } = await fixture()
  ctx.mcpStatus.register('web', handle('web'))
  ctx.mcpStatus.register('docs', handle('docs', false))
  const before = Date.now()
  const overview = controller.overview()
  expect(overview.readAt).toBeGreaterThanOrEqual(before)
  const rows = overview.servers.map(server => [server.serverName, server.defaultActive, server.stats.calls, server.sessionStats])
  expect(rows).toEqual([['web', true, 4, undefined], ['docs', false, 4, undefined]])
  expect(controller.overview('session-a').servers.map(server => server.sessionStats?.calls)).toEqual([1, 1])
})

it('reports each server\'s default after the selection service\'s overrides', async () => {
  const { ctx, controller } = await fixture()
  ctx.mcpStatus.register('web', handle('web'))
  const defaultOf = vi.fn((_server: string, _configured: boolean) => false)
  ctx.provide('mcpSelection', { defaultOf } as never)
  expect(controller.overview().servers[0]?.defaultActive).toBe(false)
  expect(defaultOf).toHaveBeenCalledWith('web', true)
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

it('always allows one tool by its model-facing name, keeping the rest of the stored policy', async () => {
  const { ctx, controller, read } = await fixture()
  ctx.mcpStatus.register('files', handle('files'))
  expect(await controller.allowTool('mcp__files__echo')).toEqual({ ok: true, serverName: 'files', tool: 'echo' })
  expect(ctx.mcpPolicy.policyOf('files')).toEqual({ default: 'ask', tools: { echo: 'allow' } })
  expect(read()).toContain('id: mcp-policy')

  await ctx.configEditor.edit(ctx.configEditor.entries().find(entry => entry.options.id === 'mcp-policy')!, () => ({
    servers: { files: { default: 'deny', tools: { other: 'ask' } } },
  }))
  expect(await controller.allowTool('mcp__files__echo')).toMatchObject({ ok: true })
  expect(ctx.mcpPolicy.policyOf('files')).toEqual({ default: 'deny', tools: { other: 'ask', echo: 'allow' } })
})

it('reports a tool no running server offers', async () => {
  const { controller } = await fixture()
  expect(await controller.allowTool('mcp__nobody__echo')).toMatchObject({ ok: false, code: 'unknown-tool' })
})

it('cannot always allow without a policy store in the profile', async () => {
  const { ctx, controller } = await fixture(false)
  ctx.mcpStatus.register('files', handle('files'))
  expect(await controller.allowTool('mcp__files__echo')).toEqual({
    ok: false, code: 'no-policy-store', message: 'This profile does not mount the MCP policy store',
  })
})

it('reports a store write the editor refuses, such as one an overlay owns', async () => {
  const overlay: PatchOptions = { id: 'mcp-policy', config: { servers: { files: { default: 'deny' } } } }
  const { ctx, controller } = await fixture(true, [overlay])
  ctx.mcpStatus.register('files', handle('files'))
  const result = await controller.allowTool('mcp__files__echo')
  expect(result).toMatchObject({ ok: false, code: 'write-failed' })
  expect(ctx.mcpPolicy.policyOf('files')).toEqual({ default: 'deny', tools: {} })
})
