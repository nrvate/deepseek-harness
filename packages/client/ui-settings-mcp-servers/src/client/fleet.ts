/**
 * The MCP manager's live server list, read once for the page, the status item,
 * and the selector. One `mcpManager.watch` stream delivers the complete list
 * on subscription and after every change; a stream that ends or fails is
 * reopened on the next `refresh`, which the plugin calls on connection reset.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { McpManagedServerView } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** What the watcher holds. */
export interface McpFleetState {
  /** The last list the manager reported; undefined before the first one. */
  readonly servers: readonly McpManagedServerView[] | undefined
  /** Whether the stream ended or failed and waits to be reopened. */
  readonly stopped: boolean
}

/** Holds the manager's server list while the plugin runs. */
export class McpFleet {
  /** Snapshot of the list, for controllers and components to subscribe to. */
  readonly store: SnapshotStore<McpFleetState> = createSnapshotStore<McpFleetState>({ servers: undefined, stopped: false })
  private lifetime: AbortController | undefined
  private disposed = false

  /** @param ctx - the plugin context whose `remote.mcpManager` namespace answers. */
  constructor(private readonly ctx: ClientContext) {}

  /** Open the stream unless one is running. */
  start(): void {
    if (this.disposed || this.lifetime !== undefined) return
    const lifetime = new AbortController()
    this.lifetime = lifetime
    this.store.set({ ...this.store.getSnapshot(), stopped: false })
    void this.run(lifetime)
  }

  /** Reopen the stream after it stopped, for example after the connection to the Host was reset. */
  refresh(): void {
    if (this.store.getSnapshot().stopped) this.start()
  }

  /** Close the stream for good. */
  dispose(): void {
    this.disposed = true
    this.lifetime?.abort(new Error('MCP server list closed'))
    this.lifetime = undefined
  }

  private async run(lifetime: AbortController): Promise<void> {
    try {
      for await (const servers of this.ctx.remote.mcpManager.watch(lifetime.signal)) {
        if (lifetime.signal.aborted) return
        this.store.set({ servers, stopped: false })
      }
    } catch (_endedOrUnreachable) {
      // The stream stops; the next refresh reopens it, and the list on screen stays until then.
    }
    if (this.lifetime !== lifetime) return
    this.lifetime = undefined
    if (!this.disposed) this.store.set({ ...this.store.getSnapshot(), stopped: true })
  }
}
