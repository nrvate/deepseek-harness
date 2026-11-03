// @vitest-environment jsdom
/** The MCP status item as the composer dock renders it, driven through the real tray controller. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { McpManagedServerStatus, McpServerStats, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { McpStatusItem, type McpStatusItemProps } from '../src/client/McpStatusItem.tsx'
import { McpTrayController } from '../src/client/mcp-tray-controller.ts'
import { en } from '../src/client/locales.ts'
import { fakeHost, ok, stats, usage, view } from './fake-host.client.ts'

afterEach(cleanup)

const t = makeTranslate(en) as McpStatusItemProps['t']
const READ_AT = 10_000_000

const up = (toolCount = 3, connectedAt = READ_AT): McpManagedServerStatus => ({ state: 'connected', toolCount, connectedAt })
const failed = (lastError?: string): McpManagedServerStatus => ({ state: 'failed', reason: 'gave-up', ...lastError === undefined ? {} : { lastError } })
const off: McpManagedServerStatus = { state: 'disabled' }
const reconnecting: McpManagedServerStatus = { state: 'reconnecting', attempt: 1, maxAttempts: 10, nextRetryAtMs: Date.now() + 60_000, lastError: 'timeout' }

/** One server as the manager reports it and, when it carries figures, as its running client does. */
interface Spec {
  name: string
  /** Absent for a client the manager does not run. */
  status?: McpManagedServerStatus
  stats?: McpServerStats
  sessionStats?: McpServerStats
  defaultActive?: boolean
}
const server = (name: string, rest: Omit<Spec, 'name'> = {}): Spec => ({ name, ...rest })

const SESSION = 'session-1' as SessionId
/** The Session's logged selection: null while it follows the defaults, undefined when the Host offers no selection. */
type Logged = readonly string[] | null | undefined

function mount(servers: Spec[], preference = true, logged?: Logged) {
  const host = fakeHost()
  host.mcpServers.overview.mockImplementation(() => Promise.resolve(ok({
    readAt: READ_AT,
    servers: servers.filter(spec => spec.stats !== undefined).map(spec => usage(spec.name, {
      defaultActive: spec.defaultActive !== false, stats: spec.stats!,
      ...spec.sessionStats === undefined ? {} : { sessionStats: spec.sessionStats },
    })),
  })))
  host.publish(servers.filter(spec => spec.status !== undefined).map(spec => view(spec.name, spec.status)))
  const settings = host.form
  settings.publish({ value: { statusItem: preference }, writable: true })
  const controller = new McpTrayController(host.ctx, settings.scope, host.fleet)
  const { hooks, ...actions } = controller.inject()
  const propsFor = (selection: Logged) => ({
    ...actions, t, sessionId: SESSION, useMcpTray: bindSnapshotSelector(hooks.mcpTray),
    useProjection: (_key: 'mcpServers') => selection === undefined ? undefined : { active: selection },
  }) as McpStatusItemProps
  const rendered = render(<McpStatusItem {...propsFor(logged)} />)
  /** Deliver the Session's next logged selection, as a projection frame does. */
  const log = (selection: Logged): void => { rendered.rerender(<McpStatusItem {...propsFor(selection)} />) }
  const { overview, setSessionServers } = host.mcpServers
  return { ...rendered, controller, overview, setSessionServers, selectPanel: host.selectPanel, settings, log }
}

async function openPanel(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: /^MCP servers:/ }))
  return await screen.findByRole('dialog', { name: en.trayTitle })
}

describe('McpStatusItem', () => {
  it('renders nothing while the preference is off or no server is configured', async () => {
    const off = mount([server('a')], false)
    await waitFor(() => { expect(off.controller.getSnapshot().loaded).toBe(true) })
    expect(off.container.textContent).toBe('')
    cleanup()
    const empty = mount([])
    await waitFor(() => { expect(empty.controller.getSnapshot().loaded).toBe(true) })
    expect(empty.container.textContent).toBe('')
  })

  it('counts connected servers among the enabled ones', async () => {
    mount([
      server('a', { status: up() }),
      server('b', { status: reconnecting }),
      server('c', { status: off }),
    ])
    const trigger = await screen.findByRole('button', { name: 'MCP servers: 1 of 2 connected' })
    expect(trigger.textContent).toBe('MCP 1/2')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it.each([
    ['every enabled server connected', [server('a', { status: up() })], 'MCP 1/1'],
    ['a failed server', [server('a', { status: failed() }), server('b', { status: up() })], 'MCP 1/2'],
    ['a server still connecting', [server('a', { status: { state: 'connecting', attempt: 0 } })], 'MCP 0/1'],
    ['a running client the manager does not run', [server('a', { stats: stats() })], 'MCP 1/1'],
    ['only disabled servers', [server('a', { status: off })], 'MCP 0/0'],
  ] as const)('summarizes %s', async (_label, servers, text) => {
    mount([...servers])
    expect((await screen.findByRole('button', { name: /^MCP servers:/ })).textContent).toBe(text)
  })

  it('opens a panel with totals across servers and one block per server', async () => {
    mount([
      server('alpha', {
        status: up(13, READ_AT - 5_400_000),
        stats: stats({
          calls: 1_200, errors: 3, inputTokens: 4_000, outputTokens: 250_000, totalMs: 240_000, maxMs: 2_500,
          lastCallAt: READ_AT - 65_000, connections: 2, schemaTokens: 1_800,
          serverInfo: { name: 'alpha-server', version: '2.1.0' }, protocolVersion: '2026-07-28',
          tools: [
            { name: 'search', calls: 900, errors: 1, totalMs: 90_000 },
            { name: 'read', calls: 300, errors: 2, totalMs: 150_000 },
          ],
        }),
      }),
      server('beta', {
        status: failed('connection refused'),
        stats: stats({ transport: 'streamable-http', schemaTokens: 200 }),
      }),
    ])
    const panel = await openPanel()
    expect(screen.getByRole('button', { name: /^MCP servers:/ }).getAttribute('aria-expanded')).toBe('true')
    expect(within(panel).getByText('1 of 2 connected')).toBeTruthy()
    // Totals: 1200 calls, 3 errors, 4K in, 250K out, 2K definition tokens per request.
    expect(within(panel).getAllByText('1.2K').length).toBeGreaterThan(0)
    expect(within(panel).getAllByText('≈4K').length).toBeGreaterThan(0)
    expect(within(panel).getAllByText('≈250K').length).toBeGreaterThan(0)
    expect(within(panel).getByText('Tool definitions: ≈2K tokens per request')).toBeTruthy()

    expect(within(panel).getByText('alpha')).toBeTruthy()
    expect(within(panel).getByText(en.stateConnected)).toBeTruthy()
    expect(within(panel).getByText('alpha-server 2.1.0')).toBeTruthy()
    expect(within(panel).getByText('2026-07-28')).toBeTruthy()
    expect(within(panel).getByText(en.transportStdio)).toBeTruthy()
    expect(within(panel).getByText('1 h 30 min')).toBeTruthy()
    expect(within(panel).getByText('13')).toBeTruthy()
    expect(within(panel).getByText('≈1.8K tokens per request')).toBeTruthy()
    expect(within(panel).getByText('200 ms')).toBeTruthy()
    expect(within(panel).getByText('2.5 s')).toBeTruthy()
    expect(within(panel).getByText('1 min ago')).toBeTruthy()
    expect(within(panel).getByText('search')).toBeTruthy()
    expect(within(panel).getByText('900 calls, 1 errors, 100 ms average')).toBeTruthy()

    expect(within(panel).getByText('beta')).toBeTruthy()
    expect(within(panel).getByText(en.stateFailed)).toBeTruthy()
    expect(within(panel).getByText('connection refused')).toBeTruthy()
    expect(within(panel).getByText(en.transportHttp)).toBeTruthy()
    expect(within(panel).getByText(en.statNever)).toBeTruthy()
    expect(within(panel).getByText(`${en.traySplitNote} ${en.trayNote}`)).toBeTruthy()
  })

  it('lists at most five tools per server', async () => {
    mount([server('a', {
      status: up(),
      stats: stats({ calls: 21, tools: ['t1', 't2', 't3', 't4', 't5', 't6'].map((name, index) => ({ name, calls: 6 - index, errors: 0, totalMs: 10 })) }),
    })])
    const panel = await openPanel()
    expect(within(panel).getByText('t5')).toBeTruthy()
    expect(within(panel).queryByText('t6')).toBeNull()
  })

  it('shows a disabled server as off, a client outside the manager as loaded, and a reconnect with its last error', async () => {
    mount([
      server('disabled', { status: off }),
      server('static', { stats: stats() }),
      server('ok', { status: up(), stats: stats() }),
      server('flaky', { status: reconnecting }),
    ])
    const panel = await openPanel()
    expect(within(panel).getByText(en.phaseOff)).toBeTruthy()
    expect(within(panel).getByText(en.phaseLoaded)).toBeTruthy()
    expect(within(panel).getByText(/^Reconnecting \(1\/10\), next try in/)).toBeTruthy()
    expect(within(panel).getByText('timeout')).toBeTruthy()
    // No call yet: no latency figures.
    expect(within(panel).queryByText(en.statAverage)).toBeNull()
    expect(within(panel).queryByText(en.statServer)).toBeNull()
    expect(within(panel).queryByText(en.statTopTools)).toBeNull()
  })

  it('shows no tool count or uptime for a client the manager does not report', async () => {
    mount([server('odd', { stats: stats() })])
    const panel = await openPanel()
    expect(within(panel).queryByText(en.statTools)).toBeNull()
    expect(within(panel).queryByText(en.statUptime)).toBeNull()
  })

  it('closes on Escape, on a press outside, and on a second click', async () => {
    mount([server('a', { status: up(), stats: stats() })])
    await openPanel()
    fireEvent.keyDown(document, { key: 'a' })
    expect(screen.queryByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })

    await openPanel()
    fireEvent.pointerDown(document.body)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })

    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: /^MCP servers:/ }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('opens the Plugins panel from the manage button and closes itself', async () => {
    const { selectPanel } = mount([server('a', { status: up(), stats: stats() })])
    const panel = await openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: en.trayManage }))
    expect(selectPanel).toHaveBeenCalledWith('plugins')
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('disappears with an open panel when the preference turns off', async () => {
    const { settings, container } = mount([server('a', { status: up(), stats: stats() })])
    await openPanel()
    settings.publish({ value: { statusItem: false } })
    await waitFor(() => { expect(container.textContent).toBe('') })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  describe('per-Session figures', () => {
    it('shows this Session beside all Sessions, in the totals and per server', async () => {
      mount([
        server('alpha', { status: up(), stats: stats({ calls: 12, errors: 2, inputTokens: 400, outputTokens: 800 }), sessionStats: stats({ calls: 3, inputTokens: 100, outputTokens: 40 }) }),
        server('beta', { status: up(), stats: stats({ calls: 5 }), sessionStats: stats({ calls: 1 }) }),
        server('quiet', { status: up(), stats: stats() }),
      ])
      const panel = await openPanel()
      const counters = (caption: string): string =>
        within(panel).getByText(caption).nextElementSibling?.textContent ?? ''
      expect(counters(en.trayThisSession)).toBe('Calls4Errors0Tokens in≈100Tokens out≈40')
      expect(counters(en.trayAllSessions)).toBe('Calls17Errors2Tokens in≈400Tokens out≈800')
      expect(within(panel).getByText('3 / 12')).toBeTruthy()
      expect(within(panel).getByText('≈100 / ≈400')).toBeTruthy()
      expect(within(panel).getByText('1 / 5')).toBeTruthy()
      expect(within(panel).getByText(`${en.traySplitNote} ${en.trayNote}`)).toBeTruthy()
    })

    it('shows only the totals while the figures on hand were read for another Session', async () => {
      const { controller } = mount([server('alpha', { status: up(), stats: stats({ calls: 12 }), sessionStats: stats({ calls: 3 }) })])
      const panel = await openPanel()
      const other = controller.inject()
      other.load('session-2' as SessionId)
      await waitFor(() => { expect(controller.getSnapshot().statsSession).toBe('session-2') })
      expect(within(panel).queryByText(en.trayThisSession)).toBeNull()
      expect(within(panel).queryByText('3 / 12')).toBeNull()
      expect(within(panel).getByText(en.trayNote)).toBeTruthy()
    })
  })

  describe('per-Session selection', () => {
    const three = [
      server('alpha', { status: up(), stats: stats({ schemaTokens: 1_000 }) }),
      server('beta', { status: up(), defaultActive: false, stats: stats({ schemaTokens: 400 }) }),
      server('off', { status: off }),
    ]
    const toggle = (panel: HTMLElement, name: string): HTMLElement =>
      within(panel).getByRole('switch', { name: `Use ${name} in this session` })

    it('offers no switch while the Host has no per-Session selection, and counts every server\'s definitions', async () => {
      mount(three)
      const panel = await openPanel()
      expect(within(panel).queryByRole('switch')).toBeNull()
      expect(within(panel).getByText('Tool definitions: ≈1.4K tokens per request')).toBeTruthy()
    })

    it('shows each running server\'s default, and counts only the definitions the Session carries', async () => {
      mount(three, true, null)
      const panel = await openPanel()
      expect(toggle(panel, 'alpha').getAttribute('aria-checked')).toBe('true')
      expect(toggle(panel, 'beta').getAttribute('aria-checked')).toBe('false')
      expect(within(panel).queryByRole('switch', { name: 'Use off in this session' })).toBeNull()
      expect(within(panel).getByText('Tool definitions: ≈1K tokens per request')).toBeTruthy()
    })

    it('switches a server at once, sends the complete selection, and follows the Session log afterwards', async () => {
      const { setSessionServers, log } = mount(three, true, null)
      const panel = await openPanel()
      fireEvent.click(toggle(panel, 'beta'))
      expect(toggle(panel, 'beta').getAttribute('aria-checked')).toBe('true')
      expect(setSessionServers).toHaveBeenCalledExactlyOnceWith(SESSION, ['alpha', 'beta'])
      await waitFor(() => { expect(within(panel).getByText('Tool definitions: ≈1.4K tokens per request')).toBeTruthy() })

      fireEvent.click(toggle(panel, 'alpha'))
      expect(setSessionServers).toHaveBeenLastCalledWith(SESSION, ['beta'])
      expect(toggle(panel, 'alpha').getAttribute('aria-checked')).toBe('false')

      // Once the Host has answered, another client's selection arriving through the Session log replaces what this control assumed.
      await waitFor(() => { expect(setSessionServers).toHaveBeenCalledTimes(2) })
      await new Promise(resolve => setTimeout(resolve))
      log(['alpha'])
      await waitFor(() => { expect(toggle(panel, 'beta').getAttribute('aria-checked')).toBe('false') })
      expect(toggle(panel, 'alpha').getAttribute('aria-checked')).toBe('true')
    })

    it('returns to the logged selection and says why when the Host refuses', async () => {
      const { setSessionServers } = mount(three, true, ['alpha'])
      setSessionServers.mockResolvedValueOnce({ ok: false, error: new Error('MCP server "beta" is not configured') } as never)
      const panel = await openPanel()
      fireEvent.click(toggle(panel, 'beta'))
      expect(toggle(panel, 'beta').getAttribute('aria-checked')).toBe('true')
      await waitFor(() => { expect(toggle(panel, 'beta').getAttribute('aria-checked')).toBe('false') })
      expect(within(panel).getByRole('alert').textContent).toBe('The selection was not saved: MCP server "beta" is not configured')
    })

    it('keeps the latest change when an earlier one is refused, and while the log still shows the selection before it', async () => {
      const { setSessionServers, log } = mount(three, true, ['alpha'])
      const first = Promise.withResolvers<never>()
      const second = Promise.withResolvers<{ ok: true; value: { active: string[] } }>()
      setSessionServers.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const panel = await openPanel()
      fireEvent.click(toggle(panel, 'beta'))
      fireEvent.click(toggle(panel, 'alpha'))
      expect(setSessionServers).toHaveBeenLastCalledWith(SESSION, ['beta'])
      first.resolve({ ok: false, error: new Error('superseded') } as never)
      await first.promise
      await new Promise(resolve => setTimeout(resolve))
      expect(toggle(panel, 'alpha').getAttribute('aria-checked')).toBe('false')
      expect(toggle(panel, 'beta').getAttribute('aria-checked')).toBe('true')

      // The first change reaches the log while the second is still in flight.
      log(['alpha', 'beta'])
      await new Promise(resolve => setTimeout(resolve))
      expect(toggle(panel, 'alpha').getAttribute('aria-checked')).toBe('false')
      second.resolve({ ok: true, value: { active: ['beta'] } })
      await second.promise
      log(['beta'])
      await waitFor(() => { expect(toggle(panel, 'alpha').getAttribute('aria-checked')).toBe('false') })
      expect(toggle(panel, 'beta').getAttribute('aria-checked')).toBe('true')
    })
  })
})
