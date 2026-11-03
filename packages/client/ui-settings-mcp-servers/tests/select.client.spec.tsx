// @vitest-environment jsdom
/** The composer's MCP server selector, driven through the real tray controller. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { McpManagedServerStatus, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { McpServerSelect, type McpServerSelectProps } from '../src/client/McpServerSelect.tsx'
import { McpTrayController, type McpTrayServer } from '../src/client/mcp-tray-controller.ts'
import { activeServers } from '../src/client/session-servers.ts'
import { en } from '../src/client/locales.ts'
import { connected, fakeHost, ok, usage, view } from './fake-host.client.ts'

afterEach(cleanup)

const t = makeTranslate(en) as McpServerSelectProps['t']
const SESSION = 'session-1' as SessionId
/** `absent`: the Host offers no per-Session selection. */
type Logged = readonly string[] | null | 'absent'

/** One server: its manager status and whether its client runs, so a Session can select it. */
interface Spec {
  name: string
  status: McpManagedServerStatus
  running: boolean
  defaultActive: boolean
}
const server = (name: string, rest: Partial<Omit<Spec, 'name'>> = {}): Spec => ({ name, status: connected(), running: true, defaultActive: true, ...rest })
const offline = (name: string): Spec => server(name, { status: { state: 'disabled' }, running: false })
const tray = (spec: Spec): McpTrayServer => ({
  serverName: spec.name, status: spec.status, usage: spec.running ? usage(spec.name, { defaultActive: spec.defaultActive }) : undefined,
})

function mount(servers: Spec[], logged: Logged = null) {
  const host = fakeHost()
  host.mcpServers.overview.mockImplementation(() => Promise.resolve(ok({
    readAt: 1, servers: servers.filter(spec => spec.running).map(spec => usage(spec.name, { defaultActive: spec.defaultActive })),
  })))
  host.publish(servers.map(spec => view(spec.name, spec.status)))
  // The selector does not depend on the status item's preference.
  host.form.publish({ value: { statusItem: false }, writable: true })
  const controller = new McpTrayController(host.ctx, host.form.scope, host.fleet)
  const { hooks, ...actions } = controller.inject()
  const props = {
    ...actions, t, sessionId: SESSION, useMcpTray: bindSnapshotSelector(hooks.mcpTray),
    useProjection: ((_key: 'mcpServers') => logged === 'absent' ? undefined : { active: logged }) as McpServerSelectProps['useProjection'],
  } as McpServerSelectProps
  const rendered = render(<McpServerSelect {...props} />)
  const { overview, setSessionServers } = host.mcpServers
  return { ...rendered, controller, overview, setSessionServers, selectPanel: host.selectPanel }
}

const trigger = (): Promise<HTMLElement> => screen.findByRole('button', { name: /^MCP servers in this session:/ })
const row = (name: RegExp | string): HTMLElement => screen.getByRole('menuitem', { name })
/** The trailing check the menu draws on a selected row. */
const checked = (name: RegExp | string): boolean => row(name).querySelector('svg') !== null

describe('activeServers', () => {
  it('uses each server\'s default until the Session logs a selection, then exactly the logged names on offer', () => {
    const options = [server('a'), server('b', { defaultActive: false }), server('c')].map(tray)
    expect(activeServers(options, null)).toEqual(['a', 'c'])
    expect(activeServers(options, ['c', 'b', 'removed'])).toEqual(['b', 'c'])
    expect(activeServers(options, [])).toEqual([])
  })
})

describe('McpServerSelect', () => {
  it('renders nothing while the Host offers no per-Session selection or no server runs', async () => {
    const absent = mount([server('a')], 'absent')
    await waitFor(() => { expect(absent.controller.getSnapshot().loaded).toBe(true) })
    expect(absent.container.textContent).toBe('')
    cleanup()
    const none = mount([offline('a')])
    await waitFor(() => { expect(none.controller.getSnapshot().loaded).toBe(true) })
    expect(none.container.textContent).toBe('')
  })

  it('reads the servers for the Session on screen and counts the ones in use', async () => {
    const { overview } = mount([server('alpha'), server('beta', { defaultActive: false }), offline('gone')])
    const chip = await trigger()
    expect(overview).toHaveBeenCalledWith(SESSION)
    expect(chip.getAttribute('aria-label')).toBe('MCP servers in this session: 1 of 2')
    expect(chip.textContent).toBe('MCP 1/2')
    expect(chip.getAttribute('aria-expanded')).toBe('false')
  })

  it('lists the servers with a check on each one in use, and says when one is not connected', async () => {
    mount([
      server('alpha'),
      server('beta', { status: { state: 'reconnecting', attempt: 2, maxAttempts: 10, nextRetryAtMs: Date.now() + 5_000, lastError: 'x' } }),
      server('pending', { status: { state: 'connecting', attempt: 0 } }),
    ], ['alpha', 'beta'])
    fireEvent.click(await trigger())
    expect(screen.getByText(en.selectHeading)).toBeTruthy()
    expect(checked('alpha')).toBe(true)
    expect(checked(/^beta/)).toBe(true)
    expect(row(/^beta/).textContent).toMatch(/^betaReconnecting \(2\/10\), next try in/)
    expect(checked(/^pending/)).toBe(false)
  })

  it('keeps the list open across choices and sends the complete selection each time', async () => {
    const { setSessionServers } = mount([server('alpha'), server('beta', { defaultActive: false })])
    const chip = await trigger()
    fireEvent.click(chip)
    fireEvent.click(row('beta'))
    expect(setSessionServers).toHaveBeenLastCalledWith(SESSION, ['alpha', 'beta'])
    expect(checked('beta')).toBe(true)
    await waitFor(() => { expect(chip.textContent).toBe('MCP 2/2') })
    fireEvent.click(row('alpha'))
    fireEvent.click(row('beta'))
    expect(setSessionServers).toHaveBeenLastCalledWith(SESSION, [])
    expect(chip.textContent).toBe('MCP 0/2')
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('shows why a selection was not saved', async () => {
    const { setSessionServers } = mount([server('alpha')])
    setSessionServers.mockResolvedValueOnce({ ok: false, error: new Error('no selection service') } as never)
    fireEvent.click(await trigger())
    fireEvent.click(row('alpha'))
    expect(await screen.findByText('The selection was not saved: no selection service')).toBeTruthy()
    expect(checked('alpha')).toBe(true)
  })

  it('opens the servers page from the last row and closes the list, and closes on Escape', async () => {
    const { selectPanel } = mount([server('alpha')])
    const chip = await trigger()
    fireEvent.click(chip)
    fireEvent.click(row(en.trayManage))
    expect(selectPanel).toHaveBeenCalledWith('plugins')
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })

    fireEvent.click(chip)
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  })
})
