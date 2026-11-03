/**
 * Registry of the live tool lists and usage counters of configured MCP
 * servers. MCP clients register one handle per server; consumers read the
 * handles and are told when a tool list changes. Connection state is each
 * client's own status (`connectionStatusOf`, or `mcpManager` for managed servers).
 *
 * @module @deepseek-ai/dsh-mcp-status
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { McpConfiguredServer, McpServerHandle, McpServerStats, McpToolInfo } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live tool lists and usage of the configured MCP servers. */
    mcpStatus: McpStatusRuntime
  }

  interface Events {
    /**
     * A registered server's tool list changed, or a server was registered or removed.
     * @mode emit
     * @param server - the configured `serverName`.
     */
    'mcp-status/changed'(server: string): void
  }
}

/** The shared registry the MCP clients register into. */
export class McpStatusRuntime extends Service {
  private readonly entries = new Set<{ server: string; handle: McpServerHandle }>()
  /** Every server name in first-registration order; a re-registration, such as a restart, keeps its place. */
  private readonly order: string[] = []

  /** @param ctx - the context that owns the registry. */
  constructor(ctx: Context) {
    super(ctx, 'mcpStatus')
  }

  /**
   * Publish one server and relay its changes as `mcp-status/changed`.
   * @param server - configured server name.
   * @param handle - live reads of the server's tools and usage.
   * @returns the disposer that removes this registration.
   */
  register(server: string, handle: McpServerHandle): () => void {
    const entry = { server, handle }
    // oxlint-disable-next-line typescript/no-misused-promises -- the disposer below is synchronous
    return this.ctx.effect(() => {
      if (!this.order.includes(server)) this.order.push(server)
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
   * Name every registered server with its configured default.
   * @returns one entry per registration, in the order each name first registered.
   */
  servers(): McpConfiguredServer[] {
    return [...this.entries]
      .sort((left, right) => this.order.indexOf(left.server) - this.order.indexOf(right.server))
      .map(entry => ({ serverName: entry.server, defaultActive: entry.handle.defaultActive }))
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
   * @param session - a Session id; when given, the counters cover only that Session's calls.
   * @returns its stats, or undefined when no client registered it.
   */
  stats(server: string, session?: string): McpServerStats | undefined {
    return this.find(server)?.stats(session)
  }

  private find(server: string): McpServerHandle | undefined {
    for (const entry of this.entries) if (entry.server === server) return entry.handle
    return undefined
  }
}

export default McpStatusRuntime
