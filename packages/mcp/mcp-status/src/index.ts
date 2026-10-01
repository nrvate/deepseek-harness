/**
 * Registry of the live connection state and tool lists of configured MCP
 * servers. MCP clients register one handle per server; consumers read the
 * handles and are told when any of them changes.
 *
 * @module @deepseek-ai/dsh-mcp-status
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { McpServerHandle, McpServerStats, McpServerStatus, McpToolInfo } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live state of the configured MCP servers. */
    mcpStatus: McpStatusRuntime
  }

  interface Events {
    /**
     * A registered server's connection state or tool list changed, or a server was registered or removed.
     * @mode emit
     * @param server - the configured `serverName`.
     */
    'mcp-status/changed'(server: string): void
  }
}

/** The shared registry the MCP clients register into. */
export class McpStatusRuntime extends Service {
  private readonly entries = new Set<{ server: string; handle: McpServerHandle }>()

  /** @param ctx - the context that owns the registry. */
  constructor(ctx: Context) {
    super(ctx, 'mcpStatus')
  }

  /**
   * Publish one server and relay its changes as `mcp-status/changed`.
   * @param server - configured server name.
   * @param handle - live reads and the reconnect action for the server.
   * @returns the disposer that removes this registration.
   */
  register(server: string, handle: McpServerHandle): () => void {
    const entry = { server, handle }
    // oxlint-disable-next-line typescript/no-misused-promises -- the disposer below is synchronous
    return this.ctx.effect(() => {
      this.entries.add(entry)
      const unsubscribe = handle.subscribe(() => { this.ctx.emit('mcp-status/changed', server) })
      this.ctx.emit('mcp-status/changed', server)
      return () => {
        unsubscribe()
        this.entries.delete(entry)
        this.ctx.emit('mcp-status/changed', server)
      }
    }, `mcpStatus.register(${server})`)
  }

  /**
   * Read every registered server's state.
   * @returns one status per registration, in registration order.
   */
  list(): McpServerStatus[] {
    return [...this.entries].map(entry => entry.handle.status())
  }

  /**
   * Read one server's state.
   * @param server - configured server name.
   * @returns its status, or undefined when no client registered it.
   */
  get(server: string): McpServerStatus | undefined {
    return this.find(server)?.status()
  }

  /**
   * Read one server's tools.
   * @param server - configured server name.
   * @returns the tools registered from it, empty when no client registered it.
   */
  tools(server: string): readonly McpToolInfo[] {
    return this.find(server)?.tools() ?? []
  }

  /**
   * Read one server's usage counters and connection facts.
   * @param server - configured server name.
   * @returns its stats, or undefined when no client registered it.
   */
  stats(server: string): McpServerStats | undefined {
    return this.find(server)?.stats()
  }

  /**
   * Ask one server's client to connect now.
   * @param server - configured server name.
   * @returns whether a new attempt started; false for an unknown server or one already live or connecting.
   */
  async reconnect(server: string): Promise<boolean> {
    return await this.find(server)?.reconnect() ?? false
  }

  private find(server: string): McpServerHandle | undefined {
    for (const entry of this.entries) if (entry.server === server) return entry.handle
    return undefined
  }
}

export default McpStatusRuntime
