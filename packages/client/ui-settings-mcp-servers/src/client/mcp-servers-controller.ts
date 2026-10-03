/**
 * State of the MCP servers page: the rows the Host lists, the editor draft, and
 * the confirmations. Every fact comes from the Host; the controller re-reads
 * after each change and never keeps a row the Host did not report.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {
  McpChangeResult, McpEntryId, McpErrorCode, McpServerInfo, McpServerSpec, McpServerStatus, McpToolInfo, McpToolMode, McpToolPolicy,
  McpValue,
} from '@deepseek-ai/dsh-api-remotes/client'
import { ASK_EVERY_CALL, asksEveryCall } from './tool-modes.ts'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_STATUS_ITEM, STATUS_ITEM_FIELD, type McpUiSettings } from '../mcp-ui-settings.ts'

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
  /** Whether a Session that has made no selection of its own uses the server. */
  defaultActive: boolean
  /** Whether each tool runs, asks first, or is refused; the form edits the default and keeps per-tool modes. */
  toolPolicy: McpToolPolicy
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
  /** The tool whose mode is being saved, if any. */
  readonly savingTool: string | null
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
  /** Whether the MCP status item shows below the prompt box, as the Host last accepted it. */
  readonly statusItem: boolean
  /** Whether the preference can be written; false while the settings document is read-only or still loading. */
  readonly statusItemWritable: boolean
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
  setDefaultActive: (checked: boolean) => void
  setToolDefault: (mode: McpToolMode) => void
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
  /** Give one tool its own mode, or null to follow the server default. */
  setToolMode: (tool: string, mode: McpToolMode | null) => void
  reconnect: (id: McpEntryId) => void
  setStatusItem: (shown: boolean) => void
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
    values: [], timeoutMs: '', failOnStartupError: false, defaultActive: true, toolPolicy: ASK_EVERY_CALL,
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
    defaultActive: spec.defaultActive !== false,
    toolPolicy: spec.toolPolicy ?? ASK_EVERY_CALL,
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
    ...draft.defaultActive ? {} : { defaultActive: false },
    ...asksEveryCall(draft.toolPolicy) ? {} : { toolPolicy: draft.toolPolicy },
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
  private readonly unsubscribe: () => void

  /**
   * @param ctx - the page plugin's context, whose `remote.mcpServers` namespace answers.
   * @param form - the plugin's preference form, holding whether the status item shows.
   */
  constructor(private readonly ctx: ClientContext, private readonly form: ConfigForm<McpUiSettings>) {
    this.store = createSnapshotStore<McpServersState>({
      status: 'idle', rows: [], pending: null, editor: null, removal: null, tools: null, notice: null, ...this.preference(),
    })
    this.unsubscribe = form.subscribe(() => { this.patch(this.preference()) })
  }

  private preference(): Pick<McpServersState, 'statusItem' | 'statusItemWritable'> {
    const snapshot = this.form.getSnapshot()
    return { statusItem: snapshot.value?.statusItem ?? DEFAULT_STATUS_ITEM, statusItemWritable: snapshot.writable }
  }

  /** Persist the preference; the switch follows the value the Host accepts, never the click. */
  private async setStatusItem(shown: boolean): Promise<void> {
    let accepted = false
    try {
      accepted = await this.form.set(STATUS_ITEM_FIELD, shown)
    } catch (_refusedOrUnreachable) {
      // The toast below reports the failed write while the form keeps the accepted value.
    }
    if (!this.disposed && !accepted) this.notify('failed')
  }

  /**
   * Read the page state.
   * @returns the page's current snapshot.
   */
  getSnapshot(): McpServersState { return this.store.getSnapshot() }

  /** Stop applying answers that arrive after teardown, and drop the preference subscription. */
  dispose(): void {
    this.disposed = true
    this.unsubscribe()
  }

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
      // An open tools dialog follows the state and policy the rows just reported.
      const open = this.getSnapshot().tools
      if (open !== null) await this.readTools(result.value.find(row => row.id === open.row.id) ?? open.row)
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
      setDefaultActive: (checked) => { this.patchDraft({ defaultActive: checked }) },
      setToolDefault: (mode) => {
        const editor = this.getSnapshot().editor
        if (editor !== null) this.patchDraft({ toolPolicy: { ...editor.draft.toolPolicy, default: mode } })
      },
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
      setToolMode: (tool, mode) => { void this.setToolMode(tool, mode) },
      reconnect: (id) => { void this.reconnect(id) },
      setStatusItem: (shown) => { void this.setStatusItem(shown) },
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
    this.patch({ tools: { row, status: 'loading', tools: [], connection: row.status, savingTool: null } })
    void this.readTools(row)
  }

  private async readTools(row: McpServerInfo): Promise<void> {
    const result = await this.ctx.remote.mcpServers.tools(row.id)
    const open = this.getSnapshot().tools
    if (this.disposed || open?.row.id !== row.id) return
    this.patch({
      tools: result.ok
        ? { row, status: 'ready', tools: result.value.tools, connection: result.value.status, savingTool: open.savingTool }
        : { ...open, row, status: 'failed' },
    })
  }

  /** Write one tool's mode into the open server's policy; a row without a server name has no policy to address. */
  private async setToolMode(tool: string, mode: McpToolMode | null): Promise<void> {
    const open = this.getSnapshot().tools
    if (open === null || open.savingTool !== null || open.row.serverName === '') return
    const { [tool]: _previous, ...rest } = open.row.toolPolicy.tools
    const policy: McpToolPolicy = { default: open.row.toolPolicy.default, tools: mode === null ? rest : { ...rest, [tool]: mode } }
    this.patch({ tools: { ...open, savingTool: tool } })
    const result = await this.ctx.remote.mcpServers.setToolPolicy(open.row.id, policy)
    if (this.disposed) return
    const after = this.getSnapshot().tools
    if (after !== null) this.patch({ tools: { ...after, savingTool: null } })
    this.settle(result.ok ? result.value : undefined, 'saved')
    await this.read()
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
