/** The status item's state: the preference, reads on mount and on Host changes, and polling only while open. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubConfigForm, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { McpEntryId, McpOverview, McpServerOverview } from '@deepseek-ai/dsh-api-remotes/client'
import { McpTrayController } from '../src/client/mcp-tray-controller.ts'
import type { McpUiSettings } from '../src/mcp-ui-settings.ts'

afterEach(() => { vi.useRealTimers() })

const server: McpServerOverview = { id: 'mcp-a' as McpEntryId, serverName: 'a', enabled: true }
function answer(servers: McpServerOverview[] = [server], readAt = 1000): { ok: true; value: McpOverview } {
  return { ok: true, value: { readAt, servers } }
}
const failure = { ok: false as const, error: new Error('down') }

function bench(preference?: boolean) {
  const ctx = new Context()
  const overview = vi.fn(() => Promise.resolve(answer()))
  new TestRemote(ctx, { mcpServers: { overview } })
  const selectPanel = vi.fn()
  ctx.provide('layout', { selectPanel })
  const settings = stubConfigForm<McpUiSettings>()
  if (preference !== undefined) settings.publish({ value: { statusItem: preference }, writable: true })
  const controller = new McpTrayController(ctx, settings.scope)
  return { controller, face: controller.inject(), overview, settings, selectPanel }
}

/** Let the pending read settle under fake timers. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('preference', () => {
  it('shows by default, and hides when the preference is off', () => {
    expect(bench().controller.getSnapshot()).toMatchObject({ visible: true, loaded: false, servers: [], open: false })
    expect(bench(false).controller.getSnapshot().visible).toBe(false)
  })

  it('reads nothing while hidden, on mount or on a Host change', async () => {
    const { controller, face, overview } = bench(false)
    face.load()
    controller.refresh()
    await Promise.resolve()
    expect(overview).not.toHaveBeenCalled()
  })

  it('reads as soon as the preference turns on, and ignores a publication that changes nothing', async () => {
    const { controller, overview, settings } = bench(false)
    settings.publish({ writable: true })
    expect(overview).not.toHaveBeenCalled()
    settings.publish({ value: { statusItem: true } })
    await vi.waitFor(() => { expect(controller.getSnapshot()).toMatchObject({ visible: true, loaded: true, servers: [server] }) })
  })

  it('closes the panel and stops polling when the preference turns off', async () => {
    vi.useFakeTimers()
    const { controller, face, overview, settings } = bench(true)
    face.setOpen(true)
    await settle()
    settings.publish({ value: { statusItem: false } })
    expect(controller.getSnapshot()).toMatchObject({ visible: false, open: false })
    overview.mockClear()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(overview).not.toHaveBeenCalled()
  })
})

describe('reading', () => {
  it('reads on mount, and on a Host change only once it has mounted', async () => {
    const { controller, face, overview } = bench()
    controller.refresh()
    await Promise.resolve()
    expect(overview).not.toHaveBeenCalled()
    face.load()
    await vi.waitFor(() => { expect(controller.getSnapshot()).toMatchObject({ loaded: true, servers: [server], readAt: 1000 }) })
    controller.refresh()
    await vi.waitFor(() => { expect(overview).toHaveBeenCalledTimes(2) })
  })

  it('keeps the figures on screen when a later read fails', async () => {
    const { controller, face, overview } = bench()
    face.load()
    await vi.waitFor(() => { expect(controller.getSnapshot().loaded).toBe(true) })
    overview.mockResolvedValueOnce(failure as never)
    controller.refresh()
    await vi.waitFor(() => { expect(overview).toHaveBeenCalledTimes(2) })
    await Promise.resolve()
    expect(controller.getSnapshot().servers).toEqual([server])
  })

  it('counts a failed first read as loaded with nothing to show', async () => {
    const { controller, face, overview } = bench()
    overview.mockResolvedValueOnce(failure as never)
    face.load()
    await vi.waitFor(() => { expect(controller.getSnapshot().loaded).toBe(true) })
    expect(controller.getSnapshot().servers).toEqual([])
  })

  it('applies only the newest of two overlapping reads, and none after teardown', async () => {
    const { controller, face, overview } = bench()
    const slow = Promise.withResolvers<ReturnType<typeof answer>>()
    overview.mockReturnValueOnce(slow.promise)
    face.load()
    face.load()
    await vi.waitFor(() => { expect(controller.getSnapshot().loaded).toBe(true) })
    slow.resolve(answer([], 5))
    await slow.promise
    await Promise.resolve()
    expect(controller.getSnapshot().servers).toEqual([server])

    const late = Promise.withResolvers<ReturnType<typeof answer>>()
    overview.mockReturnValueOnce(late.promise)
    controller.refresh()
    controller.dispose()
    late.resolve(answer([], 9))
    await late.promise
    await Promise.resolve()
    expect(controller.getSnapshot().readAt).toBe(1000)
  })
})

describe('the open panel', () => {
  it('reads at once, then every two seconds, and stops when closed', async () => {
    vi.useFakeTimers()
    const { controller, face, overview } = bench()
    face.setOpen(true)
    expect(controller.getSnapshot().open).toBe(true)
    await settle()
    expect(overview).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(overview).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(overview).toHaveBeenCalledTimes(4)

    face.setOpen(true)
    await settle()
    expect(overview).toHaveBeenCalledTimes(4)

    face.setOpen(false)
    expect(controller.getSnapshot().open).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(overview).toHaveBeenCalledTimes(4)
  })

  it('stops polling on teardown and drops the preference subscription', async () => {
    vi.useFakeTimers()
    const { controller, face, overview, settings } = bench()
    face.setOpen(true)
    await settle()
    controller.dispose()
    overview.mockClear()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(overview).not.toHaveBeenCalled()
    expect(settings.listenerCount()).toBe(0)
  })

  it('closes and opens the Plugins panel from the manage action', async () => {
    vi.useFakeTimers()
    const { controller, face, selectPanel } = bench()
    face.setOpen(true)
    await settle()
    face.openManager()
    expect(controller.getSnapshot().open).toBe(false)
    expect(selectPanel).toHaveBeenCalledWith('plugins')
  })
})
