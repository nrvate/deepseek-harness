// @vitest-environment jsdom
/** The MCP status item as the composer dock renders it, driven through the real tray controller. */
import { Context } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate, stubConfigForm, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  McpEntryId, McpServerOverview, McpServerStats, McpServerStatus,
} from '@deepseek-ai/dsh-api-remotes/client'
import { McpStatusItem, type McpStatusItemProps } from '../src/client/McpStatusItem.tsx'
import { McpTrayController } from '../src/client/mcp-tray-controller.ts'
import { en } from '../src/client/locales.ts'
import type { McpUiSettings } from '../src/mcp-ui-settings.ts'

afterEach(cleanup)

const t = makeTranslate(en) as McpStatusItemProps['t']
const READ_AT = 10_000_000

const status = (state: McpServerStatus['state'], rest: Partial<McpServerStatus> = {}): McpServerStatus => (
  { serverName: 's', state, attempt: 0, maxAttempts: 10, toolCount: 3, ...rest }
)
const stats = (rest: Partial<McpServerStats> = {}): McpServerStats => ({
  calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, totalMs: 0, maxMs: 0, connections: 1, schemaTokens: 0, transport: 'stdio', tools: [], ...rest,
})
const server = (name: string, rest: Partial<McpServerOverview> = {}): McpServerOverview => (
  { id: `mcp-${name}` as McpEntryId, serverName: name, enabled: true, ...rest }
)

function mount(servers: McpServerOverview[], preference = true) {
  const ctx = new Context()
  const overview = vi.fn(() => Promise.resolve({ ok: true as const, value: { readAt: READ_AT, servers } }))
  new TestRemote(ctx, { mcpServers: { overview } })
  const selectPanel = vi.fn()
  ctx.provide('layout', { selectPanel })
  const settings = stubConfigForm<McpUiSettings>()
  settings.publish({ value: { statusItem: preference }, writable: true })
  const controller = new McpTrayController(ctx, settings.scope)
  const { hooks, ...actions } = controller.inject()
  const props = { ...actions, t, useMcpTray: bindSnapshotSelector(hooks.mcpTray) } as McpStatusItemProps
  const view = render(<McpStatusItem {...props} />)
  return { ...view, controller, overview, selectPanel, settings }
}

async function openPanel(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: /^MCP servers:/ }))
  return await screen.findByRole('dialog', { name: en.trayTitle })
}

describe('McpStatusItem', () => {
  it('renders nothing while the preference is off or no server is configured', async () => {
    const off = mount([server('a')], false)
    await Promise.resolve()
    expect(off.container.textContent).toBe('')
    expect(off.overview).not.toHaveBeenCalled()
    cleanup()
    const empty = mount([])
    await waitFor(() => { expect(empty.controller.getSnapshot().loaded).toBe(true) })
    expect(empty.container.textContent).toBe('')
  })

  it('counts connected servers among the enabled ones', async () => {
    mount([
      server('a', { status: status('connected') }),
      server('b', { status: status('reconnecting', { attempt: 1 }) }),
      server('c', { enabled: false, status: status('connected') }),
    ])
    const trigger = await screen.findByRole('button', { name: 'MCP servers: 1 of 2 connected' })
    expect(trigger.textContent).toBe('MCP 1/2')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it.each([
    ['every enabled server connected', [server('a', { status: status('connected') })], 'MCP 1/1'],
    ['a failed server', [server('a', { status: status('failed') }), server('b', { status: status('connected') })], 'MCP 1/2'],
    ['a server with no status yet', [server('a')], 'MCP 0/1'],
    ['only disabled servers', [server('a', { enabled: false })], 'MCP 0/0'],
  ] as const)('summarizes %s', async (_label, servers, text) => {
    mount([...servers])
    expect((await screen.findByRole('button', { name: /^MCP servers:/ })).textContent).toBe(text)
  })

  it('opens a panel with totals across servers and one block per server', async () => {
    mount([
      server('alpha', {
        status: status('connected', { connectedAt: READ_AT - 5_400_000, toolCount: 13 }),
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
        status: status('failed', { attempt: 10, error: 'connection refused', toolCount: 0 }),
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
    expect(within(panel).getByText(en.trayNote)).toBeTruthy()
  })

  it('lists at most five tools per server', async () => {
    mount([server('a', {
      status: status('connected'),
      stats: stats({ calls: 21, tools: ['t1', 't2', 't3', 't4', 't5', 't6'].map((name, index) => ({ name, calls: 6 - index, errors: 0, totalMs: 10 })) }),
    })])
    const panel = await openPanel()
    expect(within(panel).getByText('t5')).toBeTruthy()
    expect(within(panel).queryByText('t6')).toBeNull()
  })

  it('shows a disabled server as off, one without a status as loading, and names a nameless one by its row id', async () => {
    mount([
      server('', { enabled: false, status: status('failed', { error: 'stale' }) }),
      server('pending'),
      server('ok', { status: status('connected', { error: 'old' }), stats: stats() }),
    ])
    const panel = await openPanel()
    expect(within(panel).getByText('mcp-')).toBeTruthy()
    expect(within(panel).getByText(en.phaseOff)).toBeTruthy()
    expect(within(panel).getByText(en.phaseLoading)).toBeTruthy()
    // A disabled row's stale error and a connected row's old error are not shown.
    expect(within(panel).queryByText('stale')).toBeNull()
    expect(within(panel).queryByText('old')).toBeNull()
    // No call yet: no latency figures, and no connection time without a recorded connect.
    expect(within(panel).queryByText(en.statAverage)).toBeNull()
    expect(within(panel).queryByText(en.statUptime)).toBeNull()
    expect(within(panel).queryByText(en.statServer)).toBeNull()
    expect(within(panel).queryByText(en.statTopTools)).toBeNull()
  })

  it('shows a tool count of zero for a server that reports usage but no status', async () => {
    mount([server('odd', { stats: stats() })])
    const panel = await openPanel()
    expect(within(panel).getByText(en.statTools).nextElementSibling?.textContent).toBe('0')
  })

  it('closes on Escape, on a press outside, and on a second click', async () => {
    mount([server('a', { status: status('connected') })])
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
    const { selectPanel } = mount([server('a', { status: status('connected') })])
    const panel = await openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: en.trayManage }))
    expect(selectPanel).toHaveBeenCalledWith('plugins')
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('disappears with an open panel when the preference turns off', async () => {
    const { settings, container } = mount([server('a', { status: status('connected') })])
    await openPanel()
    settings.publish({ value: { statusItem: false } })
    await waitFor(() => { expect(container.textContent).toBe('') })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
