// @vitest-environment jsdom
/** The MCP servers page as the Plugins page renders it, driven through the real controller. */
import { Context } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate, stubConfigForm, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { McpChangeResult, McpEntryId, McpServerInfo, McpServerSpec, McpServerStatus, McpToolInfo, McpToolPolicy } from '@deepseek-ai/dsh-api-remotes/client'
import { McpServersCard, type McpServersCardProps } from '../src/client/McpServersCard.tsx'
import { McpServersToast, type McpServersToastProps } from '../src/client/McpServersToast.tsx'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { McpServersController, type McpServersState } from '../src/client/mcp-servers-controller.ts'
import { en } from '../src/client/locales.ts'
import type { McpUiSettings } from '../src/mcp-ui-settings.ts'

afterEach(cleanup)

const t = makeTranslate(en) as McpServersCardProps['t']
const id = (value: string): McpEntryId => value as McpEntryId

const stdioSpec: McpServerSpec = {
  transport: 'stdio', serverName: 'files', command: 'mcp-files', args: ['--root', '/tmp'],
  env: { TOKEN: { kind: 'env', name: 'FILES_TOKEN' }, STORED: { kind: 'kept' } },
}
const httpSpec: McpServerSpec = { transport: 'streamable-http', serverName: 'web', url: 'https://example.test/mcp', headers: {} }

function row(rowId: string, rest: Partial<McpServerInfo> = {}): McpServerInfo {
  return { id: id(rowId), serverName: rowId, transport: 'stdio', summary: 'mcp-files --root /tmp', enabled: true, defaultActive: true, toolPolicy: { default: 'ask', tools: {} }, fiberPhase: 'active', owned: true, ...rest }
}

const applied: McpChangeResult = { changed: true, application: 'applied', target: 'x' }

const connected: McpServerStatus = { serverName: 'files', state: 'connected', attempt: 0, maxAttempts: 10, toolCount: 2 }
const echo: McpToolInfo = { name: 'echo', publicName: 'mcp__files__echo', description: 'Echo it back.\nSecond line.', parameters: [] }
const search: McpToolInfo = {
  name: 'search', publicName: 'mcp__files__search', description: '',
  parameters: [
    { name: 'query', type: 'string', required: true, description: 'What to find' },
    { name: 'limit', type: 'integer', required: false, description: '' },
  ],
}

function mount(rows: McpServerInfo[], view: 'page' | 'summary' = 'page') {
  const ctx = new Context()
  const mcpServers = {
    list: vi.fn(() => Promise.resolve({ ok: true as const, value: rows })),
    upsert: vi.fn((_spec: McpServerSpec, _options?: unknown) => Promise.resolve({ ok: true as const, value: applied })),
    setEnabled: vi.fn((_id: McpEntryId, _enabled: boolean) => Promise.resolve({ ok: true as const, value: applied })),
    removeServer: vi.fn((_id: McpEntryId) => Promise.resolve({ ok: true as const, value: applied })),
    tools: vi.fn((_id: McpEntryId) => Promise.resolve({ ok: true as const, value: { tools: [echo], status: connected } })),
    reconnectServer: vi.fn((_id: McpEntryId) => Promise.resolve({ ok: true as const, value: { started: true } })),
    setToolPolicy: vi.fn((_id: McpEntryId, _policy: McpToolPolicy) => Promise.resolve({ ok: true as const, value: applied })),
  }
  new TestRemote(ctx, { mcpServers })
  const settings = stubConfigForm<McpUiSettings>()
  settings.publish({ value: { statusItem: true }, writable: true })
  const controller = new McpServersController(ctx, settings.scope)
  const { hooks, ...actions } = controller.inject()
  const props = { ...actions, view, t, useMcpServers: bindSnapshotSelector(hooks.mcpServers) } as McpServersCardProps
  const view_ = render(<McpServersCard {...props} />)
  return { ...view_, controller, mcpServers, face: controller.inject(), props, settings }
}

const files = row('mcp-files', { serverName: 'files', spec: stdioSpec })
const web = row('mcp-web', { serverName: 'web', transport: 'streamable-http', summary: 'https://example.test', spec: httpSpec, enabled: false, fiberPhase: null })

describe('McpServersCard', () => {
  it('renders its one-liner alone in the summary view', () => {
    mount([], 'summary')
    expect(document.body.textContent).toBe(en.description)
  })

  it('shows a loader while the first read is in flight, then an empty state', async () => {
    mount([])
    expect(screen.getByRole('status')).toBeTruthy()
    expect(await screen.findByText(en.empty)).toBeTruthy()
    expect(screen.queryByText(en.statusNote)).toBeNull()
  })

  it('offers a retry when the first read fails', async () => {
    const { mcpServers } = mount([])
    mcpServers.list.mockResolvedValueOnce({ ok: false, error: new Error('down') } as never)
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    cleanup()
    const second = mount([])
    second.mcpServers.list.mockResolvedValueOnce({ ok: false, error: new Error('down') } as never)
    second.face.load()
    expect((await screen.findByRole('alert')).textContent).toContain(en.loadFailed)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('lists each server with its type, state, and why a row cannot be changed', async () => {
    mount([
      files, web,
      row('overlay', { owned: false, readOnlyReason: 'unaddressable', fiberPhase: 'failed', serverName: '' }),
      row('expr', { readOnlyReason: 'custom-expression', fiberPhase: 'loading' }),
      row('cred', { transport: 'streamable-http', readOnlyReason: 'embedded-credentials', fiberPhase: 'unloading' }),
    ])
    expect(await screen.findByText('files')).toBeTruthy()
    expect(screen.getAllByText(en.transportStdio).length).toBeGreaterThan(0)
    expect(screen.getAllByText(en.transportHttp).length).toBeGreaterThan(0)
    expect(screen.getByText(en.phaseLoaded)).toBeTruthy()
    expect(screen.getByText(en.phaseOff)).toBeTruthy()
    expect(screen.getByText(en.phaseFailed)).toBeTruthy()
    expect(screen.getAllByText(en.phaseLoading)).toHaveLength(2)
    expect(screen.getByText(en.readOnlyOutside)).toBeTruthy()
    expect(screen.getByText(en.readOnlyExpression)).toBeTruthy()
    expect(screen.getByText(en.readOnlyCredentials)).toBeTruthy()
    // A row with no server name falls back to its row id.
    expect(screen.getByText('overlay')).toBeTruthy()
  })

  it('shows an enabled row as off when its entry has no live phase', async () => {
    mount([row('quiet', { fiberPhase: null })])
    expect(await screen.findByText(en.phaseOff)).toBeTruthy()
  })

  it('disables the switch and the actions of a row the profile file does not own', async () => {
    mount([row('overlay', { owned: false, readOnlyReason: 'unaddressable' })])
    const toggle = await screen.findByRole('switch', { name: 'Enable overlay' })
    expect(toggle).toHaveProperty('disabled', true)
    expect(screen.queryByRole('button', { name: en.edit })).toBeNull()
    expect(screen.queryByRole('button', { name: en.remove })).toBeNull()
  })

  it('offers remove but not edit for an owned row the form cannot edit', async () => {
    mount([row('expr', { readOnlyReason: 'custom-expression' })])
    expect(await screen.findByRole('button', { name: en.remove })).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.edit })).toBeNull()
  })

  it('toggles a server from its switch', async () => {
    const { mcpServers } = mount([files])
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable files' }))
    await waitFor(() => { expect(mcpServers.setEnabled).toHaveBeenCalledWith('mcp-files', false) })
  })

  it('adds a local server after the person trusts its command', async () => {
    const { mcpServers } = mount([])
    mcpServers.upsert.mockResolvedValueOnce({
      ok: true,
      value: { changed: false, application: 'failed', target: 'mcp-new', error: { code: 'confirmation-required', message: 'c', command: 'run --flag' } },
    } as never)
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    const dialog = screen.getByRole('dialog', { name: en.addTitle })
    const save = within(dialog).getByRole('button', { name: en.save })
    expect(save).toHaveProperty('disabled', true)
    fireEvent.change(within(dialog).getByLabelText(en.serverName), { target: { value: 'new' } })
    fireEvent.change(within(dialog).getByLabelText(en.command), { target: { value: 'run' } })
    fireEvent.change(within(dialog).getByLabelText(en.args), { target: { value: '--flag' } })
    fireEvent.change(within(dialog).getByLabelText(en.cwd), { target: { value: '/work' } })
    fireEvent.change(within(dialog).getByLabelText(en.timeout), { target: { value: '5000' } })
    fireEvent.click(within(dialog).getByRole('switch', { name: en.failOnStartup }))
    expect(within(dialog).getByRole('switch', { name: en.defaultActive }).getAttribute('aria-checked')).toBe('true')
    expect(within(dialog).getByText(en.defaultActiveHint)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('switch', { name: en.defaultActive }))
    const calls = within(dialog).getByLabelText(en.toolPolicy) as HTMLSelectElement
    expect(calls.value).toBe('ask')
    expect([...calls.options].map(option => option.textContent)).toEqual([en.modeAsk, en.modeAllow, en.modeDeny])
    fireEvent.change(calls, { target: { value: 'deny' } })
    fireEvent.click(save)

    const confirm = await screen.findByRole('dialog', { name: en.confirmTitle })
    expect(within(confirm).getByText('run --flag')).toBeTruthy()
    const action = within(confirm).getByRole('button', { name: en.confirmAction })
    expect(action).toHaveProperty('disabled', true)
    fireEvent.click(within(confirm).getByLabelText(en.confirmAcknowledge))
    fireEvent.click(action)

    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(mcpServers.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ transport: 'stdio', serverName: 'new', command: 'run', args: ['--flag'], cwd: '/work', toolCallTimeoutMs: 5000, failOnStartupError: true, defaultActive: false,
        toolPolicy: { default: 'deny', tools: {} },
      }),
      { confirmedCommand: 'run --flag' },
    )
  })

  it('goes back to the form when the command is not trusted', async () => {
    const { mcpServers } = mount([])
    mcpServers.upsert.mockResolvedValueOnce({
      ok: true, value: { changed: false, application: 'failed', target: 'x', error: { code: 'confirmation-required', message: 'c', command: 'run' } },
    } as never)
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText(en.command), { target: { value: 'run' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    const confirm = await screen.findByRole('dialog', { name: en.confirmTitle })
    fireEvent.click(within(confirm).getByRole('button', { name: en.cancel }))
    expect(await screen.findByRole('dialog', { name: en.addTitle })).toBeTruthy()
  })

  it('adds an HTTP server with a bearer variable and a text header', async () => {
    const { mcpServers } = mount([])
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    // Only a local command has an environment to explain.
    expect(screen.getByText(en.envNote)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: en.transportHttp }))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'web' } })
    fireEvent.change(screen.getByLabelText(en.url), { target: { value: 'https://example.test/mcp' } })
    expect(screen.getByText(en.headers)).toBeTruthy()
    expect(screen.queryByText(en.envNote)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.addValue }))
    fireEvent.change(screen.getByLabelText(en.valueName), { target: { value: 'Authorization' } })
    fireEvent.change(screen.getByLabelText(en.valueKind), { target: { value: 'bearer' } })
    expect(screen.getByText(en.hintBearer)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.valueText), { target: { value: 'WEB_TOKEN' } })
    fireEvent.click(screen.getByRole('button', { name: en.addValue }))
    const [, second] = screen.getAllByLabelText(en.valueName)
    fireEvent.change(second as HTMLElement, { target: { value: 'X-Team' } })
    fireEvent.change(screen.getAllByLabelText(en.valueKind)[1] as HTMLElement, { target: { value: 'literal' } })
    fireEvent.change(screen.getAllByLabelText(en.valueText)[1] as HTMLElement, { target: { value: 'core' } })
    fireEvent.click(screen.getAllByRole('button', { name: en.removeValue })[1] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => { expect(mcpServers.upsert).toHaveBeenCalled() })
    expect(mcpServers.upsert.mock.calls[0]?.[0]).toEqual({
      transport: 'streamable-http', serverName: 'web', url: 'https://example.test/mcp',
      headers: { Authorization: { kind: 'env', name: 'WEB_TOKEN', scheme: 'Bearer' } },
    })
  })

  it('edits a server in place, keeping a stored value and locking its type', async () => {
    const { mcpServers } = mount([files])
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    const dialog = screen.getByRole('dialog', { name: en.editTitle })
    expect(within(dialog).getByLabelText(en.serverName)).toHaveProperty('value', 'files')
    expect(within(dialog).getAllByRole('tab')[0]).toHaveProperty('disabled', true)
    expect(within(dialog).getByText(en.hintKept)).toBeTruthy()
    expect(within(dialog).getByText(en.hintEnv)).toBeTruthy()
    const stored = within(dialog).getAllByLabelText(en.valueText)[1] as HTMLInputElement
    expect(stored.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(en.args), { target: { value: '--root\n/srv' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
    await waitFor(() => { expect(mcpServers.upsert).toHaveBeenCalled() })
    expect(mcpServers.upsert.mock.calls[0]?.[1]).toEqual({ id: 'mcp-files' })
    expect(mcpServers.upsert.mock.calls[0]?.[0]).toMatchObject({ args: ['--root', '/srv'], env: { STORED: { kind: 'kept' } } })
  })

  it('shows an expression value with its hint', async () => {
    mount([row('x', { serverName: 'x', spec: { ...stdioSpec, env: { CALC: { kind: 'expression', source: 'process.cwd()' } } } })])
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    expect(screen.getByText(en.hintExpression)).toBeTruthy()
  })

  it.each([
    ['invalid-config', 'errorInvalid'], ['duplicate-server', 'errorDuplicate'], ['literal-secret', 'errorSecret'],
    ['read-only', 'errorReadOnly'], ['unknown-server', 'errorUnknown'], ['unreadable-patch', 'errorPatch'],
    ['operation-error', 'errorOperation'],
  ] as const)('explains a %s refusal in the form with the Host\'s detail', async (code, key) => {
    const { mcpServers } = mount([])
    mcpServers.upsert.mockResolvedValueOnce({
      ok: true, value: { changed: false, application: 'failed', target: 'x', error: { code, message: 'host detail' } },
    } as never)
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText(en.command), { target: { value: 'run' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(en[key])
    expect(alert.textContent).toContain('host detail')
  })

  it('explains a local timeout error without a detail', async () => {
    mount([])
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText(en.command), { target: { value: 'run' } })
    fireEvent.change(screen.getByLabelText(en.timeout), { target: { value: 'soon' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.errorTimeout)
  })

  it('blocks a second save and shows progress while the Host works', async () => {
    const { mcpServers } = mount([])
    const pending = Promise.withResolvers<{ ok: true; value: McpChangeResult }>()
    mcpServers.upsert.mockReturnValueOnce(pending.promise)
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText(en.command), { target: { value: 'run' } })
    const form = document.querySelector('form') as HTMLFormElement
    expect(fireEvent.submit(form)).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    const saving = await screen.findByRole('button', { name: en.saving })
    expect(saving).toHaveProperty('disabled', true)
    pending.resolve({ ok: true, value: applied })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('shows progress on the confirmation while the trusted command is saved', async () => {
    const { mcpServers } = mount([])
    mcpServers.upsert.mockResolvedValueOnce({
      ok: true, value: { changed: false, application: 'failed', target: 'x', error: { code: 'confirmation-required', message: 'c', command: 'run' } },
    } as never)
    const pending = Promise.withResolvers<{ ok: true; value: McpChangeResult }>()
    mcpServers.upsert.mockReturnValueOnce(pending.promise)
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText(en.command), { target: { value: 'run' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    const confirm = await screen.findByRole('dialog', { name: en.confirmTitle })
    fireEvent.click(within(confirm).getByLabelText(en.confirmAcknowledge))
    fireEvent.click(within(confirm).getByRole('button', { name: en.confirmAction }))
    expect(await within(screen.getByRole('dialog')).findByRole('button', { name: en.saving })).toHaveProperty('disabled', true)
    pending.resolve({ ok: true, value: applied })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('closes the form without saving', async () => {
    const { mcpServers } = mount([])
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mcpServers.upsert).not.toHaveBeenCalled()
  })

  it('removes a server after confirmation, and cancels', async () => {
    const { mcpServers } = mount([files])
    fireEvent.click(await screen.findByRole('button', { name: en.remove }))
    const dialog = screen.getByRole('dialog', { name: en.removeTitle })
    expect(within(dialog).getByText('files')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.removeAction }))
    await waitFor(() => { expect(mcpServers.removeServer).toHaveBeenCalledWith('mcp-files') })
  })

  it('names a server without a name by its row id in the removal dialog', async () => {
    mount([row('bare', { serverName: '' })])
    fireEvent.click(await screen.findByRole('button', { name: en.remove }))
    expect(within(screen.getByRole('dialog')).getByText('bare')).toBeTruthy()
  })
})

describe('McpServersToast', () => {
  function mountToast(notice: McpServersState['notice']) {
    const store = createSnapshotStore<McpServersState>({
      status: 'ready', rows: [], pending: null, editor: null, removal: null, tools: null, notice, statusItem: true, statusItemWritable: true,
    })
    const dismissNotice = vi.fn()
    const props = { dismissNotice, t, useMcpServers: bindSnapshotSelector(store) } as McpServersToastProps
    return { ...render(<McpServersToast {...props} />), dismissNotice }
  }

  it('renders nothing while there is nothing to report', () => {
    expect(mountToast(null).container.textContent).toBe('')
  })

  it.each([
    ['saved', false, en.noticeSaved], ['saved', true, en.noticeRestart], ['removed', false, en.noticeRemoved],
    ['enabled', false, en.noticeEnabled], ['enabled', true, en.noticeRestart], ['disabled', false, en.noticeDisabled],
    ['failed', false, en.noticeFailed], ['refresh-failed', false, en.noticeRefreshFailed], ['failed', true, en.noticeFailed],
  ] as const)('reports %s (restart %s) with its own sentence', (kind, restart, text) => {
    mountToast({ kind, restart, seq: 1 })
    expect(screen.getByText(text)).toBeTruthy()
  })
})

describe('connection state and tools', () => {
  const live = (state: McpServerStatus['state'], rest: Partial<McpServerStatus> = {}, info: Partial<McpServerInfo> = {}) =>
    row('mcp-files', { serverName: 'files', spec: stdioSpec, status: { ...connected, state, ...rest }, ...info })

  it('shows each connection state, the attempt count, and the last error', async () => {
    mount([
      live('connected'),
      row('mcp-b', { serverName: 'b', status: { ...connected, state: 'connecting' } }),
      row('mcp-c', { serverName: 'c', status: { ...connected, state: 'reconnecting', attempt: 2, error: 'refused' } }),
      row('mcp-d', { serverName: 'd', status: { ...connected, state: 'failed', attempt: 10, error: 'gave up', toolCount: 0 } }),
    ])
    expect(await screen.findByText(en.stateConnected)).toBeTruthy()
    expect(screen.getByText(en.stateConnecting)).toBeTruthy()
    expect(screen.getByText('Reconnecting (2/10)')).toBeTruthy()
    expect(screen.getByText(en.stateFailed)).toBeTruthy()
    expect(screen.getByText('refused')).toBeTruthy()
    expect(screen.getByText('gave up')).toBeTruthy()
    expect(screen.queryByText(en.statusNote)).toBeNull()
  })

  it('does not show an old error once the server is connected, nor a state for a disabled row', async () => {
    mount([live('connected', { error: 'stale' }), row('mcp-off', { serverName: 'off', enabled: false, status: { ...connected, state: 'connected' } })])
    expect(await screen.findByText(en.stateConnected)).toBeTruthy()
    expect(screen.queryByText('stale')).toBeNull()
    expect(screen.getByText(en.phaseOff)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Tools/ })).toHaveLength(1)
  })

  it('keeps the plugin phase and its note for a row whose client reports no status', async () => {
    mount([files])
    expect(await screen.findByText(en.phaseLoaded)).toBeTruthy()
    expect(screen.getByText(en.statusNote)).toBeTruthy()
  })

  it('offers reconnect only while not connected, and asks the Host', async () => {
    const { mcpServers } = mount([live('connected'), row('mcp-c', { serverName: 'c', status: { ...connected, state: 'failed', toolCount: 0 } })])
    const buttons = await screen.findAllByRole('button', { name: en.reconnect })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0] as HTMLElement)
    await waitFor(() => { expect(mcpServers.reconnectServer).toHaveBeenCalledWith('mcp-c') })
  })

  it('also offers reconnect while a retry is waiting', async () => {
    mount([row('mcp-c', { serverName: 'c', status: { ...connected, state: 'reconnecting', attempt: 1, toolCount: 0 } })])
    expect(await screen.findByRole('button', { name: en.reconnect })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Tools/ })).toBeNull()
  })

  it('opens the tools dialog with each tool collapsed and expands one to its help', async () => {
    const { mcpServers } = mount([live('connected')])
    mcpServers.tools.mockResolvedValue({ ok: true, value: { tools: [echo, search], status: connected } })
    fireEvent.click(await screen.findByRole('button', { name: 'Tools (2)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tools of files' })
    expect(await within(dialog).findByText('mcp__files__echo')).toBeTruthy()
    expect(within(dialog).getByText(en.toolsIntro)).toBeTruthy()
    // Collapsed: only the first line shows beside the name.
    const echoDetails = within(dialog).getByText('mcp__files__echo').closest('details') as HTMLDetailsElement
    expect(echoDetails.open).toBe(false)
    expect(within(dialog).getByText('Echo it back.')).toBeTruthy()

    fireEvent.click(within(dialog).getByText('mcp__files__echo'))
    expect(echoDetails.open).toBe(true)
    expect(within(dialog).getByText(en.toolNoParameters)).toBeTruthy()

    const searchDetails = within(dialog).getByText('mcp__files__search').closest('details') as HTMLDetailsElement
    fireEvent.click(within(dialog).getByText('mcp__files__search'))
    expect(searchDetails.open).toBe(true)
    expect(within(dialog).getByText(en.toolNoDescription)).toBeTruthy()
    expect(within(dialog).getByText('query')).toBeTruthy()
    expect(within(dialog).getByText(en.paramRequired)).toBeTruthy()
    expect(within(dialog).getByText(en.paramOptional)).toBeTruthy()
    expect(within(dialog).getByText('What to find')).toBeTruthy()
  })

  it('filters the tools by name or description and says when none match', async () => {
    const { mcpServers } = mount([live('connected')])
    mcpServers.tools.mockResolvedValue({ ok: true, value: { tools: [echo, search], status: connected } })
    fireEvent.click(await screen.findByRole('button', { name: 'Tools (2)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tools of files' })
    const filter = await within(dialog).findByLabelText(en.toolsFilter)
    fireEvent.change(filter, { target: { value: 'SEARCH' } })
    expect(within(dialog).queryByText('mcp__files__echo')).toBeNull()
    expect(within(dialog).getByText('mcp__files__search')).toBeTruthy()
    fireEvent.change(filter, { target: { value: 'second line' } })
    expect(within(dialog).getByText('mcp__files__echo')).toBeTruthy()
    fireEvent.change(filter, { target: { value: 'zzz' } })
    expect(within(dialog).getByText(en.toolsNoMatch)).toBeTruthy()
    fireEvent.change(filter, { target: { value: ' ' } })
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows a loader, then an empty state, a failure, and closes', async () => {
    const { mcpServers } = mount([live('connected')])
    const slow = Promise.withResolvers<{ ok: true; value: { tools: McpToolInfo[]; status: McpServerStatus } }>()
    mcpServers.tools.mockReturnValueOnce(slow.promise)
    fireEvent.click(await screen.findByRole('button', { name: 'Tools (2)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tools of files' })
    expect(within(dialog).getByRole('status')).toBeTruthy()
    slow.resolve({ ok: true, value: { tools: [], status: connected } })
    expect(await within(dialog).findByText(en.toolsEmpty)).toBeTruthy()
    fireEvent.click(within(dialog).getAllByRole('button', { name: en.close }).at(-1) as HTMLElement)
    expect(screen.queryByRole('dialog')).toBeNull()

    mcpServers.tools.mockResolvedValueOnce({ ok: false, error: new Error('down') } as never)
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.toolsFailed)
  })

  it('names a server without a name by its row id in the tools dialog', async () => {
    mount([row('bare', { serverName: '', status: connected })])
    fireEvent.click(await screen.findByRole('button', { name: 'Tools (2)' }))
    expect(await screen.findByRole('dialog', { name: 'Tools of bare' })).toBeTruthy()
  })
})

describe('status item preference switch', () => {
  it('reflects the accepted preference and writes a change through the form', async () => {
    const { settings } = mount([])
    const toggle = await screen.findByRole('switch', { name: en.statusItemToggle })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() => { expect(settings.set).toHaveBeenCalledWith('statusItem', false) })
  })

  it('locks the switch while the settings document cannot be written', async () => {
    const { settings } = mount([])
    settings.publish({ value: { statusItem: false }, writable: false })
    const toggle = await screen.findByRole('switch', { name: en.statusItemToggle })
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', true) })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })
})

describe('tool-call policy', () => {
  const live = (info: Partial<McpServerInfo> = {}) =>
    row('mcp-files', { serverName: 'files', spec: stdioSpec, status: connected, ...info })

  it('tags a server whose calls run without asking, or are blocked, and nothing for the default', async () => {
    mount([
      live(),
      row('mcp-open', { serverName: 'open', toolPolicy: { default: 'allow', tools: {} } }),
      row('mcp-shut', { serverName: 'shut', toolPolicy: { default: 'deny', tools: {} } }),
    ])
    const tags = (name: string): string => (screen.getByText(name, { selector: 'span' }).closest('li')?.textContent ?? '')
    await screen.findByText('open')
    expect(tags('open')).toContain(en.rowCallsAllowed)
    expect(tags('shut')).toContain(en.rowCallsBlocked)
    expect(tags('files')).not.toContain(en.rowCallsAllowed)
    expect(tags('files')).not.toContain(en.rowCallsBlocked)
  })

  it('shows each tool\'s mode and gives one tool its own mode or returns it to the server default', async () => {
    const { mcpServers } = mount([live({ toolPolicy: { default: 'ask', tools: { search: 'allow' } } })])
    mcpServers.tools.mockResolvedValue({ ok: true, value: { tools: [echo, search], status: connected } })
    fireEvent.click(await screen.findByRole('button', { name: 'Tools (2)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tools of files' })
    const echoRow = (await within(dialog).findByText('mcp__files__echo')).closest('li') as HTMLElement
    const searchRow = within(dialog).getByText('mcp__files__search').closest('li') as HTMLElement
    // The collapsed row names the mode the tool runs under.
    expect(echoRow.querySelector('summary')?.textContent).toContain(en.modeAsk)
    expect(searchRow.querySelector('summary')?.textContent).toContain(en.modeAllow)

    const echoMode = within(echoRow).getByLabelText(en.toolMode) as HTMLSelectElement
    expect(echoMode.value).toBe('inherit')
    expect(echoMode.options[0]?.textContent).toBe('Server default (Ask first)')
    fireEvent.change(echoMode, { target: { value: 'deny' } })
    expect(mcpServers.setToolPolicy).toHaveBeenLastCalledWith('mcp-files', { default: 'ask', tools: { search: 'allow', echo: 'deny' } })
    await waitFor(() => { expect(mcpServers.list).toHaveBeenCalledTimes(2) })

    fireEvent.change(within(searchRow).getByLabelText(en.toolMode), { target: { value: 'inherit' } })
    await waitFor(() => { expect(mcpServers.setToolPolicy).toHaveBeenLastCalledWith('mcp-files', { default: 'ask', tools: {} }) })
  })

  it('shows the modes of a server whose policy is set elsewhere without letting them change', async () => {
    const { mcpServers } = mount([row('mcp-files', { serverName: 'files', status: connected, owned: false, readOnlyReason: 'unaddressable' })])
    fireEvent.click(await screen.findByRole('button', { name: 'Tools (2)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tools of files' })
    await within(dialog).findByText('mcp__files__echo')
    expect(within(dialog).getByText(en.toolsPolicyReadOnly)).toBeTruthy()
    const mode = within(dialog).getByLabelText(en.toolMode) as HTMLSelectElement
    expect(mode.disabled).toBe(true)
    fireEvent.change(mode, { target: { value: 'allow' } })
    expect(mcpServers.setToolPolicy).not.toHaveBeenCalled()
  })
})
