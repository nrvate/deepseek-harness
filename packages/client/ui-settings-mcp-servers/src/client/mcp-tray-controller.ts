/**
 * State shared by the MCP status item below the prompt box and the server
 * selector in the composer: every server's live status from the MCP manager,
 * joined with the usage counters of its running client. Usage is read when
 * either consumer mounts, when the Host reports a change, and on a short
 * interval while the status panel is open. It also sends one Session's server
 * selection to the Host.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { McpManagedServerStatus, McpServerUsage, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { DEFAULT_STATUS_ITEM, type McpUiSettings } from '../mcp-ui-settings.ts'
import type { McpFleet, McpFleetState } from './fleet.ts'

/** Usage counters change with every tool call and announce nothing, so an open panel re-reads on this interval. */
const OPEN_PANEL_POLL_MS = 2_000

/**
 * Id of the Plugins main panel. Spelled here rather than imported: a client
 * plugin must not import another plugin's values.
 */
const PLUGINS_PANEL = 'plugins' as MainPanelId

/** One server as the status item and the selector show it. */
export interface McpTrayServer {
  readonly serverName: string
  /** The manager's live status; absent for a client the manager does not run, such as one a profile row mounts. */
  readonly status: McpManagedServerStatus | undefined
  /** Usage counters of the running client; absent while no client runs for the server. */
  readonly usage: McpServerUsage | undefined
}

/**
 * Join the manager's list with the running clients' usage.
 * @param fleet - the manager's last reported list.
 * @param usage - the last usage overview.
 * @returns managed servers in the manager's order, then clients the manager does not run; removed servers are left out.
 */
export function joinTray(fleet: McpFleetState['servers'], usage: readonly McpServerUsage[]): McpTrayServer[] {
  const byName = new Map(usage.map(server => [server.serverName, server]))
  const managed = (fleet ?? []).filter(view => view.configured)
  const names = new Set(managed.map(view => view.name))
  return [
    ...managed.map(view => ({ serverName: view.name, status: view.status, usage: byName.get(view.name) })),
    ...usage.filter(server => !names.has(server.serverName))
      .map(server => ({ serverName: server.serverName, status: undefined, usage: server })),
  ]
}

/** What the status item renders. */
export interface McpTrayState {
  /** The person's preference; false hides the item entirely. */
  readonly visible: boolean
  /** Whether the Host has answered at least once. */
  readonly loaded: boolean
  readonly servers: readonly McpTrayServer[]
  /** Host clock of the last read, in epoch milliseconds. */
  readonly readAt: number
  /** The Session whose own figures `servers[].usage.sessionStats` hold; undefined before the first read. */
  readonly statsSession: SessionId | undefined
  /** Why the last selection change did not land; cleared by the next one that does. */
  readonly problem: string | undefined
  readonly open: boolean
}

/** The registration-side face the status item's slot entry injects. */
export interface McpTrayFace {
  hooks: {
    /** Item snapshot bound by the renderer as useMcpTray. */
    mcpTray: SnapshotStore<McpTrayState>
  }
  /** Read the servers for the Session on screen. */
  load: (sessionId: SessionId) => void
  setOpen: (open: boolean) => void
  openManager: () => void
  /** Replace the servers one Session uses; resolves to whether the Host applied the selection. */
  selectServers: (sessionId: SessionId, servers: readonly string[]) => Promise<boolean>
}

/** Reads the servers' overview for the status item and polls it while the panel is open. */
export class McpTrayController {
  private readonly store: SnapshotStore<McpTrayState>
  private readonly unsubscribe: () => void
  private timer: ReturnType<typeof setInterval> | undefined
  private generation = 0
  private disposed = false
  /** The Session on screen, whose share of the usage each read asks for. */
  private session: SessionId | undefined
  private usage: readonly McpServerUsage[] = []
  private readonly unsubscribeFleet: () => void

  /**
   * @param ctx - the plugin's context, whose `remote.mcpServers` namespace answers.
   * @param form - the plugin's preference form; `statusItem` decides whether the item shows.
   * @param fleet - the manager's live server list.
   */
  constructor(private readonly ctx: ClientContext, private readonly form: ConfigForm<McpUiSettings>, private readonly fleet: McpFleet) {
    this.store = createSnapshotStore<McpTrayState>({
      visible: this.preference(), loaded: false, servers: [], readAt: 0, statsSession: undefined, problem: undefined, open: false,
    })
    this.unsubscribe = form.subscribe(() => {
      const visible = this.preference()
      if (visible === this.getSnapshot().visible) return
      if (!visible) this.stopPolling()
      this.patch({ visible, open: visible && this.getSnapshot().open })
    })
    this.unsubscribeFleet = fleet.store.subscribe(() => { this.rejoin() })
  }

  private rejoin(): void {
    this.patch({ servers: joinTray(this.fleet.store.getSnapshot().servers, this.usage) })
  }

  private preference(): boolean {
    return this.form.getSnapshot().value?.statusItem ?? DEFAULT_STATUS_ITEM
  }

  /**
   * Read the item state.
   * @returns the item's current snapshot.
   */
  getSnapshot(): McpTrayState { return this.store.getSnapshot() }

  private patch(change: Partial<McpTrayState>): void {
    this.store.set({ ...this.getSnapshot(), ...change })
  }

  /** Stop polling, drop the preference subscription, and ignore answers still in flight. */
  dispose(): void {
    this.disposed = true
    this.stopPolling()
    this.unsubscribe()
    this.unsubscribeFleet()
  }

  /** Re-read after the Host reports a change, once a consumer has mounted. */
  refresh(): void {
    if (this.getSnapshot().loaded) void this.read()
  }

  private async read(): Promise<void> {
    const generation = ++this.generation
    const session = this.session
    this.fleet.start()
    const result = await this.ctx.remote.mcpServers.overview(session)
    if (this.disposed || generation !== this.generation) return
    // A failed read keeps the figures already on screen; the next read replaces them.
    if (result.ok) {
      this.usage = result.value.servers
      this.patch({ loaded: true, readAt: result.value.readAt, statsSession: session })
      this.rejoin()
    } else {
      this.patch({ loaded: true })
    }
  }

  private async select(sessionId: SessionId, servers: readonly string[]): Promise<boolean> {
    const result = await this.ctx.remote.mcpServers.setSessionServers(sessionId, [...servers])
    if (!this.disposed) this.patch({ problem: result.ok ? undefined : result.error.message })
    return result.ok
  }

  private stopPolling(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  private setOpen(open: boolean): void {
    if (open === this.getSnapshot().open) return
    this.patch({ open })
    this.stopPolling()
    if (!open) return
    void this.read()
    this.timer = setInterval(() => { void this.read() }, OPEN_PANEL_POLL_MS)
  }

  /**
   * Build the face the status item's slot entry injects.
   * @returns the item snapshot store and its actions.
   */
  inject(): McpTrayFace {
    return {
      hooks: { mcpTray: this.store },
      load: (sessionId) => {
        this.session = sessionId
        void this.read()
      },
      setOpen: (open) => { this.setOpen(open) },
      openManager: () => {
        this.setOpen(false)
        this.ctx.layout.selectPanel(PLUGINS_PANEL)
      },
      selectServers: (sessionId, servers) => this.select(sessionId, servers),
    }
  }
}
