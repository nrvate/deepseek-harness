/** The page's state over a scripted `mcpServers` Remote: reads, the editor, the stdio confirmation, toggles, and removal. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { McpChangeResult, McpEntryId, McpServerInfo, McpServerSpec } from '@deepseek-ai/dsh-api-remotes/client'
import {
  draftFromSpec, emptyDraft, McpServersController, specFromDraft,
  type EditorDraft, type McpServersFace,
} from '../src/client/mcp-servers-controller.ts'

const id = (value: string): McpEntryId => value as McpEntryId

const stdioSpec: McpServerSpec = {
  transport: 'stdio', serverName: 'files', command: 'mcp-files', args: ['--root', '/tmp'],
  env: { LOG: { kind: 'literal', value: 'debug' }, TOKEN: { kind: 'env', name: 'FILES_TOKEN' } },
}
const httpSpec: McpServerSpec = {
  transport: 'streamable-http', serverName: 'web', url: 'https://example.test/mcp',
  headers: { Authorization: { kind: 'env', name: 'WEB_TOKEN', scheme: 'Bearer' }, Old: { kind: 'kept' }, Calc: { kind: 'expression', source: 'process.cwd()' } },
  toolCallTimeoutMs: 5000, failOnStartupError: true,
}

function row(rowId: string, spec?: McpServerSpec, rest: Partial<McpServerInfo> = {}): McpServerInfo {
  return {
    id: id(rowId), serverName: spec?.serverName ?? rowId, transport: spec?.transport ?? 'stdio', summary: 'summary',
    enabled: true, fiberPhase: 'active', owned: spec !== undefined, ...spec === undefined ? {} : { spec }, ...rest,
  }
}

const applied: McpChangeResult = { changed: true, application: 'applied', target: 'mcp-files' }

function bench(rows: McpServerInfo[] = [row('mcp-files', stdioSpec), row('mcp-web', httpSpec)]) {
  const ctx = new Context()
  const mcpServers = {
    list: vi.fn(() => Promise.resolve({ ok: true as const, value: rows })),
    upsert: vi.fn((_spec: McpServerSpec, _options?: unknown) => Promise.resolve({ ok: true as const, value: applied })),
    setEnabled: vi.fn((_id: McpEntryId, _enabled: boolean) => Promise.resolve({ ok: true as const, value: applied })),
    remove: vi.fn((_id: McpEntryId) => Promise.resolve({ ok: true as const, value: applied })),
  }
  const remote = new TestRemote(ctx, { mcpServers })
  const controller = new McpServersController(ctx)
  const face: McpServersFace = controller.inject()
  return { ctx, controller, face, mcpServers, remote }
}

const failure = { ok: false as const, error: new Error('down') }

async function loaded(rows?: McpServerInfo[]) {
  const made = bench(rows)
  made.face.load()
  await vi.waitFor(() => { expect(made.controller.getSnapshot().status).toBe('ready') })
  return made
}

describe('draft conversion', () => {
  it('stages a new server as an empty local-command form', () => {
    expect(emptyDraft()).toMatchObject({ rowId: undefined, transport: 'stdio', serverName: '', values: [], failOnStartupError: false })
  })

  it('stages a local server and numbers its values from the next free identity', () => {
    const { draft, next } = draftFromSpec(id('mcp-files'), stdioSpec, 10)
    expect(draft).toMatchObject({ rowId: 'mcp-files', transport: 'stdio', command: 'mcp-files', args: '--root\n/tmp', cwd: '', timeoutMs: '', failOnStartupError: false })
    expect(draft.values).toEqual([
      { uid: 10, key: 'LOG', mode: 'literal', text: 'debug' },
      { uid: 11, key: 'TOKEN', mode: 'env', text: 'FILES_TOKEN' },
    ])
    expect(next).toBe(12)
  })

  it('stages an HTTP server with every value kind, a timeout, and the startup flag', () => {
    const { draft } = draftFromSpec(id('mcp-web'), httpSpec, 0)
    expect(draft).toMatchObject({ transport: 'streamable-http', url: 'https://example.test/mcp', timeoutMs: '5000', failOnStartupError: true })
    expect(draft.values.map(({ key, mode, text }) => [key, mode, text])).toEqual([
      ['Authorization', 'bearer', 'WEB_TOKEN'], ['Old', 'kept', ''], ['Calc', 'expression', 'process.cwd()'],
    ])
  })

  it('keeps a working directory a local server already has', () => {
    expect(draftFromSpec(id('x'), { ...stdioSpec, cwd: '/work' }, 0).draft.cwd).toBe('/work')
  })

  it('round-trips a staged server back to its spec', () => {
    expect(specFromDraft(draftFromSpec(id('mcp-files'), stdioSpec, 0).draft)).toEqual(stdioSpec)
    expect(specFromDraft(draftFromSpec(id('mcp-web'), httpSpec, 0).draft)).toEqual(httpSpec)
  })

  it('trims fields, drops blank arguments and names, and lets a later name win', () => {
    const draft: EditorDraft = {
      ...emptyDraft(), serverName: ' s ', command: ' run ', args: 'a\r\n\nb', cwd: ' /w ', timeoutMs: ' 100 ', failOnStartupError: true,
      values: [
        { uid: 0, key: ' A ', mode: 'literal', text: 'one' },
        { uid: 1, key: '', mode: 'literal', text: 'ignored' },
        { uid: 2, key: 'A', mode: 'literal', text: 'two' },
        { uid: 3, key: 'B', mode: 'bearer', text: ' VAR ' },
      ],
    }
    expect(specFromDraft(draft)).toEqual({
      transport: 'stdio', serverName: 's', command: 'run', args: ['a', 'b'], cwd: '/w', toolCallTimeoutMs: 100, failOnStartupError: true,
      env: { A: { kind: 'literal', value: 'two' }, B: { kind: 'env', name: 'VAR', scheme: 'Bearer' } },
    })
  })

  it.each(['0', '1.5', 'soon', '-3'])('refuses a timeout that is not a whole positive number: %s', (timeoutMs) => {
    expect(specFromDraft({ ...emptyDraft(), timeoutMs })).toBeNull()
  })
})

describe('reading', () => {
  it('shows nothing and asks nothing until the page opens', () => {
    const { controller, mcpServers } = bench()
    controller.refresh()
    expect(controller.getSnapshot().status).toBe('idle')
    expect(mcpServers.list).not.toHaveBeenCalled()
  })

  it('loads the rows when the page opens and again on refresh', async () => {
    const { controller, mcpServers } = await loaded()
    expect(controller.getSnapshot().rows).toHaveLength(2)
    controller.refresh()
    await vi.waitFor(() => { expect(mcpServers.list).toHaveBeenCalledTimes(2) })
  })

  it('reports a first read that fails as failed, then recovers on retry', async () => {
    const { controller, face, mcpServers } = bench()
    mcpServers.list.mockResolvedValueOnce(failure as never)
    face.load()
    await vi.waitFor(() => { expect(controller.getSnapshot().status).toBe('failed') })
    face.load()
    await vi.waitFor(() => { expect(controller.getSnapshot().status).toBe('ready') })
  })

  it('keeps the rows and toasts when a later read fails', async () => {
    const { controller, mcpServers } = await loaded()
    mcpServers.list.mockResolvedValueOnce(failure as never)
    controller.refresh()
    await vi.waitFor(() => { expect(controller.getSnapshot().notice?.kind).toBe('refresh-failed') })
    expect(controller.getSnapshot().status).toBe('ready')
    expect(controller.getSnapshot().rows).toHaveLength(2)
  })

  it('applies only the newest of two overlapping reads', async () => {
    const { controller, face, mcpServers } = bench()
    const first = Promise.withResolvers<{ ok: true; value: McpServerInfo[] }>()
    mcpServers.list.mockReturnValueOnce(first.promise)
    face.load()
    face.load()
    await vi.waitFor(() => { expect(controller.getSnapshot().status).toBe('ready') })
    first.resolve({ ok: true, value: [] })
    await first.promise
    expect(controller.getSnapshot().rows).toHaveLength(2)
  })

  it('ignores an answer that arrives after teardown', async () => {
    const { controller, face, mcpServers } = bench()
    const pending = Promise.withResolvers<{ ok: true; value: McpServerInfo[] }>()
    mcpServers.list.mockReturnValueOnce(pending.promise)
    face.load()
    controller.dispose()
    pending.resolve({ ok: true, value: [row('late')] })
    await pending.promise
    expect(controller.getSnapshot().rows).toEqual([])
  })
})

describe('editing', () => {
  it('opens a blank form for a new server and closes it', async () => {
    const { controller, face } = await loaded()
    face.openAdd()
    expect(controller.getSnapshot().editor).toMatchObject({ saving: false, error: null, confirm: null, draft: { rowId: undefined } })
    face.closeEditor()
    expect(controller.getSnapshot().editor).toBeNull()
  })

  it('opens an editable row and ignores a row without a spec or an unknown row', async () => {
    const { controller, face } = await loaded([row('mcp-files', stdioSpec), row('overlay', undefined, { readOnlyReason: 'unaddressable' })])
    face.openEdit(id('overlay'))
    face.openEdit(id('missing'))
    expect(controller.getSnapshot().editor).toBeNull()
    face.openEdit(id('mcp-files'))
    expect(controller.getSnapshot().editor?.draft).toMatchObject({ rowId: 'mcp-files', serverName: 'files' })
  })

  it('edits fields, values, and the transport, clearing the last error', async () => {
    const { controller, face } = await loaded()
    face.openAdd()
    face.editField('serverName', 'srv')
    face.editField('command', 'run')
    face.setFailOnStartup(true)
    face.addValue()
    const uid = controller.getSnapshot().editor?.draft.values[0]?.uid ?? -1
    face.editValue(uid, { key: 'K', mode: 'literal', text: 'v' })
    face.addValue()
    const second = controller.getSnapshot().editor?.draft.values[1]?.uid ?? -1
    face.removeValue(second)
    expect(controller.getSnapshot().editor?.draft).toMatchObject({
      serverName: 'srv', command: 'run', failOnStartupError: true, values: [{ key: 'K', mode: 'literal', text: 'v' }],
    })
    face.setTransport('streamable-http')
    expect(controller.getSnapshot().editor?.draft).toMatchObject({ transport: 'streamable-http', values: [] })
  })

  it('does nothing when an editing action arrives with no editor open', async () => {
    const { controller, face, mcpServers } = await loaded()
    const before = controller.getSnapshot()
    face.editField('serverName', 'x')
    face.setFailOnStartup(true)
    face.addValue()
    face.editValue(0, { key: 'x' })
    face.removeValue(0)
    face.acknowledge(true)
    face.confirmSave()
    face.cancelConfirm()
    face.save()
    expect(controller.getSnapshot()).toBe(before)
    expect(mcpServers.upsert).not.toHaveBeenCalled()
  })

  it('leaves other values alone when one is edited', async () => {
    const { controller, face } = await loaded()
    face.openAdd()
    face.addValue()
    face.addValue()
    const [first, second] = controller.getSnapshot().editor?.draft.values ?? []
    face.editValue(second?.uid ?? -1, { key: 'B' })
    expect(controller.getSnapshot().editor?.draft.values).toEqual([first, { ...second, key: 'B' }])
  })
})

describe('saving', () => {
  it('saves an HTTP server, closes the form, toasts, and re-reads', async () => {
    const { controller, face, mcpServers } = await loaded()
    face.openAdd()
    face.setTransport('streamable-http')
    face.editField('serverName', 'web2')
    face.editField('url', 'https://example.test/two')
    face.save()
    await vi.waitFor(() => { expect(controller.getSnapshot().editor).toBeNull() })
    expect(mcpServers.upsert).toHaveBeenCalledWith({ transport: 'streamable-http', serverName: 'web2', url: 'https://example.test/two', headers: {} }, {})
    expect(controller.getSnapshot().notice).toMatchObject({ kind: 'saved', restart: false })
    expect(mcpServers.list).toHaveBeenCalledTimes(2)
  })

  it('passes the row id when editing and reports restart-required', async () => {
    const { controller, face, mcpServers } = await loaded()
    mcpServers.upsert.mockResolvedValueOnce({ ok: true, value: { ...applied, application: 'restart-required' } })
    face.openEdit(id('mcp-web'))
    face.save()
    await vi.waitFor(() => { expect(controller.getSnapshot().notice).toMatchObject({ kind: 'saved', restart: true }) })
    expect(mcpServers.upsert.mock.calls[0]?.[1]).toEqual({ id: 'mcp-web' })
  })

  it('refuses a bad timeout locally without calling the Host', async () => {
    const { controller, face, mcpServers } = await loaded()
    face.openAdd()
    face.editField('timeoutMs', 'soon')
    face.save()
    expect(controller.getSnapshot().editor?.error).toEqual({ code: 'timeout', detail: '' })
    expect(mcpServers.upsert).not.toHaveBeenCalled()
  })

  it('asks the person to trust the Host\'s command line before a local server is saved', async () => {
    const { controller, face, mcpServers } = await loaded()
    mcpServers.upsert.mockResolvedValueOnce({
      ok: true, value: { changed: false, application: 'failed', target: 'mcp-x', error: { code: 'confirmation-required', message: 'confirm', command: 'run --flag' } },
    })
    face.openAdd()
    face.editField('serverName', 'x')
    face.editField('command', 'run')
    face.save()
    await vi.waitFor(() => { expect(controller.getSnapshot().editor?.confirm).toEqual({ command: 'run --flag', acknowledged: false }) })
    expect(controller.getSnapshot().editor?.saving).toBe(false)

    face.confirmSave()
    expect(mcpServers.upsert).toHaveBeenCalledTimes(1)

    face.acknowledge(true)
    face.confirmSave()
    await vi.waitFor(() => { expect(controller.getSnapshot().editor).toBeNull() })
    expect(mcpServers.upsert.mock.calls[1]?.[1]).toEqual({ confirmedCommand: 'run --flag' })
  })

  it('returns to the form when the confirmation is cancelled', async () => {
    const { controller, face, mcpServers } = await loaded()
    mcpServers.upsert.mockResolvedValueOnce({
      ok: true, value: { changed: false, application: 'failed', target: 'x', error: { code: 'confirmation-required', message: 'c', command: 'run' } },
    })
    face.openAdd()
    face.save()
    await vi.waitFor(() => { expect(controller.getSnapshot().editor?.confirm).not.toBeNull() })
    face.cancelConfirm()
    expect(controller.getSnapshot().editor).toMatchObject({ confirm: null })
  })

  it('shows a Host refusal in the form with its explanation and keeps the draft', async () => {
    const { controller, face, mcpServers } = await loaded()
    mcpServers.upsert.mockResolvedValueOnce({
      ok: true, value: { changed: false, application: 'failed', target: 'x', error: { code: 'duplicate-server', message: 'already there' } },
    })
    face.openAdd()
    face.editField('serverName', 'files')
    face.save()
    await vi.waitFor(() => { expect(controller.getSnapshot().editor?.error).toEqual({ code: 'duplicate-server', detail: 'already there' }) })
    expect(controller.getSnapshot().editor).toMatchObject({ saving: false, draft: { serverName: 'files' } })
  })

  it('reports a refusal that carries no error as an operation error', async () => {
    const { controller, face, mcpServers } = await loaded()
    mcpServers.upsert.mockResolvedValueOnce({ ok: true, value: { changed: false, application: 'failed', target: 'x' } })
    face.openAdd()
    face.save()
    await vi.waitFor(() => { expect(controller.getSnapshot().editor?.error).toEqual({ code: 'operation-error', detail: '' }) })
  })

  it('reports a confirmation refusal without a command as an operation error', async () => {
    const { controller, face, mcpServers } = await loaded()
    mcpServers.upsert.mockResolvedValueOnce({
      ok: true, value: { changed: false, application: 'failed', target: 'x', error: { code: 'confirmation-required', message: 'c' } },
    })
    face.openAdd()
    face.save()
    await vi.waitFor(() => { expect(controller.getSnapshot().editor?.error?.code).toBe('confirmation-required') })
  })

  it('reports a Host that does not answer', async () => {
    const { controller, face, mcpServers } = await loaded()
    mcpServers.upsert.mockResolvedValueOnce(failure as never)
    face.openAdd()
    face.save()
    await vi.waitFor(() => { expect(controller.getSnapshot().editor?.error).toEqual({ code: 'transport', detail: '' }) })
    expect(controller.getSnapshot().editor?.saving).toBe(false)
  })

  it('sends one save at a time', async () => {
    const { controller, face, mcpServers } = await loaded()
    const pending = Promise.withResolvers<{ ok: true; value: McpChangeResult }>()
    mcpServers.upsert.mockReturnValueOnce(pending.promise)
    face.openAdd()
    face.save()
    face.save()
    expect(mcpServers.upsert).toHaveBeenCalledTimes(1)
    pending.resolve({ ok: true, value: applied })
    await vi.waitFor(() => { expect(controller.getSnapshot().editor).toBeNull() })
  })

  it('drops an answer for a form that was closed meanwhile', async () => {
    const { controller, face, mcpServers } = await loaded()
    const pending = Promise.withResolvers<{ ok: true; value: McpChangeResult }>()
    mcpServers.upsert.mockReturnValueOnce(pending.promise)
    face.openAdd()
    face.save()
    face.closeEditor()
    pending.resolve({ ok: true, value: applied })
    await pending.promise
    await Promise.resolve()
    expect(controller.getSnapshot().notice).toBeNull()
  })

  it('drops an answer that arrives after teardown', async () => {
    const { controller, face, mcpServers } = await loaded()
    const pending = Promise.withResolvers<{ ok: true; value: McpChangeResult }>()
    mcpServers.upsert.mockReturnValueOnce(pending.promise)
    face.openAdd()
    face.save()
    controller.dispose()
    pending.resolve({ ok: true, value: applied })
    await pending.promise
    await Promise.resolve()
    expect(controller.getSnapshot().notice).toBeNull()
  })
})

describe('toggling and removing', () => {
  it('enables and disables a row, toasting each and re-reading', async () => {
    const { controller, face, mcpServers } = await loaded()
    face.toggle(id('mcp-files'), false)
    await vi.waitFor(() => { expect(controller.getSnapshot().notice).toMatchObject({ kind: 'disabled' }) })
    expect(mcpServers.setEnabled).toHaveBeenCalledWith('mcp-files', false)
    expect(controller.getSnapshot().pending).toBeNull()
    face.toggle(id('mcp-files'), true)
    await vi.waitFor(() => { expect(controller.getSnapshot().notice).toMatchObject({ kind: 'enabled' }) })
  })

  it('reports a toggle the Host refused or never answered as failed', async () => {
    const { controller, face, mcpServers } = await loaded()
    mcpServers.setEnabled.mockResolvedValueOnce({ ok: true, value: { ...applied, application: 'failed' } })
    face.toggle(id('mcp-files'), false)
    await vi.waitFor(() => { expect(controller.getSnapshot().notice).toMatchObject({ kind: 'failed' }) })
    mcpServers.setEnabled.mockResolvedValueOnce(failure as never)
    face.toggle(id('mcp-files'), false)
    await vi.waitFor(() => { expect(mcpServers.setEnabled).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => { expect(controller.getSnapshot().pending).toBeNull() })
    expect(controller.getSnapshot().notice).toMatchObject({ kind: 'failed' })
  })

  it('reports restart-required for a toggle the profile cannot apply yet', async () => {
    const { controller, face, mcpServers } = await loaded()
    mcpServers.setEnabled.mockResolvedValueOnce({ ok: true, value: { ...applied, application: 'restart-required' } })
    face.toggle(id('mcp-files'), true)
    await vi.waitFor(() => { expect(controller.getSnapshot().notice).toMatchObject({ kind: 'enabled', restart: true }) })
  })

  it('sends one toggle at a time and ignores an answer after teardown', async () => {
    const { controller, face, mcpServers } = await loaded()
    const pending = Promise.withResolvers<{ ok: true; value: McpChangeResult }>()
    mcpServers.setEnabled.mockReturnValueOnce(pending.promise)
    face.toggle(id('mcp-files'), false)
    face.toggle(id('mcp-web'), false)
    expect(mcpServers.setEnabled).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().pending).toBe('mcp-files')
    controller.dispose()
    pending.resolve({ ok: true, value: applied })
    await pending.promise
    await Promise.resolve()
    expect(controller.getSnapshot().pending).toBe('mcp-files')
  })

  it('asks before removing, and cancels', async () => {
    const { controller, face } = await loaded()
    face.askRemove(id('missing'))
    expect(controller.getSnapshot().removal).toBeNull()
    face.askRemove(id('mcp-files'))
    expect(controller.getSnapshot().removal).toMatchObject({ row: { id: 'mcp-files' }, saving: false })
    face.cancelRemove()
    expect(controller.getSnapshot().removal).toBeNull()
  })

  it('removes the confirmed row once, toasts, and re-reads', async () => {
    const { controller, face, mcpServers } = await loaded()
    face.confirmRemove()
    expect(mcpServers.remove).not.toHaveBeenCalled()
    face.askRemove(id('mcp-files'))
    face.confirmRemove()
    face.confirmRemove()
    await vi.waitFor(() => { expect(controller.getSnapshot().notice).toMatchObject({ kind: 'removed' }) })
    expect(mcpServers.remove).toHaveBeenCalledTimes(1)
    expect(mcpServers.remove).toHaveBeenCalledWith('mcp-files')
    expect(controller.getSnapshot().removal).toBeNull()
  })

  it('reports a removal the Host refused, and ignores an answer after teardown', async () => {
    const { controller, face, mcpServers } = await loaded()
    mcpServers.remove.mockResolvedValueOnce(failure as never)
    face.askRemove(id('mcp-files'))
    face.confirmRemove()
    await vi.waitFor(() => { expect(controller.getSnapshot().notice).toMatchObject({ kind: 'failed' }) })

    const pending = Promise.withResolvers<{ ok: true; value: McpChangeResult }>()
    mcpServers.remove.mockReturnValueOnce(pending.promise)
    face.dismissNotice()
    face.askRemove(id('mcp-files'))
    face.confirmRemove()
    controller.dispose()
    pending.resolve({ ok: true, value: applied })
    await pending.promise
    await Promise.resolve()
    expect(controller.getSnapshot().notice).toBeNull()
  })
})
