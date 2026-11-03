/**
 * State of the MCP servers page: the servers the MCP manager runs, joined
 * with their Settings entries, tool-call policies, and session defaults; the
 * editor draft; and the confirmations. Entries, policies, and defaults are
 * read and written through the Settings Remote, secrets through the
 * credentials Remote, and live status, restart, and probe through the
 * `mcpManager` Remote. The controller re-reads after each change and never
 * keeps a server the Host did not report.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {
  ClientRemote, CredentialInfo, McpManagedServerStatus, McpToolInfo, McpToolMode, McpToolPolicy, SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_STATUS_ITEM, STATUS_ITEM_FIELD, type McpUiSettings } from '../mcp-ui-settings.ts'
import {
  commandLine, CREDENTIAL_REF, draftValue, isRecord, MANAGER_NS, mapField, parseEntry, parsePolicy, POLICY_NS, SELECTION_NS, SERVER_NAME,
  storedValue, suggestRef, type McpEntry, type ValueDraft,
} from './entries.ts'
import type { McpFleet, McpFleetState } from './fleet.ts'
import { ASK_EVERY_CALL } from './tool-modes.ts'

export type { ValueDraft, ValueMode } from './entries.ts'

/** Outcome of one probe, as the manager reports it. */
export type McpProbeResult = Extract<Awaited<ReturnType<ClientRemote['mcpManager']['probe']>>, { ok: true }>['value']

/**
 * Where a listed server comes from. `user` entries were added through Settings
 * and can be removed; `inherited` entries come from the profile and can be
 * overridden; `overridden` ones carry a Settings override that can be dropped;
 * `plugin` servers are registered by an installed plugin; `removed` servers
 * left a cleanup failure behind and stay listed until the Host restarts.
 */
export type McpServerSource = 'user' | 'inherited' | 'overridden' | 'plugin' | 'removed'

/** One server as the page lists it. */
export interface McpServerRow {
  readonly name: string
  readonly source: McpServerSource
  /** The resolved Settings entry; absent for plugin-registered and removed servers. */
  readonly entry: McpEntry | undefined
  /** The manager's live status; absent until the manager has listed the server. */
  readonly status: McpManagedServerStatus | undefined
  /** Whether each tool runs, asks first, or is refused. */
  readonly policy: McpToolPolicy
  /** Whether a Session that has made no selection of its own uses the server. */
  readonly defaultActive: boolean
}

/** The form's staged values. */
export interface EditorDraft {
  /** The server being edited; absent for a new server. */
  readonly editing: string | undefined
  transport: McpEntry['transport']
  serverName: string
  command: string
  /** One argument per line. */
  args: string
  cwd: string
  url: string
  /** `env` for a local command, `headers` for an HTTP endpoint. */
  values: ValueDraft[]
  timeoutMs: string
  defaultActive: boolean
  /** Whether each tool runs, asks first, or is refused; the form edits the default and keeps per-tool modes. */
  toolPolicy: McpToolPolicy
}

/** Why the editor's last save did not land. */
export interface EditorError {
  /** A local check, a Host refusal, or `transport` when the Host did not answer. */
  readonly code: 'invalid-name' | 'duplicate' | 'timeout' | 'credential-ref' | 'refused' | 'transport'
  /** The Host's explanation, shown beside the localized sentence; empty for local errors. */
  readonly detail: string
}

/** The command the person is asked to trust before a local server is saved. */
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
  /** What the credentials provider holds for each referenced credential, by reference. */
  readonly credentials: Readonly<Record<string, CredentialInfo>>
}

/** The server awaiting removal or restoration confirmation. */
export interface RemovalState {
  readonly row: McpServerRow
  readonly saving: boolean
}

/** The tools dialog: one server's tools as the Host last reported them. */
export interface ToolsState {
  readonly name: string
  readonly status: 'loading' | 'ready' | 'failed'
  readonly tools: readonly McpToolInfo[]
  /** The tool whose mode is being saved, if any. */
  readonly savingTool: string | null
}

/** The connection test of one server. */
export interface ProbeState {
  readonly name: string
  readonly status: 'running' | 'done' | 'failed'
  readonly result: McpProbeResult | undefined
  /** Why the Host did not run the probe, when it refused it. */
  readonly detail: string
}

/** What the last action leaves to say, shown as a toast; `seq` tells one showing from the next. */
export interface McpNotice {
  readonly kind: 'saved' | 'removed' | 'restored' | 'enabled' | 'disabled' | 'restarted' | 'failed' | 'refresh-failed'
  /** The Host's explanation of a failure, when it gave one. */
  readonly detail: string
  readonly seq: number
}

/** What the page renders. */
export interface McpServersState {
  /** `missing` when the profile mounts no MCP manager. */
  readonly status: 'idle' | 'loading' | 'ready' | 'failed' | 'missing'
  readonly rows: readonly McpServerRow[]
  /** Whether Settings accepts writes; false disables every change control. */
  readonly writable: boolean
  /** The server with a toggle, restart, or policy write in flight. */
  readonly pending: string | null
  readonly editor: EditorState | null
  readonly removal: RemovalState | null
  readonly tools: ToolsState | null
  readonly probe: ProbeState | null
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
  openEdit: (name: string) => void
  closeEditor: () => void
  setTransport: (transport: McpEntry['transport']) => void
  editField: (field: DraftField, text: string) => void
  setDefaultActive: (checked: boolean) => void
  setToolDefault: (mode: McpToolMode) => void
  addValue: () => void
  editValue: (uid: number, change: Partial<Pick<ValueDraft, 'key' | 'mode' | 'text' | 'secret'>>) => void
  removeValue: (uid: number) => void
  save: () => void
  acknowledge: (checked: boolean) => void
  confirmSave: () => void
  cancelConfirm: () => void
  toggle: (name: string, enabled: boolean) => void
  askRemove: (name: string) => void
  openTools: (name: string) => void
  closeTools: () => void
  /** Give one tool its own mode, or null to follow the server default. */
  setToolMode: (tool: string, mode: McpToolMode | null) => void
  restart: (name: string) => void
  /** Test one server's connection without touching the running instance. */
  probe: (name: string) => void
  closeProbe: () => void
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
    editing: undefined, transport: 'stdio', serverName: '', command: '', args: '', cwd: '', url: '',
    values: [], timeoutMs: '', defaultActive: true, toolPolicy: ASK_EVERY_CALL,
  }
}

/**
 * Stage a listed server for the form.
 * @param row - the server being edited; it must carry an entry.
 * @param entry - the server's resolved entry.
 * @param uid - next free value identity; entries take consecutive ids from it.
 * @returns the draft and the next free identity.
 */
export function draftFromRow(row: McpServerRow, entry: McpEntry, uid: number): { draft: EditorDraft; next: number } {
  const entries = Object.entries(entry.transport === 'stdio' ? entry.env : entry.headers)
  const values = entries.map(([key, value], index) => draftValue(uid + index, key, value))
  const draft: EditorDraft = {
    editing: row.name, transport: entry.transport, serverName: row.name, values,
    command: entry.command, args: entry.args.join('\n'), cwd: entry.cwd, url: entry.url,
    timeoutMs: entry.toolCallTimeoutMs === undefined ? '' : String(entry.toolCallTimeoutMs),
    defaultActive: row.defaultActive, toolPolicy: row.policy,
  }
  return { draft, next: uid + entries.length }
}

/**
 * The entry a draft stages, starting from the stored entry so fields the form does not edit survive.
 * Blank names are dropped and a later value replaces an earlier one with the same name.
 * @param draft - the form's staged values.
 * @param stored - the entry as stored, when one is being edited.
 * @returns the entry to write, or null when the timeout is not a whole number.
 */
export function entryFromDraft(draft: EditorDraft, stored: Record<string, JsonValue> | undefined): Record<string, JsonValue> | null {
  const timeout = draft.timeoutMs.trim()
  if (timeout !== '' && !/^[1-9]\d*$/.test(timeout)) return null
  const values: Record<string, string> = {}
  for (const entry of draft.values) {
    if (entry.key.trim() !== '') values[entry.key.trim()] = storedValue(entry)
  }
  const {
    command: _command, args: _args, env: _env, cwd: _cwd, url: _url, headers: _headers, toolCallTimeoutMs: _timeout, ...kept
  } = stored ?? {}
  const common = { ...kept, transport: draft.transport, ...timeout === '' ? {} : { toolCallTimeoutMs: Number(timeout) } }
  if (draft.transport === 'streamable-http') return { ...common, url: draft.url.trim(), headers: values }
  return {
    ...common,
    command: draft.command.trim(),
    args: draft.args.split('\n').map(line => line.replace(/\r$/, '')).filter(line => line !== ''),
    env: values,
    cwd: draft.cwd.trim(),
  }
}

/** Arguments of a draft as the entry stores them. */
function draftArgs(draft: EditorDraft): string[] {
  return draft.args.split('\n').map(line => line.replace(/\r$/, '')).filter(line => line !== '')
}

function messageOf(error: { message: string }): string {
  return error.message
}

/** The Settings namespaces the page reads, by role. */
interface SettingsViews {
  readonly writable: boolean
  readonly manager: SettingsNamespaceView | undefined
  readonly policy: SettingsNamespaceView | undefined
  readonly selection: SettingsNamespaceView | undefined
}

/**
 * Join the Settings entries with the manager's live list.
 * @param views - the namespaces read from Settings.
 * @param fleet - the manager's last reported list; undefined before the first one.
 * @returns configured entries in Settings order, then plugin registrations, then retained cleanup failures.
 */
export function joinRows(views: SettingsViews, fleet: McpFleetState['servers']): McpServerRow[] {
  const resolved = mapField(views.manager?.value, 'servers')
  const base = mapField(views.manager?.base, 'servers')
  const user = mapField(views.manager?.user, 'servers')
  const policies = mapField(views.policy?.value, 'servers')
  const defaults = mapField(views.selection?.value, 'defaultActive')
  const live = new Map((fleet ?? []).map(view => [view.name, view]))
  const facts = (name: string): Pick<McpServerRow, 'status' | 'policy' | 'defaultActive'> => ({
    status: live.get(name)?.status,
    policy: parsePolicy(policies[name]),
    defaultActive: defaults[name] !== false,
  })
  const rows: McpServerRow[] = []
  for (const [name, value] of Object.entries(resolved)) {
    const entry = parseEntry(value)
    const inherited = Object.hasOwn(base, name)
    const source: McpServerSource = !inherited ? 'user' : Object.hasOwn(user, name) ? 'overridden' : 'inherited'
    rows.push({ name, source, entry, ...facts(name) })
  }
  for (const view of fleet ?? []) {
    if (Object.hasOwn(resolved, view.name)) continue
    rows.push({ name: view.name, source: view.configured ? 'plugin' : 'removed', entry: undefined, ...facts(view.name) })
  }
  return rows
}

/** Reads and changes the profile's MCP servers. */
export class McpServersController {
  private readonly store: SnapshotStore<McpServersState>
  private views: SettingsViews = { writable: false, manager: undefined, policy: undefined, selection: undefined }
  private uid = 0
  private generation = 0
  private credentialGeneration = 0
  private seq = 0
  private disposed = false
  private probeLifetime: AbortController | undefined
  private readonly unsubscribe: Array<() => void>

  /**
   * @param ctx - the page plugin's context, whose `remote.settings`, `remote.credentials`, `remote.mcpManager`,
   * and `remote.mcpServers` namespaces answer.
   * @param form - the plugin's preference form, holding whether the status item shows.
   * @param fleet - the manager's live server list.
   */
  constructor(private readonly ctx: ClientContext, private readonly form: ConfigForm<McpUiSettings>, private readonly fleet: McpFleet) {
    this.store = createSnapshotStore<McpServersState>({
      status: 'idle', rows: [], writable: false, pending: null, editor: null, removal: null, tools: null, probe: null, notice: null,
      ...this.preference(),
    })
    this.unsubscribe = [
      form.subscribe(() => { this.patch(this.preference()) }),
      fleet.store.subscribe(() => { this.rejoin() }),
    ]
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

  /** Stop applying answers that arrive after teardown, cancel a running probe, and drop the subscriptions. */
  dispose(): void {
    this.disposed = true
    this.probeLifetime?.abort(new Error('MCP servers page closed'))
    for (const unsubscribe of this.unsubscribe) unsubscribe()
  }

  /** Re-read Settings when the page has been opened; a page never rendered holds nothing to refresh. */
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

  private notify(kind: McpNotice['kind'], detail = ''): void {
    this.patch({ notice: { kind, detail, seq: ++this.seq } })
  }

  private rejoin(): void {
    if (this.getSnapshot().status === 'ready') this.patch({ rows: joinRows(this.views, this.fleet.store.getSnapshot().servers) })
  }

  private remember(view: SettingsNamespaceView): void {
    const role = view.ns === MANAGER_NS ? 'manager' : view.ns === POLICY_NS ? 'policy' : view.ns === SELECTION_NS ? 'selection' : undefined
    if (role === undefined) return
    this.views = { ...this.views, [role]: view }
    this.rejoin()
  }

  /** Read the Settings namespaces; the first read shows the loading state, later reads keep the rows on screen. */
  async read(): Promise<void> {
    const generation = ++this.generation
    if (this.getSnapshot().status === 'idle') this.patch({ status: 'loading' })
    this.fleet.start()
    const result = await this.ctx.remote.settings.describe()
    if (this.disposed || generation !== this.generation) return
    if (!result.ok) {
      if (this.getSnapshot().status === 'ready') this.notify('refresh-failed')
      else this.patch({ status: 'failed' })
      return
    }
    const byNs = new Map(result.value.namespaces.map(view => [view.ns, view]))
    this.views = {
      writable: result.value.writable,
      manager: byNs.get(MANAGER_NS),
      policy: byNs.get(POLICY_NS),
      selection: byNs.get(SELECTION_NS),
    }
    if (this.views.manager === undefined) {
      this.patch({ status: 'missing', rows: [], writable: false })
      return
    }
    this.patch({ status: 'ready', writable: result.value.writable, rows: joinRows(this.views, this.fleet.store.getSnapshot().servers) })
  }

  /**
   * Apply path edits to one namespace at the revision last read.
   * @returns undefined when the write landed, else the Host's explanation.
   */
  private async mutate(ns: string, ops: SettingsPathOpView[]): Promise<string | undefined> {
    const view = ns === MANAGER_NS ? this.views.manager : ns === POLICY_NS ? this.views.policy : this.views.selection
    if (view === undefined) return `The profile has no "${ns}" entry`
    const result = await this.ctx.remote.settings.mutate(ns, ops, view.revision)
    if (!result.ok) return messageOf(result.error)
    this.remember(result.value)
    return undefined
  }

  /**
   * Build the face the slot entries inject.
   * @returns the page snapshot store and its actions.
   */
  inject(): McpServersFace {
    return {
      hooks: { mcpServers: this.store },
      load: () => { void this.read() },
      openAdd: () => { this.patch({ editor: { draft: emptyDraft(), saving: false, error: null, confirm: null, credentials: {} } }) },
      openEdit: (name) => { this.openEdit(name) },
      closeEditor: () => { this.patch({ editor: null }) },
      setTransport: (transport) => { this.patchDraft({ transport, values: [] }) },
      editField: (field, text) => { this.patchDraft({ [field]: text }) },
      setDefaultActive: (checked) => { this.patchDraft({ defaultActive: checked }) },
      setToolDefault: (mode) => {
        const editor = this.getSnapshot().editor
        if (editor !== null) this.patchDraft({ toolPolicy: { ...editor.draft.toolPolicy, default: mode } })
      },
      addValue: () => { this.addValue() },
      editValue: (uid, change) => { this.editValue(uid, change) },
      removeValue: (uid) => { this.removeValue(uid) },
      save: () => { void this.save(false) },
      acknowledge: (checked) => { this.acknowledge(checked) },
      confirmSave: () => { this.confirmSave() },
      cancelConfirm: () => { this.patchEditor({ confirm: null }) },
      toggle: (name, enabled) => { void this.toggle(name, enabled) },
      askRemove: (name) => { this.askRemove(name) },
      cancelRemove: () => { this.patch({ removal: null }) },
      openTools: (name) => { this.openTools(name) },
      closeTools: () => { this.patch({ tools: null }) },
      setToolMode: (tool, mode) => { void this.setToolMode(tool, mode) },
      restart: (name) => { void this.restart(name) },
      probe: (name) => { void this.probe(name) },
      closeProbe: () => { this.closeProbe() },
      setStatusItem: (shown) => { void this.setStatusItem(shown) },
      confirmRemove: () => { void this.confirmRemove() },
      dismissNotice: () => { this.patch({ notice: null }) },
    }
  }

  private row(name: string): McpServerRow | undefined {
    return this.getSnapshot().rows.find(candidate => candidate.name === name)
  }

  private openEdit(name: string): void {
    const row = this.row(name)
    if (row?.entry === undefined) return
    const { draft, next } = draftFromRow(row, row.entry, this.uid)
    this.uid = next
    this.patch({ editor: { draft, saving: false, error: null, confirm: null, credentials: {} } })
    void this.checkCredentials()
  }

  private addValue(): void {
    const editor = this.getSnapshot().editor
    if (editor === null) return
    const entry: ValueDraft = { uid: this.uid++, key: '', mode: 'literal', text: '', secret: '' }
    this.patchDraft({ values: [...editor.draft.values, entry] })
  }

  private editValue(uid: number, change: Partial<Pick<ValueDraft, 'key' | 'mode' | 'text' | 'secret'>>): void {
    const editor = this.getSnapshot().editor
    if (editor === null) return
    const draft = editor.draft
    this.patchDraft({
      values: draft.values.map((entry) => {
        if (entry.uid !== uid) return entry
        const next = { ...entry, ...change }
        // Switching to a credential proposes a reference; the literal text never becomes one.
        if (change.mode !== undefined && change.mode !== entry.mode && change.mode !== 'literal' && entry.mode === 'literal') {
          next.text = suggestRef(draft.serverName.trim(), next.key.trim())
        }
        if (change.mode === 'literal' && entry.mode !== 'literal') next.text = ''
        if (next.mode === 'literal') next.secret = ''
        return next
      }),
    })
    if (change.mode !== undefined || change.text !== undefined) void this.checkCredentials()
  }

  private removeValue(uid: number): void {
    const editor = this.getSnapshot().editor
    if (editor === null) return
    this.patchDraft({ values: editor.draft.values.filter(entry => entry.uid !== uid) })
  }

  /** Ask the credentials provider which of the draft's references hold a value. */
  private async checkCredentials(): Promise<void> {
    const editor = this.getSnapshot().editor
    if (editor === null) return
    const refs = [...new Set(editor.draft.values.filter(entry => entry.mode !== 'literal').map(entry => entry.text.trim()))]
      .filter(ref => CREDENTIAL_REF.test(ref))
    const generation = ++this.credentialGeneration
    if (refs.length === 0) {
      this.patchEditor({ credentials: {} })
      return
    }
    const result = await this.ctx.remote.credentials.describe(refs)
    if (this.disposed || generation !== this.credentialGeneration || !result.ok) return
    this.patchEditor({ credentials: result.value })
  }

  private acknowledge(checked: boolean): void {
    const confirm = this.getSnapshot().editor?.confirm
    if (confirm !== null && confirm !== undefined) this.patchEditor({ confirm: { ...confirm, acknowledged: checked } })
  }

  private confirmSave(): void {
    if (this.getSnapshot().editor?.confirm?.acknowledged === true) void this.save(true)
  }

  /** The local checks a draft must pass before anything is written. */
  private check(draft: EditorDraft): EditorError | null {
    const name = draft.serverName.trim()
    if (draft.editing === undefined) {
      if (!SERVER_NAME.test(name)) return { code: 'invalid-name', detail: '' }
      if (this.row(name) !== undefined) return { code: 'duplicate', detail: '' }
    }
    const bad = draft.values.find(entry => entry.key.trim() !== '' && entry.mode !== 'literal' && !CREDENTIAL_REF.test(entry.text.trim()))
    if (bad !== undefined) return { code: 'credential-ref', detail: bad.key.trim() }
    return null
  }

  /**
   * Store typed secrets, then write the entry, its policy default, and its session default.
   * A new or changed local command waits for the person to trust its command line first.
   * @param confirmed - whether the person trusted the command line shown.
   */
  private async save(confirmed: boolean): Promise<void> {
    const editor = this.getSnapshot().editor
    if (editor === null || editor.saving) return
    const { draft } = editor
    const problem = this.check(draft)
    if (problem !== null) {
      this.patchEditor({ error: problem, confirm: null })
      return
    }
    const previous = draft.editing === undefined ? undefined : this.row(draft.editing)
    const entry = entryFromDraft(draft, previous?.entry?.raw)
    if (entry === null) {
      this.patchEditor({ error: { code: 'timeout', detail: '' }, confirm: null })
      return
    }
    const name = draft.serverName.trim()
    if (draft.transport === 'stdio' && !confirmed) {
      const line = commandLine(draft.command.trim(), draftArgs(draft))
      const before = previous?.entry?.transport === 'stdio' ? commandLine(previous.entry.command, previous.entry.args) : undefined
      if (line !== before) {
        this.patchEditor({ confirm: { command: line, acknowledged: false } })
        return
      }
    }
    this.patchEditor({ saving: true, error: null })
    const refused = await this.writeDraft(draft, name, entry, previous)
    if (this.disposed || this.getSnapshot().editor === null) return
    if (refused !== undefined) {
      this.patchEditor({ saving: false, confirm: null, error: refused })
      return
    }
    this.patch({ editor: null })
    this.notify('saved')
  }

  /** @returns undefined when every write landed, else the error the editor shows. */
  private async writeDraft(
    draft: EditorDraft, name: string, entry: Record<string, JsonValue>, previous: McpServerRow | undefined,
  ): Promise<EditorError | undefined> {
    try {
      for (const value of draft.values) {
        if (value.mode === 'literal' || value.secret === '') continue
        const stored = await this.ctx.remote.credentials.set(value.text.trim(), value.secret)
        if (!stored.ok) return { code: 'refused', detail: messageOf(stored.error) }
      }
      const written = await this.mutate(MANAGER_NS, [{ op: 'set', path: ['servers', name], value: entry }])
      if (written !== undefined) return { code: 'refused', detail: written }
      const policy = previous?.policy ?? ASK_EVERY_CALL
      if (draft.toolPolicy.default !== policy.default) {
        const value = { default: draft.toolPolicy.default, tools: { ...draft.toolPolicy.tools } }
        const failed = await this.mutate(POLICY_NS, [{ op: 'set', path: ['servers', name], value }])
        if (failed !== undefined) return { code: 'refused', detail: failed }
      }
      if (draft.defaultActive !== (previous?.defaultActive ?? true)) {
        const ops: SettingsPathOpView[] = draft.defaultActive
          ? [{ op: 'unset', path: ['defaultActive', name] }]
          : [{ op: 'set', path: ['defaultActive', name], value: false }]
        const failed = await this.mutate(SELECTION_NS, ops)
        if (failed !== undefined) return { code: 'refused', detail: failed }
      }
    } catch (_unreachable) {
      return { code: 'transport', detail: '' }
    }
    return undefined
  }

  private async toggle(name: string, enabled: boolean): Promise<void> {
    if (this.getSnapshot().pending !== null) return
    this.patch({ pending: name })
    const failed = await this.mutate(MANAGER_NS, [{ op: 'set', path: ['servers', name, 'enabled'], value: enabled }])
      .catch((_unreachable: unknown) => '')
    if (this.disposed) return
    this.patch({ pending: null })
    if (failed === undefined) this.notify(enabled ? 'enabled' : 'disabled')
    else this.notify('failed', failed)
  }

  private openTools(name: string): void {
    if (this.row(name) === undefined) return
    this.patch({ tools: { name, status: 'loading', tools: [], savingTool: null } })
    void this.readTools(name)
  }

  private async readTools(name: string): Promise<void> {
    const result = await this.ctx.remote.mcpServers.tools(name)
    const open = this.getSnapshot().tools
    if (this.disposed || open?.name !== name) return
    this.patch({ tools: result.ok ? { ...open, status: 'ready', tools: result.value.tools } : { ...open, status: 'failed' } })
  }

  /** Write one tool's mode into the open server's policy. */
  private async setToolMode(tool: string, mode: McpToolMode | null): Promise<void> {
    const open = this.getSnapshot().tools
    const row = open === null ? undefined : this.row(open.name)
    if (open === null || row === undefined || open.savingTool !== null) return
    const { [tool]: _previous, ...rest } = row.policy.tools
    const value = { default: row.policy.default, tools: mode === null ? rest : { ...rest, [tool]: mode } }
    this.patch({ tools: { ...open, savingTool: tool } })
    const failed = await this.mutate(POLICY_NS, [{ op: 'set', path: ['servers', open.name], value }])
      .catch((_unreachable: unknown) => '')
    if (this.disposed) return
    const after = this.getSnapshot().tools
    if (after !== null) this.patch({ tools: { ...after, savingTool: null } })
    if (failed === undefined) this.notify('saved')
    else this.notify('failed', failed)
  }

  private async restart(name: string): Promise<void> {
    if (this.getSnapshot().pending !== null) return
    this.patch({ pending: name })
    const result = await this.ctx.remote.mcpManager.restart(name)
    if (this.disposed) return
    this.patch({ pending: null })
    if (result.ok) this.notify('restarted')
    else this.notify('failed', messageOf(result.error))
  }

  private async probe(name: string): Promise<void> {
    this.probeLifetime?.abort(new Error('MCP probe replaced'))
    const lifetime = new AbortController()
    this.probeLifetime = lifetime
    this.patch({ probe: { name, status: 'running', result: undefined, detail: '' } })
    const result = await this.ctx.remote.mcpManager.probe(name, lifetime.signal)
    if (this.disposed || this.probeLifetime !== lifetime) return
    this.probeLifetime = undefined
    this.patch({
      probe: result.ok
        ? { name, status: 'done', result: result.value, detail: '' }
        : { name, status: 'failed', result: undefined, detail: messageOf(result.error) },
    })
  }

  private closeProbe(): void {
    this.probeLifetime?.abort(new Error('MCP probe cancelled'))
    this.probeLifetime = undefined
    this.patch({ probe: null })
  }

  private askRemove(name: string): void {
    const row = this.row(name)
    if (row !== undefined && (row.source === 'user' || row.source === 'overridden')) this.patch({ removal: { row, saving: false } })
  }

  /**
   * Unset a server's Settings entry. Removing a server added here also drops its
   * stored tool policy and session default, so a later server of the same name
   * does not inherit allowances granted to this one.
   * @returns undefined when every write landed, else the Host's explanation.
   */
  private async dropServer(row: McpServerRow): Promise<string | undefined> {
    const failed = await this.mutate(MANAGER_NS, [{ op: 'unset', path: ['servers', row.name] }])
    if (failed !== undefined || row.source !== 'user') return failed
    const policies = this.views.policy?.user
    if (isRecord(policies) && isRecord(policies['servers']) && Object.hasOwn(policies['servers'], row.name)) {
      const dropped = await this.mutate(POLICY_NS, [{ op: 'unset', path: ['servers', row.name] }])
      if (dropped !== undefined) return dropped
    }
    const defaults = this.views.selection?.user
    if (isRecord(defaults) && isRecord(defaults['defaultActive']) && Object.hasOwn(defaults['defaultActive'], row.name)) {
      return this.mutate(SELECTION_NS, [{ op: 'unset', path: ['defaultActive', row.name] }])
    }
    return undefined
  }

  /** Remove a server added here, or drop the override of an inherited one; either unsets its Settings entry. */
  private async confirmRemove(): Promise<void> {
    const removal = this.getSnapshot().removal
    if (removal === null || removal.saving) return
    this.patch({ removal: { ...removal, saving: true } })
    const failed = await this.dropServer(removal.row)
      .catch((_unreachable: unknown) => '')
    if (this.disposed) return
    this.patch({ removal: null })
    if (failed !== undefined) this.notify('failed', failed)
    else this.notify(removal.row.source === 'overridden' ? 'restored' : 'removed')
  }
}
