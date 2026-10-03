/**
 * Pure types of the MCP tool-call policy, shared by the store, the MCP
 * clients that enforce it, and the management surfaces that edit it.
 *
 * @module @deepseek-ai/dsh-mcp-policy/types
 */

/** What happens when the model calls a tool: run it, ask the person first, or refuse it. */
export type McpToolMode = 'allow' | 'ask' | 'deny'

/** One server's tool-call policy. */
export interface McpToolPolicy {
  /** Mode of every tool the policy does not name. */
  default: McpToolMode
  /** Modes by the server's own tool name; they override `default`. */
  tools: Record<string, McpToolMode>
}
