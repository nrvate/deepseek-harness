// @vitest-environment jsdom
/** The MCP servers page as the Plugins page renders it, driven through the real controller over a scripted Host. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { McpToolInfo } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { McpServersCard, type McpServersCardProps } from '../src/client/McpServersCard.tsx'
import { McpServersToast, type McpServersToastProps } from '../src/client/McpServersToast.tsx'
import { McpServersController, type McpServersState } from '../src/client/mcp-servers-controller.ts'
import { en } from '../src/client/locales.ts'
import { connected, fakeHost, refused, view, type HostSeed } from './fake-host.client.ts'

afterEach(cleanup)

const t = makeTranslate(en) as McpServersCardProps['t']

const files = { transport: 'stdio', command: 'mcp-files', args: ['--root', '/tmp'], env: { TOKEN: '${credential:FILES_TOKEN}' }, enabled: true }
const web = { transport: 'streamable-http', url: 'https://example.test/mcp', headers: {}, enabled: false }

const echo: McpToolInfo = { name: 'echo', publicName: 'mcp__files__echo', description: 'Echo it back.\nSecond line.', parameters: [] }
const search: McpToolInfo = {
  name: 'search', publicName: 'mcp__files__search', description: '',
  parameters: [
    { name: 'query', type: 'string', required: true, description: 'What to find' },
    { name: 'limit', type: 'integer', required: false, description: '' },
  ],
}

function mount(seed: HostSeed = { user: { files }, base: { web } }, pageView: 'page' | 'summary' = 'page') {
  const host = fakeHost(seed)
  const controller = new McpServersController(host.ctx, host.form.scope, host.fleet)
  const { hooks, ...actions } = controller.inject()
  const props = { ...actions, view: pageView, t, useMcpServers: bindSnapshotSelector(hooks.mcpServers) } as McpServersCardProps
  const rendered = render(<McpServersCard {...props} />)
  return { ...rendered, ...host, controller }
}

/** The list row of one server. */
async function rowOf(name: string): Promise<HTMLElement> {
  const label = await screen.findByText(name, { selector: 'span' })
  return label.closest('li') as HTMLElement
}

describe('McpServersCard', () => {
  it('renders its one-liner alone in the summary view', () => {
    mount({}, 'summary')
    expect(document.body.textContent).toBe(en.description)
  })

  it('shows a loader while the first read is in flight, then an empty state', async () => {
    mount({})
    expect(screen.getByRole('status')).toBeTruthy()
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('offers a retry when the first read fails, and explains a profile without the manager', async () => {
    const first = fakeHost({})
    first.settings.describe.mockResolvedValueOnce(refused('down') as never)
    const controller = new McpServersController(first.ctx, first.form.scope, first.fleet)
    const { hooks, ...actions } = controller.inject()
    render(<McpServersCard {...{ ...actions, view: 'page', t, useMcpServers: bindSnapshotSelector(hooks.mcpServers) } as McpServersCardProps} />)
    expect((await screen.findByRole('alert')).textContent).toContain(en.loadFailed)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByText(en.empty)).toBeTruthy()
    cleanup()
    mount({ manager: false })
    expect(await screen.findByText(en.managerMissing)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.add }).disabled).toBe(true)
  })

  it('lists each server with its type, summary, origin, and live state', async () => {
    const { publish } = mount({ user: { files, web: { enabled: true } }, base: { web, inherited: web } })
    publish([
      view('files', { state: 'reconnecting', attempt: 2, maxAttempts: 5, nextRetryAtMs: Date.now() + 30_000, lastError: 'ECONNREFUSED' }),
      view('web', connected(2)),
      view('inherited', { state: 'disabled' }),
      view('plugged', { state: 'waiting-credentials', lastError: 'credential EXAMPLE_TOKEN is not set' }),
    ])
    const filesRow = await rowOf('files')
    expect(within(filesRow).getByText(en.transportStdio)).toBeTruthy()
    expect(within(filesRow).getByText('mcp-files --root /tmp')).toBeTruthy()
    await waitFor(() => { expect(within(filesRow).getByText(/^Reconnecting \(2\/5\), next try in/)).toBeTruthy() })
    expect(within(filesRow).getByText('ECONNREFUSED')).toBeTruthy()
    const webRow = await rowOf('web')
    expect(within(webRow).getByText(en.sourceOverridden)).toBeTruthy()
    expect(within(webRow).getByText(en.stateConnected)).toBeTruthy()
    expect(within(webRow).getByRole('button', { name: en.restore })).toBeTruthy()
    expect(within(await rowOf('inherited')).getByText(en.sourceInherited)).toBeTruthy()
    expect(within(await rowOf('inherited')).queryByRole('button', { name: en.remove })).toBeNull()
    const plugged = await rowOf('plugged')
    expect(within(plugged).getByText(en.sourcePlugin)).toBeTruthy()
    expect(within(plugged).getByText(en.stateWaitingCredentials)).toBeTruthy()
    // A plugin's server has no entry here: no switch and no edit.
    expect(within(plugged).queryByRole('switch')).toBeNull()
    expect(within(plugged).queryByRole('button', { name: en.edit })).toBeNull()
    expect(within(plugged).getByRole('button', { name: en.reconnect })).toBeTruthy()
  })

  it('shows a server the manager has not listed yet as loading, or off when its entry is disabled', async () => {
    mount()
    expect(within(await rowOf('files')).getByText(en.phaseLoading)).toBeTruthy()
    expect(within(await rowOf('web')).getByText(en.phaseOff)).toBeTruthy()
  })

  it('locks every change control while Settings is read-only', async () => {
    mount({ user: { files }, writable: false })
    const filesRow = await rowOf('files')
    expect(within(filesRow).getByRole<HTMLInputElement>('switch').disabled).toBe(true)
    expect(within(filesRow).queryByRole('button', { name: en.edit })).toBeNull()
    expect(within(filesRow).queryByRole('button', { name: en.remove })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.add }).disabled).toBe(true)
  })

  it('toggles a server from its switch', async () => {
    const { user } = mount()
    fireEvent.click(within(await rowOf('web')).getByRole('switch'))
    await waitFor(() => { expect(user('mcp-manager')?.servers).toMatchObject({ web: { enabled: true } }) })
  })

  it('adds a local server with a stored credential after the person trusts its command', async () => {
    const { user, credentials } = mount()
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    const dialog = await screen.findByRole('dialog', { name: en.addTitle })
    fireEvent.change(within(dialog).getByLabelText(en.serverName), { target: { value: 'git' } })
    fireEvent.change(within(dialog).getByLabelText(en.command), { target: { value: 'npx' } })
    fireEvent.change(within(dialog).getByLabelText(en.args), { target: { value: 'server-github' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.addValue }))
    fireEvent.change(within(dialog).getByLabelText(en.valueName), { target: { value: 'TOKEN' } })
    fireEvent.change(within(dialog).getByLabelText(en.valueKind), { target: { value: 'credential' } })
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.valueRef).value).toBe('MCP_GIT_TOKEN')
    expect(within(dialog).getByText(en.hintCredential)).toBeTruthy()
    await waitFor(() => { expect(within(dialog).getByText(en.secretMissing)).toBeTruthy() })
    fireEvent.change(within(dialog).getByLabelText(en.valueSecret), { target: { value: 'ghp_x' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
    const confirm = await screen.findByRole('dialog', { name: en.confirmTitle })
    expect(within(confirm).getByText('npx server-github')).toBeTruthy()
    const action = within(confirm).getByRole('button', { name: en.confirmAction }) as HTMLButtonElement
    expect(action.disabled).toBe(true)
    fireEvent.click(within(confirm).getByRole('checkbox', { name: en.confirmAcknowledge }))
    fireEvent.click(action)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(credentials.set).toHaveBeenCalledWith('MCP_GIT_TOKEN', 'ghp_x')
    expect(user('mcp-manager')?.servers).toMatchObject({ git: { command: 'npx', args: ['server-github'], env: { TOKEN: '${credential:MCP_GIT_TOKEN}' } } })
    expect(await rowOf('git')).toBeTruthy()
  })

  it('edits a server in place with its name and type locked, and shows a stored credential', async () => {
    mount({ user: { files }, stored: ['FILES_TOKEN'] })
    fireEvent.click(within(await rowOf('files')).getByRole('button', { name: en.edit }))
    const dialog = await screen.findByRole('dialog', { name: en.editTitle })
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.serverName).disabled).toBe(true)
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.valueRef).value).toBe('FILES_TOKEN')
    await waitFor(() => { expect(within(dialog).getByText(en.secretStored)).toBeTruthy() })
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.valueSecret).placeholder).toBe(en.secretKeep)
    fireEvent.click(within(dialog).getByRole('button', { name: en.cancel }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('shows the Host\'s refusal beside the localized sentence', async () => {
    const { settings } = mount()
    settings.mutate.mockResolvedValueOnce(refused('servers.web: bad template'))
    fireEvent.click(within(await rowOf('web')).getByRole('button', { name: en.edit }))
    const dialog = await screen.findByRole('dialog', { name: en.editTitle })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain(en.errorOperation)
    expect(alert.textContent).toContain('servers.web: bad template')
  })

  it('removes a server added here, and restores an overridden one', async () => {
    const { user } = mount({ user: { files, web: { enabled: true } }, base: { web } })
    fireEvent.click(within(await rowOf('web')).getByRole('button', { name: en.restore }))
    const restore = await screen.findByRole('dialog', { name: en.restoreTitle })
    expect(within(restore).getByText(en.restoreBody)).toBeTruthy()
    fireEvent.click(within(restore).getByRole('button', { name: en.restoreAction }))
    await waitFor(() => { expect(user('mcp-manager')?.servers).toEqual({ files }) })
    fireEvent.click(within(await rowOf('files')).getByRole('button', { name: en.remove }))
    const remove = await screen.findByRole('dialog', { name: en.removeTitle })
    fireEvent.click(within(remove).getByRole('button', { name: en.removeAction }))
    await waitFor(() => { expect(user('mcp-manager')?.servers).toEqual({}) })
  })

  it('tests a server and shows what it reported', async () => {
    const { mcpManager } = mount()
    fireEvent.click(within(await rowOf('web')).getByRole('button', { name: en.probe }))
    const dialog = await screen.findByRole('dialog', { name: 'Test web' })
    expect(await within(dialog).findByText('Connected to files-server 1.2.0 and listed its tools in 42 ms.')).toBeTruthy()
    expect(within(dialog).getByText('echo, search')).toBeTruthy()
    mcpManager.probe.mockResolvedValueOnce({ ok: true, value: { ok: false, stage: 'connect', message: 'spawn ENOENT', durationMs: 5, closeConfirmed: false } } as never)
    // The modal's header and its footer both offer Close.
    fireEvent.click(within(dialog).getAllByRole('button', { name: en.close })[0]!)
    fireEvent.click(within(await rowOf('files')).getByRole('button', { name: en.probe }))
    const failed = await screen.findByRole('dialog', { name: 'Test files' })
    expect((await within(failed).findByRole('alert')).textContent).toContain('spawn ENOENT')
    expect(within(failed).getByText(en.probeCleanup)).toBeTruthy()
  })

  it('offers restart only when it can help, and asks the manager', async () => {
    const { publish, mcpManager } = mount()
    publish([view('files', connected(1)), view('web', { state: 'failed', reason: 'gave-up', lastError: 'refused' })])
    await waitFor(() => { expect(within(screen.getByText('web', { selector: 'span' }).closest('li')!).getByText(en.stateFailed)).toBeTruthy() })
    expect(within(await rowOf('files')).queryByRole('button', { name: en.reconnect })).toBeNull()
    fireEvent.click(within(await rowOf('web')).getByRole('button', { name: en.reconnect }))
    await waitFor(() => { expect(mcpManager.restart).toHaveBeenCalledWith('web') })
  })
})

describe('McpServersToast', () => {
  function toast(notice: McpServersState['notice']) {
    const store = createSnapshotStore({ notice } as McpServersState)
    const dismissNotice = vi.fn()
    const props = { t, dismissNotice, useMcpServers: bindSnapshotSelector(store) } as McpServersToastProps
    return { ...render(<McpServersToast {...props} />), dismissNotice }
  }

  it('reports an outcome, and a failure with the Host\'s explanation', () => {
    toast({ kind: 'restored', detail: '', seq: 1 })
    expect(screen.getByText(en.noticeRestored)).toBeTruthy()
    cleanup()
    toast({ kind: 'failed', detail: 'read-only', seq: 2 })
    expect(screen.getByText('The change was not saved: read-only')).toBeTruthy()
  })

  it('renders nothing while there is nothing to report', () => {
    const { container } = toast(null)
    expect(container.textContent).toBe('')
  })
})

describe('tools and tool-call policy', () => {
  async function openTools(seed: HostSeed) {
    const made = mount(seed)
    made.publish([view('files', connected(2))])
    fireEvent.click(within(await rowOf('files')).getByRole('button', { name: 'Tools (2)' }))
    return { ...made, dialog: await screen.findByRole('dialog', { name: 'Tools of files' }) }
  }

  it('opens the tools dialog with each tool collapsed and expands one to its help', async () => {
    const { dialog } = await openTools({ user: { files }, tools: [echo, search] })
    expect(await within(dialog).findByText('mcp__files__echo')).toBeTruthy()
    expect(within(dialog).getByText('Echo it back.')).toBeTruthy()
    fireEvent.click(within(dialog).getByText('mcp__files__search'))
    expect(within(dialog).getByText('What to find')).toBeTruthy()
    expect(within(dialog).getByText(en.paramRequired)).toBeTruthy()
  })

  it('filters the tools and says when none match', async () => {
    const { dialog } = await openTools({ user: { files }, tools: [echo, search] })
    fireEvent.change(await within(dialog).findByLabelText(en.toolsFilter), { target: { value: 'zzz' } })
    expect(within(dialog).getByText(en.toolsNoMatch)).toBeTruthy()
  })

  it('tags a server whose calls run without asking, or are blocked', async () => {
    mount({ user: { files, web }, policies: { files: { default: 'allow', tools: {} }, web: { default: 'deny', tools: {} } } })
    expect(within(await rowOf('files')).getByText(en.rowCallsAllowed)).toBeTruthy()
    expect(within(await rowOf('web')).getByText(en.rowCallsBlocked)).toBeTruthy()
  })

  it('gives one tool its own mode in the policy store', async () => {
    const { dialog, user } = await openTools({ user: { files }, tools: [echo] })
    fireEvent.click(await within(dialog).findByText('mcp__files__echo'))
    fireEvent.change(within(dialog).getByLabelText(en.toolMode), { target: { value: 'deny' } })
    await waitFor(() => { expect(user('mcp-policy')).toEqual({ servers: { files: { default: 'ask', tools: { echo: 'deny' } } } }) })
  })

  it('shows the modes without letting them change while Settings is read-only', async () => {
    const { dialog } = await openTools({ user: { files }, tools: [echo], writable: false })
    fireEvent.click(await within(dialog).findByText('mcp__files__echo'))
    expect(within(dialog).getByText(en.toolsPolicyReadOnly)).toBeTruthy()
    expect(within(dialog).getByLabelText<HTMLSelectElement>(en.toolMode).disabled).toBe(true)
  })
})

describe('status item preference switch', () => {
  it('reflects the accepted preference and writes a change through the form', async () => {
    const { form } = mount()
    const toggle = await screen.findByRole('switch', { name: en.statusItemToggle })
    fireEvent.click(toggle)
    await waitFor(() => { expect(form.set).toHaveBeenCalledWith('statusItem', false) })
  })
})
