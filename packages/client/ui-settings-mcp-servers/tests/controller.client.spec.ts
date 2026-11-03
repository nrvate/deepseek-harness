/**
 * The page's state over a scripted Host: Settings entries joined with live status, the editor, secrets, toggles,
 * removal, restart, and probes.
 */
import { describe, expect, it, vi } from 'vitest'
import type { McpManagedServerView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  draftFromRow, emptyDraft, entryFromDraft, joinRows, McpServersController, type McpServersFace,
} from '../src/client/mcp-servers-controller.ts'
import { commandLine, draftValue, parseEntry, parsePolicy, storedValue, suggestRef } from '../src/client/entries.ts'
import { connected, fakeHost, refused, view, type HostSeed } from './fake-host.client.ts'

const files = { transport: 'stdio', command: 'mcp-files', args: ['--root', '/tmp'], env: { TOKEN: '${credential:FILES_TOKEN}', LOG: 'debug' }, enabled: true }
const web = { transport: 'streamable-http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer ${credential:WEB}' }, enabled: false, reconnect: { maxAttempts: 3 } }

function bench(seed: HostSeed = { user: { files }, base: { web } }) {
  const host = fakeHost(seed)
  const controller = new McpServersController(host.ctx, host.form.scope, host.fleet)
  const face: McpServersFace = controller.inject()
  return { ...host, controller, face }
}

async function loaded(seed?: HostSeed) {
  const made = bench(seed)
  made.face.load()
  await vi.waitFor(() => { expect(made.controller.getSnapshot().status).toBe('ready') })
  return made
}

describe('entries', () => {
  it('reads an entry defensively and keeps the stored object for later saves', () => {
    expect(parseEntry({ transport: 'stdio', command: 'x', args: ['a', 1], env: { A: 'b', N: 2 } })).toMatchObject({
      transport: 'stdio', command: 'x', args: ['a'], env: { A: 'b' }, cwd: '', url: '', headers: {}, enabled: true,
    })
    expect(parseEntry({ transport: 'sse' })).toBeUndefined()
    expect(parseEntry('text')).toBeUndefined()
  })

  it('reads a policy, asking first when the store holds none or a mode is unknown', () => {
    expect(parsePolicy(undefined)).toEqual({ default: 'ask', tools: {} })
    expect(parsePolicy({ default: 'allow', tools: { a: 'deny', b: 'maybe' } })).toEqual({ default: 'allow', tools: { a: 'deny' } })
  })

  it('stages credential templates as credentials and writes them back unchanged', () => {
    const whole = draftValue(1, 'TOKEN', '${credential:FILES_TOKEN}')
    const bearer = draftValue(2, 'Authorization', 'Bearer ${credential:WEB}')
    const literal = draftValue(3, 'LOG', 'prefix ${credential:X}')
    expect([whole.mode, bearer.mode, literal.mode]).toEqual(['credential', 'bearer', 'literal'])
    expect([storedValue(whole), storedValue(bearer), storedValue(literal)]).toEqual(['${credential:FILES_TOKEN}', 'Bearer ${credential:WEB}', 'prefix ${credential:X}'])
  })

  it('suggests a reference from the server and the value name, and quotes a command line', () => {
    expect(suggestRef('git-hub', 'api.key')).toBe('MCP_GIT_HUB_API_KEY')
    expect(commandLine('npx', ['-y', 'a b', 'it\'s'])).toBe('npx -y \'a b\' \'it\'\\\'\'s\'')
  })
})

describe('joining Settings with the manager', () => {
  it('lists user, inherited, overridden, plugin, and removed servers with their policy and default', () => {
    const rows = joinRows({
      writable: true,
      manager: { ns: 'mcp-manager', value: { servers: { a: files, b: web, c: web } }, base: { servers: { b: web, c: web } }, user: { servers: { a: files, c: { enabled: true } } } } as never,
      policy: { ns: 'mcp-policy', value: { servers: { a: { default: 'allow', tools: {} } } } } as never,
      selection: { ns: 'mcp-selection', value: { defaultActive: { b: false } } } as never,
    }, [view('a'), view('plugged'), view('gone', { state: 'failed', reason: 'cleanup', result: { closeConfirmed: false } }, false)])
    expect(rows.map(row => [row.name, row.source, row.defaultActive, row.policy.default, row.status?.state])).toEqual([
      ['a', 'user', true, 'allow', 'connected'],
      ['b', 'inherited', false, 'ask', undefined],
      ['c', 'overridden', true, 'ask', undefined],
      ['plugged', 'plugin', true, 'ask', 'connected'],
      ['gone', 'removed', true, 'ask', 'failed'],
    ])
  })

  it('follows the manager stream after loading', async () => {
    const { controller, publish } = await loaded()
    publish([view('files', connected(3)), view('web', { state: 'disabled' })])
    // Settings lists inherited entries before the ones the user layer adds.
    await vi.waitFor(() => {
      expect(controller.getSnapshot().rows.map(row => [row.name, row.status?.state])).toEqual([['web', 'disabled'], ['files', 'connected']])
    })
  })

  it('reports a profile without the manager, and a failed first read', async () => {
    const missing = await (async () => {
      const made = bench({ manager: false })
      made.face.load()
      await vi.waitFor(() => { expect(made.controller.getSnapshot().status).toBe('missing') })
      return made
    })()
    expect(missing.controller.getSnapshot().rows).toEqual([])
    const failing = bench()
    failing.settings.describe.mockResolvedValueOnce(refused('down') as never)
    failing.face.load()
    await vi.waitFor(() => { expect(failing.controller.getSnapshot().status).toBe('failed') })
  })

  it('keeps the rows and says so when a later read fails', async () => {
    const { controller, settings } = await loaded()
    settings.describe.mockResolvedValueOnce(refused('down') as never)
    controller.refresh()
    await vi.waitFor(() => { expect(controller.getSnapshot().notice?.kind).toBe('refresh-failed') })
    expect(controller.getSnapshot().rows).toHaveLength(2)
  })

  it('does not read before the page opens', () => {
    const { controller, settings } = bench()
    controller.refresh()
    expect(settings.describe).not.toHaveBeenCalled()
  })
})

describe('editor', () => {
  it('stages a row with its credential values, timeout, policy, and default', async () => {
    const { controller } = await loaded({ user: { files: { ...files, toolCallTimeoutMs: 5000 } }, policies: { files: { default: 'deny', tools: {} } }, defaults: { files: false } })
    const row = controller.getSnapshot().rows[0]!
    const { draft, next } = draftFromRow(row, row.entry!, 10)
    expect(draft).toMatchObject({ editing: 'files', command: 'mcp-files', args: '--root\n/tmp', timeoutMs: '5000', defaultActive: false, toolPolicy: { default: 'deny' } })
    expect(draft.values.map(value => [value.uid, value.key, value.mode, value.text])).toEqual([[10, 'TOKEN', 'credential', 'FILES_TOKEN'], [11, 'LOG', 'literal', 'debug']])
    expect(next).toBe(12)
  })

  it('writes an entry that keeps the fields the form does not edit and drops the other transport\'s fields', () => {
    const draft = { ...emptyDraft(), transport: 'streamable-http' as const, url: ' https://x/mcp ', timeoutMs: '900' }
    expect(entryFromDraft(draft, { transport: 'stdio', command: 'old', args: ['a'], env: {}, cwd: '', reconnect: { maxAttempts: 2 }, enabled: false })).toEqual({
      transport: 'streamable-http', url: 'https://x/mcp', headers: {}, toolCallTimeoutMs: 900, reconnect: { maxAttempts: 2 }, enabled: false,
    })
    expect(entryFromDraft({ ...draft, timeoutMs: '1.5' }, undefined)).toBeNull()
  })

  it('adds a local server after the person trusts its command, storing the typed secret first', async () => {
    const { controller, face, settings, credentials, user } = await loaded()
    face.openAdd()
    face.editField('serverName', 'git')
    face.editField('command', 'npx')
    face.editField('args', '-y\nserver-github')
    face.addValue()
    const uid = controller.getSnapshot().editor!.draft.values[0]!.uid
    face.editValue(uid, { key: 'GITHUB_TOKEN' })
    face.editValue(uid, { mode: 'credential' })
    expect(controller.getSnapshot().editor!.draft.values[0]).toMatchObject({ mode: 'credential', text: 'MCP_GIT_GITHUB_TOKEN' })
    face.editValue(uid, { secret: 'ghp_x' })
    face.setDefaultActive(false)
    face.setToolDefault('allow')
    face.save()
    expect(controller.getSnapshot().editor?.confirm).toEqual({ command: 'npx -y server-github', acknowledged: false })
    expect(settings.mutate).not.toHaveBeenCalled()
    face.confirmSave()
    expect(settings.mutate).not.toHaveBeenCalled()
    face.acknowledge(true)
    face.confirmSave()
    await vi.waitFor(() => { expect(controller.getSnapshot().editor).toBeNull() })
    expect(credentials.set).toHaveBeenCalledWith('MCP_GIT_GITHUB_TOKEN', 'ghp_x')
    expect(user('mcp-manager')?.servers).toMatchObject({
      git: { transport: 'stdio', command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: '${credential:MCP_GIT_GITHUB_TOKEN}' }, cwd: '' },
    })
    expect(JSON.stringify(user('mcp-manager'))).not.toContain('ghp_x')
    expect(user('mcp-policy')).toEqual({ servers: { git: { default: 'allow', tools: {} } } })
    expect(user('mcp-selection')).toEqual({ defaultActive: { git: false } })
    expect(controller.getSnapshot().notice?.kind).toBe('saved')
    expect(controller.getSnapshot().rows.map(row => row.name)).toContain('git')
  })

  it('saves an unchanged local command without asking again, and an HTTP server without asking', async () => {
    const { controller, face, settings } = await loaded()
    face.openEdit('files')
    face.editField('cwd', '/srv')
    face.save()
    await vi.waitFor(() => { expect(controller.getSnapshot().editor).toBeNull() })
    face.openEdit('web')
    expect(controller.getSnapshot().editor?.draft.values[0]).toMatchObject({ mode: 'bearer', text: 'WEB' })
    face.save()
    await vi.waitFor(() => { expect(controller.getSnapshot().editor).toBeNull() })
    expect(settings.mutate).toHaveBeenCalledTimes(2)
  })

  it('refuses a bad name, a duplicate, a bad timeout, and a bad credential reference before writing', async () => {
    const { controller, face, settings } = await loaded()
    face.openAdd()
    face.editField('serverName', 'bad name')
    face.save()
    expect(controller.getSnapshot().editor?.error?.code).toBe('invalid-name')
    face.editField('serverName', 'files')
    face.save()
    expect(controller.getSnapshot().editor?.error?.code).toBe('duplicate')
    face.editField('serverName', 'new')
    face.editField('timeoutMs', 'soon')
    face.save()
    expect(controller.getSnapshot().editor?.error?.code).toBe('timeout')
    face.editField('timeoutMs', '')
    face.addValue()
    const uid = controller.getSnapshot().editor!.draft.values[0]!.uid
    face.editValue(uid, { key: 'K', mode: 'credential' })
    face.editValue(uid, { text: '9bad' })
    face.save()
    expect(controller.getSnapshot().editor?.error).toEqual({ code: 'credential-ref', detail: 'K' })
    expect(settings.mutate).not.toHaveBeenCalled()
  })

  it('shows the Host\'s refusal in the editor and keeps it open', async () => {
    const { controller, face, settings } = await loaded()
    settings.mutate.mockResolvedValueOnce(refused('servers.web: "command" is not a streamable-http field'))
    face.openEdit('web')
    face.save()
    await vi.waitFor(() => { expect(controller.getSnapshot().editor?.error?.code).toBe('refused') })
    expect(controller.getSnapshot().editor).toMatchObject({ saving: false, error: { detail: 'servers.web: "command" is not a streamable-http field' } })
  })

  it('reports which referenced credentials hold a value', async () => {
    const { controller, face } = await loaded({ user: { files }, stored: ['FILES_TOKEN'] })
    face.openEdit('files')
    await vi.waitFor(() => {
      expect(controller.getSnapshot().editor?.credentials).toEqual({ FILES_TOKEN: { configured: true, writable: true } })
    })
    const uid = controller.getSnapshot().editor!.draft.values[0]!.uid
    face.editValue(uid, { text: 'OTHER' })
    await vi.waitFor(() => {
      expect(controller.getSnapshot().editor?.credentials).toEqual({ OTHER: { configured: false, writable: true } })
    })
    face.editValue(uid, { mode: 'literal' })
    expect(controller.getSnapshot().editor?.draft.values[0]).toMatchObject({ mode: 'literal', text: '', secret: '' })
    await vi.waitFor(() => { expect(controller.getSnapshot().editor?.credentials).toEqual({}) })
    face.removeValue(uid)
    expect(controller.getSnapshot().editor?.draft.values).toHaveLength(1)
    face.closeEditor()
    expect(controller.getSnapshot().editor).toBeNull()
  })

  it('switches transport with an empty value list and cancels a confirmation', async () => {
    const { controller, face } = await loaded()
    face.openAdd()
    face.addValue()
    face.setTransport('streamable-http')
    expect(controller.getSnapshot().editor?.draft).toMatchObject({ transport: 'streamable-http', values: [] })
    face.setTransport('stdio')
    face.editField('serverName', 'x')
    face.editField('command', 'run')
    face.save()
    expect(controller.getSnapshot().editor?.confirm).not.toBeNull()
    face.cancelConfirm()
    expect(controller.getSnapshot().editor?.confirm).toBeNull()
  })
})

describe('server actions', () => {
  it('enables and disables a server through its entry, inherited ones by override', async () => {
    const { controller, face, user } = await loaded()
    face.toggle('web', true)
    await vi.waitFor(() => { expect(controller.getSnapshot().notice?.kind).toBe('enabled') })
    expect(user('mcp-manager')?.servers).toMatchObject({ web: { enabled: true } })
    expect(controller.getSnapshot().rows.find(row => row.name === 'web')).toMatchObject({ source: 'overridden', entry: { enabled: true } })
  })

  it('removes a server added here, restores an overridden one, and refuses an inherited one', async () => {
    const { controller, face, user } = await loaded({ user: { files, web: { enabled: true } }, base: { web } })
    face.askRemove('web')
    expect(controller.getSnapshot().removal?.row.source).toBe('overridden')
    face.confirmRemove()
    await vi.waitFor(() => { expect(controller.getSnapshot().notice?.kind).toBe('restored') })
    expect(controller.getSnapshot().rows.find(row => row.name === 'web')?.source).toBe('inherited')
    face.askRemove('web')
    expect(controller.getSnapshot().removal).toBeNull()
    face.askRemove('files')
    face.confirmRemove()
    await vi.waitFor(() => { expect(controller.getSnapshot().notice?.kind).toBe('removed') })
    expect(user('mcp-manager')?.servers).toEqual({})
  })

  it('drops a removed server\'s stored policy and session default, so a later server of that name starts clean', async () => {
    const { controller, face, user } = await loaded({
      user: { files }, policies: { files: { default: 'allow', tools: {} }, other: { default: 'deny', tools: {} } }, defaults: { files: false },
    })
    face.askRemove('files')
    face.confirmRemove()
    await vi.waitFor(() => { expect(controller.getSnapshot().notice?.kind).toBe('removed') })
    expect(user('mcp-policy')).toEqual({ servers: { other: { default: 'deny', tools: {} } } })
    expect(user('mcp-selection')).toEqual({ defaultActive: {} })
  })

  it('reports a refused toggle or removal with the Host\'s explanation', async () => {
    const { controller, face, settings } = await loaded()
    settings.mutate.mockResolvedValueOnce(refused('read-only profile'))
    face.toggle('files', false)
    await vi.waitFor(() => { expect(controller.getSnapshot().notice).toMatchObject({ kind: 'failed', detail: 'read-only profile' }) })
    settings.mutate.mockResolvedValueOnce(refused('nope'))
    face.askRemove('files')
    face.confirmRemove()
    await vi.waitFor(() => { expect(controller.getSnapshot().notice).toMatchObject({ kind: 'failed', detail: 'nope' }) })
  })

  it('restarts a server through the manager and reports a refusal', async () => {
    const { controller, face, mcpManager } = await loaded()
    face.restart('files')
    await vi.waitFor(() => { expect(controller.getSnapshot().notice?.kind).toBe('restarted') })
    expect(mcpManager.restart).toHaveBeenCalledWith('files')
    mcpManager.restart.mockResolvedValueOnce(refused('cleanup incomplete') as never)
    face.restart('files')
    await vi.waitFor(() => { expect(controller.getSnapshot().notice).toMatchObject({ kind: 'failed', detail: 'cleanup incomplete' }) })
  })

  it('tests a server, cancels a running test, and reports a refused one', async () => {
    const { controller, face, mcpManager } = await loaded()
    face.probe('web')
    expect(controller.getSnapshot().probe).toMatchObject({ name: 'web', status: 'running' })
    await vi.waitFor(() => { expect(controller.getSnapshot().probe?.status).toBe('done') })
    expect(controller.getSnapshot().probe?.result).toMatchObject({ ok: true, toolNames: ['echo', 'search'] })
    let signal: AbortSignal | undefined
    mcpManager.probe.mockImplementationOnce((_name, given) => {
      signal = given
      return new Promise(() => {})
    })
    face.probe('files')
    face.closeProbe()
    expect(signal?.aborted).toBe(true)
    expect(controller.getSnapshot().probe).toBeNull()
    mcpManager.probe.mockResolvedValueOnce(refused('unknown server') as never)
    face.probe('files')
    await vi.waitFor(() => { expect(controller.getSnapshot().probe).toMatchObject({ status: 'failed', detail: 'unknown server' }) })
  })

  it('reads a server\'s tools and writes one tool\'s mode into its policy', async () => {
    const tools = [{ name: 'echo', publicName: 'mcp__files__echo', description: '', parameters: [] }]
    const { controller, face, user } = await loaded({ user: { files }, tools, policies: { files: { default: 'ask', tools: { old: 'deny' } } } })
    face.openTools('files')
    await vi.waitFor(() => { expect(controller.getSnapshot().tools).toMatchObject({ name: 'files', status: 'ready', tools }) })
    face.setToolMode('echo', 'allow')
    await vi.waitFor(() => { expect(controller.getSnapshot().tools?.savingTool).toBeNull() })
    expect(user('mcp-policy')).toEqual({ servers: { files: { default: 'ask', tools: { old: 'deny', echo: 'allow' } } } })
    face.setToolMode('old', null)
    await vi.waitFor(() => { expect(user('mcp-policy')).toEqual({ servers: { files: { default: 'ask', tools: { echo: 'allow' } } } }) })
    face.closeTools()
    expect(controller.getSnapshot().tools).toBeNull()
  })

  it('marks a failed tools read', async () => {
    const { controller, face, mcpServers } = await loaded()
    mcpServers.tools.mockResolvedValueOnce(refused('down') as never)
    face.openTools('files')
    await vi.waitFor(() => { expect(controller.getSnapshot().tools?.status).toBe('failed') })
  })

  it('applies nothing after teardown and stops following the stream', async () => {
    const { controller, face, publish } = await loaded()
    controller.dispose()
    face.toggle('files', false)
    publish([view('files')] satisfies McpManagedServerView[])
    await Promise.resolve()
    expect(controller.getSnapshot().pending).toBe('files')
    expect(controller.getSnapshot().rows[0]?.status).toBeUndefined()
  })
})

describe('status item preference', () => {
  it('follows the accepted value, writes through the form, and reports a refused or unanswered write', async () => {
    const { controller, face, form } = await loaded()
    form.publish({ value: { statusItem: false }, writable: false })
    expect(controller.getSnapshot()).toMatchObject({ statusItem: false, statusItemWritable: false })
    face.setStatusItem(true)
    await vi.waitFor(() => { expect(form.set).toHaveBeenCalledWith('statusItem', true) })
    await Promise.resolve()
    expect(controller.getSnapshot().notice).toBeNull()
    form.set.mockResolvedValueOnce(false)
    face.setStatusItem(true)
    await vi.waitFor(() => { expect(controller.getSnapshot().notice?.kind).toBe('failed') })
    face.dismissNotice()
    expect(controller.getSnapshot().notice).toBeNull()
    form.set.mockRejectedValueOnce(new Error('down'))
    face.setStatusItem(true)
    await vi.waitFor(() => { expect(controller.getSnapshot().notice?.kind).toBe('failed') })
  })
})
