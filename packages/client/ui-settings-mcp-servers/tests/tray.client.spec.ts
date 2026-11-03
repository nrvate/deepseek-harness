/** The status item's state: the preference, reads on mount and on Host changes, polling only while open, and a Session's selection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { McpServerUsage, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { joinTray, McpTrayController } from '../src/client/mcp-tray-controller.ts'
import { connected, fakeHost, ok, usage, view } from './fake-host.client.ts'

afterEach(() => { vi.useRealTimers() })

const server = usage('a')
/** How the item lists a running client the manager has not reported. */
const shown = { serverName: 'a', status: undefined, usage: server }
const session = 'session-1' as SessionId
function answer(servers: McpServerUsage[] = [server], readAt = 1000) {
  return ok({ readAt, servers })
}
const failure = { ok: false as const, error: new Error('down') }

function bench(preference?: boolean) {
  const host = fakeHost({ overview: [server] })
  const overview = host.mcpServers.overview
  overview.mockImplementation(() => Promise.resolve(answer()))
  const settings = stubConfigForm<{ statusItem: boolean }>()
  if (preference !== undefined) settings.publish({ value: { statusItem: preference }, writable: true })
  const controller = new McpTrayController(host.ctx, settings.scope, host.fleet)
  return { ...host, controller, face: controller.inject(), overview, setSessionServers: host.mcpServers.setSessionServers, settings }
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

  it('still reads while hidden, because the composer selector shows the same servers', async () => {
    const { controller, face, overview } = bench(false)
    face.load(session)
    await vi.waitFor(() => { expect(controller.getSnapshot()).toMatchObject({ visible: false, loaded: true, servers: [shown] }) })
    controller.refresh()
    await vi.waitFor(() => { expect(overview).toHaveBeenCalledTimes(2) })
  })

  it('follows the preference without reading, and ignores a publication that changes nothing', () => {
    const { controller, overview, settings } = bench(false)
    settings.publish({ writable: true })
    expect(controller.getSnapshot().visible).toBe(false)
    settings.publish({ value: { statusItem: true } })
    expect(controller.getSnapshot().visible).toBe(true)
    expect(overview).not.toHaveBeenCalled()
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
    face.load(session)
    await vi.waitFor(() => { expect(controller.getSnapshot()).toMatchObject({ loaded: true, servers: [shown], readAt: 1000 }) })
    // The read names the Session on screen, and the snapshot records whose figures it holds.
    expect(overview).toHaveBeenLastCalledWith(session)
    expect(controller.getSnapshot().statsSession).toBe(session)
    controller.refresh()
    await vi.waitFor(() => { expect(overview).toHaveBeenCalledTimes(2) })
  })

  it('keeps the figures on screen when a later read fails', async () => {
    const { controller, face, overview } = bench()
    face.load(session)
    await vi.waitFor(() => { expect(controller.getSnapshot().loaded).toBe(true) })
    overview.mockResolvedValueOnce(failure as never)
    controller.refresh()
    await vi.waitFor(() => { expect(overview).toHaveBeenCalledTimes(2) })
    await Promise.resolve()
    expect(controller.getSnapshot().servers).toEqual([shown])
  })

  it('counts a failed first read as loaded with nothing to show', async () => {
    const { controller, face, overview } = bench()
    overview.mockResolvedValueOnce(failure as never)
    face.load(session)
    await vi.waitFor(() => { expect(controller.getSnapshot().loaded).toBe(true) })
    expect(controller.getSnapshot().servers).toEqual([])
  })

  it('applies only the newest of two overlapping reads, and none after teardown', async () => {
    const { controller, face, overview } = bench()
    const slow = Promise.withResolvers<ReturnType<typeof answer>>()
    overview.mockReturnValueOnce(slow.promise)
    face.load(session)
    face.load(session)
    await vi.waitFor(() => { expect(controller.getSnapshot().loaded).toBe(true) })
    slow.resolve(answer([], 5))
    await slow.promise
    await Promise.resolve()
    expect(controller.getSnapshot().servers).toEqual([shown])

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

describe('joining the manager\'s list', () => {
  it('lists managed servers in the manager\'s order with their usage, then clients the manager does not run, and leaves out removed ones', () => {
    const rows = joinTray([view('b', connected(2)), view('a', { state: 'disabled' }), view('gone', connected(), false)], [usage('a'), usage('static')])
    expect(rows.map(row => [row.serverName, row.status?.state, row.usage?.serverName])).toEqual([
      ['b', 'connected', undefined], ['a', 'disabled', 'a'], ['static', undefined, 'static'],
    ])
    expect(joinTray(undefined, [])).toEqual([])
  })

  it('follows the manager stream once a consumer has mounted', async () => {
    const { controller, face, publish } = bench()
    face.load(session)
    await vi.waitFor(() => { expect(controller.getSnapshot().loaded).toBe(true) })
    publish([view('a', connected(4))])
    await vi.waitFor(() => { expect(controller.getSnapshot().servers).toEqual([{ serverName: 'a', status: connected(4), usage: server }]) })
    controller.dispose()
    publish([view('a', { state: 'disabled' })])
    await Promise.resolve()
    expect(controller.getSnapshot().servers[0]?.status?.state).toBe('connected')
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

describe('selecting a Session\'s servers', () => {
  it('sends the complete selection and resolves to whether the Host applied it', async () => {
    const { controller, face, setSessionServers } = bench()
    await expect(face.selectServers(session, ['a', 'b'])).resolves.toBe(true)
    expect(setSessionServers).toHaveBeenCalledExactlyOnceWith(session, ['a', 'b'])
    expect(controller.getSnapshot().problem).toBeUndefined()
  })

  it('reports a refusal, and clears it once a later selection lands', async () => {
    const { controller, face, setSessionServers } = bench()
    setSessionServers.mockResolvedValueOnce({ ok: false, error: new Error('MCP server "gone" is not configured') } as never)
    await expect(face.selectServers(session, ['gone'])).resolves.toBe(false)
    expect(controller.getSnapshot().problem).toBe('MCP server "gone" is not configured')
    await face.selectServers(session, [])
    expect(controller.getSnapshot().problem).toBeUndefined()
  })

  it('reports nothing after teardown', async () => {
    const { controller, face, setSessionServers } = bench()
    setSessionServers.mockResolvedValueOnce({ ok: false, error: new Error('late') } as never)
    const pending = face.selectServers(session, ['a'])
    controller.dispose()
    await expect(pending).resolves.toBe(false)
    expect(controller.getSnapshot().problem).toBeUndefined()
  })
})
