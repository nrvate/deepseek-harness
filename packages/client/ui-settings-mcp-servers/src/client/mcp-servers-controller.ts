/**
 * State of the MCP servers page: the rows the Host lists, the editor draft, and
 * the confirmations. Every fact comes from the Host; the controller re-reads
 * after each change and never keeps a row the Host did not report.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {
  McpChangeResult, McpEntryId, McpErrorCode, McpServerInfo, McpServerSpec, McpServerStatus, McpToolInfo, McpValue,
} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** How a staged `env` or `headers` value is written. */
export type ValueMode = 'env' | 'bearer' | 'literal' | 'kept' | 'expression'

/** One staged `env` or `headers` entry. */
export interface ValueDraft {
  /** Stable identity while the entry is edited; the name can change under it. */
  readonly uid: number
  key: string
  mode: ValueMode
  /** The variable name, the text, or the expression source, by `mode`; empty for `kept`. */
  text: string
}

/** The form's staged values. */
export interface EditorDraft {
  /** The row being edited; absent for a new server. */
  readonly rowId: McpEntryId | undefined
  transport: McpServerSpec['transport']
  serverName: string
  command: string
  /** One argument per line. */
  args: string
  cwd: string
  url: string
  /** `env` for a local command, `headers` for an HTTP endpoint. */
  values: ValueDraft[]
  timeoutMs: string
  failOnStartupError: boolean
}

/** Why the editor's last save did not land. */
export interface EditorError {
  /** A Host refusal, a local check, or `transport` when the Host did not answer. */
  readonly code: McpErrorCode | 'timeout' | 'transport'
  /** The Host's explanation, shown beside the localized sentence; empty for local errors. */
  readonly detail: string
}

/** The command the person is asked to trust before a stdio server is saved. */
export interface CommandConfirmation {
  readonly command: string
  acknowledged: boolean
}

/** The open editor. */
export interface EditorState {
  readonly draft: EditorDraft
  readonly saving: boolean
  readonly error: EditorError | null
  readonly confirm: CommandConfirmation | null
}

/** The server awaiting removal confirmation. */
export interface RemovalState {
  readonly row: McpServerInfo
  readonly saving: boolean
}

/** The tools dialog: one server's tools as the Host last reported them. */
export interface ToolsState {
  /** The server the dialog is about, as listed when it opened. */
  readonly row: McpServerInfo
  readonly status: 'loading' | 'ready' | 'failed'
  readonly tools: readonly McpToolInfo[]
  /** The connection state the tools were read under. */
  readonly connection: McpServerStatus | undefined
}

/** What the last action leaves to say, shown as a toast; `seq` tells one showing from the next. */
export interface McpNotice {
  readonly kind: 'saved' | 'removed' | 'enabled' | 'disabled' | 'failed' | 'refresh-failed'
  /** The Host saved the change but the running profile cannot apply it yet. */
  readonly restart: boolean
  readonly seq: number
}

/** What the page renders. */
export interface McpServersState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed'
  readonly rows: readonly McpServerInfo[]
  /** The row id with a toggle in flight. */
  readonly pending: string | null
  readonly editor: EditorState | null
  readonly removal: RemovalState | null
  readonly tools: ToolsState | null
  readonly notice: McpNotice | null
}

/** Draft fields a text input edits directly. */
export type DraftField = 'serverName' | 'command' | 'args' | 'cwd' | 'url' | 'timeoutMs'

/** The registration-side face the page's slot entries inject. */
export interface McpServersFace {
  hooks: {
    /** Page snapshot bound by the renderer as useMcpServers. */
    mcpServers: SnapshotStore<McpServersState>
  }
  load: () => void
  openAdd: () => void
  openEdit: (id: McpEntryId) => void
  closeEditor: () => void
  setTransport: (transport: McpServerSpec['transport']) => void
  editField: (field: DraftField, text: string) => void
  setFailOnStartup: (checked: boolean) => void
  addValue: () => void
  editValue: (uid: number, change: Partial<Pick<ValueDraft, 'key' | 'mode' | 'text'>>) => void
  removeValue: (uid: number) => void
  save: () => void
  acknowledge: (checked: boolean) => void
  confirmSave: () => void
  cancelConfirm: () => void
  toggle: (id: McpEntryId, enabled: boolean) => void
  askRemove: (id: McpEntryId) => void
  openTools: (id: McpEntryId) => void
  closeTools: () => void
  reconnect: (id: McpEntryId) => void
  cancelRemove: () => void
  confirmRemove: () => void
  dismissNotice: () => void
}

/**
 * A blank draft for a new local-command server.
 * @returns the staged values of an empty form.
 */
export function emptyDraft(): EditorDraft {
  return {
    rowId: undefined, transport: 'stdio', serverName: '', command: '', args: '', cwd: '', url: '',
    values: [], timeoutMs: '', failOnStartupError: false,
  }
}

function modeOf(value: McpValue): { mode: ValueMode; text: string } {
  switch (value.kind) {
    case 'literal': return { mode: 'literal', text: value.value }
    case 'env': return { mode: value.scheme === 'Bearer' ? 'bearer' : 'env', text: value.name }
    case 'expression': return { mode: 'expression', text: value.source }
    case 'kept': return { mode: 'kept', text: '' }
  }
}

/**
 * Stage an editable row for the form.
 * @param id - the listed row being edited.
 * @param spec - the row's configuration.
 * @param uid - next free value identity; entries take consecutive ids from it.
 * @returns the draft and the next free identity.
 */
export function draftFromSpec(id: McpEntryId, spec: McpServerSpec, uid: number): { draft: EditorDraft; next: number } {
  const entries = Object.entries(spec.transport === 'stdio' ? spec.env : spec.headers)
  const values = entries.map(([key, value], index): ValueDraft => ({ uid: uid + index, key, ...modeOf(value) }))
  const common = {
    rowId: id, serverName: spec.serverName, values,
    timeoutMs: spec.toolCallTimeoutMs === undefined ? '' : String(spec.toolCallTimeoutMs),
    failOnStartupError: spec.failOnStartupError === true,
  }
  const draft: EditorDraft = spec.transport === 'stdio'
    ? { ...common, transport: 'stdio', command: spec.command, args: spec.args.join('\n'), cwd: spec.cwd ?? '', url: '' }
    : { ...common, transport: 'streamable-http', command: '', args: '', cwd: '', url: spec.url }
  return { draft, next: uid + entries.length }
}

function valueOf(entry: ValueDraft): McpValue {
  switch (entry.mode) {
    case 'env': return { kind: 'env', name: entry.text.trim() }
    case 'bearer': return { kind: 'env', name: entry.text.trim(), scheme: 'Bearer' }
    case 'literal': return { kind: 'literal', value: entry.text }
    case 'kept': return { kind: 'kept' }
    case 'expression': return { kind: 'expression', source: entry.text }
  }
}

/**
 * The configuration a draft stages. Blank names are dropped and a later entry replaces an earlier one with the same name.
 * @param draft - the form's staged values.
 * @returns the spec to send, or null when the timeout is not a whole number.
 */
export function specFromDraft(draft: EditorDraft): McpServerSpec | null {
  const values: Record<string, McpValue> = {}
  for (const entry of draft.values) {
    if (entry.key.trim() !== '') values[entry.key.trim()] = valueOf(entry)
  }
  const timeout = draft.timeoutMs.trim()
  if (timeout !== '' && !/^[1-9]\d*$/.test(timeout)) return null
  const common = {
    serverName: draft.serverName.trim(),
    ...timeout === '' ? {} : { toolCallTimeoutMs: Number(timeout) },
    ...draft.failOnStartupError ? { failOnStartupError: true } : {},
  }
  if (draft.transport === 'streamable-http') return { transport: 'streamable-http', url: draft.url.trim(), headers: values, ...common }
  const cwd = draft.cwd.trim()
  return {
    transport: 'stdio',
    command: draft.command.trim(),
    args: draft.args.split('\n').map(line => line.replace(/\r$/, '')).filter(line => line !== ''),
    env: values,
    ...cwd === '' ? {} : { cwd },
    ...common,
  }
}

/** Reads and changes the profile's MCP servers over the `mcpServers` Remote. */
export class McpServersController {
  private readonly store: SnapshotStore<McpServersState>
  private uid = 0
  private generation = 0
  private seq = 0
  private disposed = false

  /** @param ctx - the page plugin's context, whose `remote.mcpServers` namespace answers. */
  constructor(private readonly ctx: ClientContext) {
    this.store = createSnapshotStore<McpServersState>({
      status: 'idle', rows: [], pending: null, editor: null, removal: null, tools: null, notice: null,
    })
  }

  /**
   * Read the page state.
   * @returns the page's current snapshot.
   */
  getSnapshot(): McpServersState { return this.store.getSnapshot() }

  /** Stop applying answers that arrive after teardown. */
  dispose(): void { this.disposed = true }

  /**
   * Re-read the rows when the page has been opened; a page never rendered holds nothing to refresh.
   */
  refresh(): void {
    if (this.getSnapshot().status !== 'idle') void this.read()
  }

  private patch(change: Partial<McpServersState>): void {
    this.store.set({ ...this.getSnapshot(), ...change })
  }

  private patchEditor(change: Partial<EditorState>): void {
    const editor = this.getSnapshot().editor
    if (editor !== null) this.patch({ editor: { ...editor, ...change } })
  }

  private patchDraft(change: Partial<EditorDraft>): void {
    const editor = this.getSnapshot().editor
    if (editor !== null) this.patchEditor({ draft: { ...editor.draft, ...change }, error: null })
  }

  private notify(kind: McpNotice['kind'], restart = false): void {
    this.patch({ notice: { kind, restart, seq: ++this.seq } })
  }

  /** Read the rows; the first read shows the loading state, later reads keep the rows on screen. */
  async read(): Promise<void> {
    const generation = ++this.generation
    if (this.getSnapshot().status === 'idle') this.patch({ status: 'loading' })
    const result = await this.ctx.remote.mcpServers.list()
    if (this.disposed || generation !== this.generation) return
    if (result.ok) {
      this.patch({ status: 'ready', rows: result.value })
      // An open tools dialog follows the state the rows just reported.
      const open = this.getSnapshot().tools
      if (open !== null) await this.readTools(open.row)
    } else if (this.getSnapshot().status === 'ready') {
      this.notify('refresh-failed')
    } else {
      this.patch({ status: 'failed' })
    }
  }

  /**
   * Build the face the slot entries inject.
   * @returns the page snapshot store and its actions.
   */
  inject(): McpServersFace {
    return {
      hooks: { mcpServers: this.store },
      load: () => { void this.read() },
      openAdd: () => { this.patch({ editor: { draft: emptyDraft(), saving: false, error: null, confirm: null } }) },
      openEdit: (id) => { this.openEdit(id) },
      closeEditor: () => { this.patch({ editor: null }) },
      setTransport: (transport) => { this.patchDraft({ transport, values: [] }) },
      editField: (field, text) => { this.patchDraft({ [field]: text }) },
      setFailOnStartup: (checked) => { this.patchDraft({ failOnStartupError: checked }) },
      addValue: () => { this.addValue() },
      editValue: (uid, change) => { this.editValue(uid, change) },
      removeValue: (uid) => { this.removeValue(uid) },
      save: () => { void this.save() },
      acknowledge: (checked) => { this.acknowledge(checked) },
      confirmSave: () => { this.confirmSave() },
      cancelConfirm: () => { this.patchEditor({ confirm: null }) },
      toggle: (id, enabled) => { void this.toggle(id, enabled) },
      askRemove: (id) => { this.askRemove(id) },
      cancelRemove: () => { this.patch({ removal: null }) },
      openTools: (id) => { this.openTools(id) },
      closeTools: () => { this.patch({ tools: null }) },
      reconnect: (id) => { void this.reconnect(id) },
      confirmRemove: () => { void this.confirmRemove() },
      dismissNotice: () => { this.patch({ notice: null }) },
    }
  }

  private openEdit(id: McpEntryId): void {
    const row = this.getSnapshot().rows.find(candidate => candidate.id === id)
    if (row?.spec === undefined) return
    const { draft, next } = draftFromSpec(id, row.spec, this.uid)
    this.uid = next
    this.patch({ editor: { draft, saving: false, error: null, confirm: null } })
  }

  private addValue(): void {
    const editor = this.getSnapshot().editor
    if (editor === null) return
    const entry: ValueDraft = { uid: this.uid++, key: '', mode: 'env', text: '' }
    this.patchDraft({ values: [...editor.draft.values, entry] })
  }

  private editValue(uid: number, change: Partial<Pick<ValueDraft, 'key' | 'mode' | 'text'>>): void {
    const editor = this.getSnapshot().editor
    if (editor === null) return
    this.patchDraft({ values: editor.draft.values.map(entry => entry.uid === uid ? { ...entry, ...change } : entry) })
  }

  private removeValue(uid: number): void {
    const editor = this.getSnapshot().editor
    if (editor === null) return
    this.patchDraft({ values: editor.draft.values.filter(entry => entry.uid !== uid) })
  }

  private acknowledge(checked: boolean): void {
    const confirm = this.getSnapshot().editor?.confirm
    if (confirm !== null && confirm !== undefined) this.patchEditor({ confirm: { ...confirm, acknowledged: checked } })
  }

  private confirmSave(): void {
    const confirm = this.getSnapshot().editor?.confirm
    if (confirm?.acknowledged === true) void this.save(confirm.command)
  }

  /**
   * Send the staged server. A stdio server is refused until the Host's own command line comes back and the person trusts it.
   * @param confirmedCommand - the command line the person trusted.
   */
  private async save(confirmedCommand?: string): Promise<void> {
    const editor = this.getSnapshot().editor
    if (editor === null || editor.saving) return
    const spec = specFromDraft(editor.draft)
    if (spec === null) {
      this.patchEditor({ error: { code: 'timeout', detail: '' }, confirm: null })
      return
    }
    this.patchEditor({ saving: true, error: null })
    const result = await this.ctx.remote.mcpServers.upsert(spec, {
      ...editor.draft.rowId === undefined ? {} : { id: editor.draft.rowId },
      ...confirmedCommand === undefined ? {} : { confirmedCommand },
    })
    if (this.disposed || this.getSnapshot().editor === null) return
    if (!result.ok) {
      this.patchEditor({ saving: false, error: { code: 'transport', detail: '' }, confirm: null })
      return
    }
    const change = result.value
    if (change.application !== 'failed') {
      this.patch({ editor: null })
      this.notify('saved', change.application === 'restart-required')
      await this.read()
    } else if (change.error?.code === 'confirmation-required' && change.error.command !== undefined) {
      this.patchEditor({ saving: false, confirm: { command: change.error.command, acknowledged: false } })
    } else {
      this.patchEditor({
        saving: false, confirm: null,
        error: { code: change.error?.code ?? 'operation-error', detail: change.error?.message ?? '' },
      })
    }
  }

  private async toggle(id: McpEntryId, enabled: boolean): Promise<void> {
    if (this.getSnapshot().pending !== null) return
    this.patch({ pending: id })
    const result = await this.ctx.remote.mcpServers.setEnabled(id, enabled)
    if (this.disposed) return
    this.patch({ pending: null })
    this.settle(result.ok ? result.value : undefined, enabled ? 'enabled' : 'disabled')
    await this.read()
  }

  private openTools(id: McpEntryId): void {
    const row = this.getSnapshot().rows.find(candidate => candidate.id === id)
    if (row === undefined) return
    this.patch({ tools: { row, status: 'loading', tools: [], connection: row.status } })
    void this.readTools(row)
  }

  private async readTools(row: McpServerInfo): Promise<void> {
    const result = await this.ctx.remote.mcpServers.tools(row.id)
    const open = this.getSnapshot().tools
    if (this.disposed || open?.row.id !== row.id) return
    this.patch({
      tools: result.ok
        ? { row: open.row, status: 'ready', tools: result.value.tools, connection: result.value.status }
        : { ...open, status: 'failed' },
    })
  }

  private async reconnect(id: McpEntryId): Promise<void> {
    if (this.getSnapshot().pending !== null) return
    this.patch({ pending: id })
    const result = await this.ctx.remote.mcpServers.reconnectServer(id)
    if (this.disposed) return
    this.patch({ pending: null })
    if (!result.ok) this.notify('failed')
    await this.read()
  }

  private askRemove(id: McpEntryId): void {
    const row = this.getSnapshot().rows.find(candidate => candidate.id === id)
    if (row !== undefined) this.patch({ removal: { row, saving: false } })
  }

  private async confirmRemove(): Promise<void> {
    const removal = this.getSnapshot().removal
    if (removal === null || removal.saving) return
    this.patch({ removal: { ...removal, saving: true } })
    const result = await this.ctx.remote.mcpServers.removeServer(removal.row.id)
    if (this.disposed) return
    this.patch({ removal: null })
    this.settle(result.ok ? result.value : undefined, 'removed')
    await this.read()
  }

  /** Report one change's outcome as a toast; a transport failure and a refusal read the same. */
  private settle(change: McpChangeResult | undefined, success: McpNotice['kind']): void {
    if (change === undefined || change.application === 'failed') this.notify('failed')
    else this.notify(success, change.application === 'restart-required')
  }
}
