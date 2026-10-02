/**
 * Pure types of the MCP selection domain: the one home of the `mcpServers`
 * projection-key declaration, free of this package's Host-side value imports.
 * `./types` serves Host consumers and `./client` serves client aggregates.
 *
 * @module @deepseek-ai/dsh-mcp-selection/types
 */

/**
 * The `mcpServers` projection's wire value. `active` is the Session's logged
 * selection, or null while the Session has logged none and follows each
 * server's configured default. A name may outlive its server: readers match the
 * list against the servers configured now. Capability absence (the selection
 * service not composed) is the key's absence, never a value.
 */
export interface McpServersProjection {
  active: readonly string[] | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host fold state of the logged MCP server selection. */
    mcpServers: McpServersProjection
  }
  interface SessionProjectionMap {
    /** The Session's logged MCP server selection, folded from `mcp/servers` events. */
    mcpServers: McpServersProjection
  }
}
