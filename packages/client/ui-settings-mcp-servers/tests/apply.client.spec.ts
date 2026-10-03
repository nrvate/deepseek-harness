/** What the browser half registers, when, and that it all leaves with the fiber. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubConfigForm, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject, NS } from '../src/client/index.ts'
import type { McpServersToastFace } from '../src/client/McpServersToast.tsx'
import type { McpTrayFace } from '../src/client/mcp-tray-controller.ts'
import type { McpAlwaysAllowFace } from '../src/client/McpAlwaysAllow.tsx'
import { en, zh } from '../src/client/locales.ts'

async function bench(rows: unknown[] = []) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const list = vi.fn(() => Promise.resolve({ ok: true, value: rows }))
  const overview = vi.fn(() => Promise.resolve({ ok: true, value: { readAt: 1, servers: [] } }))
  const allowTool = vi.fn((_name: string) => Promise.resolve({ ok: true, value: { changed: true, application: 'applied', target: 'mcp-docs' } }))
  const remote = new TestRemote(ctx, { mcpServers: { list, overview, allowTool } })
  const settings = stubConfigForm()
  const forms = vi.fn(() => settings.scope)
  ctx.provide('configForms', { get: forms })
  ctx.provide('layout', { selectPanel: vi.fn() })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, list, overview, remote, forms, allowTool }
}

/** The Plugins page's item slot and the shell overlay, as their owners declare them. */
function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'plugins.item': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      'conversation.composer.dock': { kind: 'list', scope: 'root' },
      'conversation.input.right': { kind: 'list', scope: 'root' },
      'conversation.approval.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

/** The injected status-item face, as the registry hands it back. */
type TrayFace = Pick<McpTrayFace, 'hooks' | 'load'>

describe('ui-settings-mcp-servers apply', () => {
  it('binds its preference form under its own Loader row id', async () => {
    const { ctx, slots, forms } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(forms).toHaveBeenCalledWith('ui-settings-mcp-servers')
  })

  it('refreshes the status item on Host changes once it has mounted', async () => {
    const { ctx, slots, overview, remote } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const tray = (slots.entries('conversation.composer.dock')[0]?.inject as () => TrayFace)()
    remote.emit('plugin-manager/changed', [{ reason: 'plugin' }])
    await Promise.resolve()
    expect(overview).not.toHaveBeenCalled()
    tray.load('session-1' as SessionId)
    await vi.waitFor(() => { expect(tray.hooks.mcpTray.getSnapshot().loaded).toBe(true) })
    overview.mockClear()
    remote.emit('plugin-manager/changed', [{ reason: 'plugin' }])
    await vi.waitFor(() => { expect(overview).toHaveBeenCalledTimes(1) })
  })

  it('offers "Always allow" in MCP approval prompts through the Host', async () => {
    const { ctx, slots, allowTool } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const [action] = slots.entries('conversation.approval.action')
    expect(action?.options).toMatchObject({ id: 'mcp-always-allow' })
    expect(action?.locale).toBe(NS)
    const face = (action?.inject as () => Pick<McpAlwaysAllowFace, 'allowTool'>)()
    await expect(face.allowTool('mcp__docs__search')).resolves.toBe(true)
    expect(allowTool).toHaveBeenCalledWith('mcp__docs__search')
    allowTool.mockResolvedValueOnce({ ok: true, value: { changed: false, application: 'failed', target: 'x' } })
    await expect(face.allowTool('mcp__docs__search')).resolves.toBe(false)
    allowTool.mockResolvedValueOnce({ ok: false, error: new Error('down') } as never)
    await expect(face.allowTool('mcp__docs__search')).resolves.toBe(false)
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.mcpServers', 'configForms', 'layout'])
  })

  it('has a Chinese entry for every English key', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('registers the page and its toast, titled in the active locale', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const items = slots.entries('plugins.item')
    expect(items).toHaveLength(1)
    expect(items[0]?.options).toMatchObject({ id: 'mcp-servers', order: 50 })
    expect(resolveSlotLabel(items[0]?.options.label)).toBe('MCP 服务器')
    expect(items[0]?.locale).toBe(NS)
    expect(slots.entries('shell.overlay')).toHaveLength(1)
    expect(slots.entries('conversation.composer.dock')).toHaveLength(1)
    expect(slots.entries('conversation.composer.dock')[0]?.options).toMatchObject({ id: 'mcp-status', order: 20 })
    const tray = (slots.entries('conversation.composer.dock')[0]?.inject as () => TrayFace)()
    expect(Object.keys(tray.hooks)).toEqual(['mcpTray'])
    // The composer selector shares the status item's face, and so its server snapshot.
    const selector = slots.entries('conversation.input.right')
    expect(selector).toHaveLength(1)
    expect(selector[0]?.options).toMatchObject({ id: 'mcp-servers', order: 90 })
    expect(selector[0]?.locale).toBe(NS)
    expect((selector[0]?.inject as () => TrayFace)()).toBe(tray)
    const face = (slots.entries('shell.overlay')[0]?.inject as () => McpServersToastFace)()
    expect(Object.keys(face).sort()).toEqual(['dismissNotice', 'hooks'])
    expect(Object.keys(face.hooks)).toEqual(['mcpServers'])
  })

  it('re-reads an opened page when the Host reports a plugin change, and ignores one before it opens', async () => {
    const { ctx, slots, list, remote } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const face = (slots.entries('plugins.item')[0]?.inject as () => { load: () => void; hooks: { mcpServers: { getSnapshot(): { status: string } } } })()

    remote.emit('plugin-manager/changed', [{ reason: 'plugin' }])
    await Promise.resolve()
    expect(list).not.toHaveBeenCalled()

    face.load()
    await vi.waitFor(() => { expect(face.hooks.mcpServers.getSnapshot().status).toBe('ready') })
    list.mockClear()
    remote.emit('plugin-manager/changed', [{ reason: 'plugin' }])
    await vi.waitFor(() => { expect(list).toHaveBeenCalledTimes(1) })
    ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
  })

  it('collapses the page and the toast on teardown', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('plugins.item')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('plugins.item')).toHaveLength(0)
    expect(slots.entries('shell.overlay')).toHaveLength(0)
    expect(slots.entries('conversation.composer.dock')).toHaveLength(0)
    expect(slots.entries('conversation.input.right')).toHaveLength(0)
    expect(slots.entries('conversation.approval.action')).toHaveLength(0)
  })

  it('registers nothing while the Host does not serve the Remote', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    new TestRemote(ctx)
    const slots = ctx.get('slots') as SlotRegistry
    declareRoot(slots)
    void ctx.plugin({ inject: [...inject], apply })
    await Promise.resolve()
    expect(slots.entries('plugins.item')).toHaveLength(0)
  })
})
