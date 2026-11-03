/**
 * Records shared by the `mcpServers` Remote and its clients. Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-api-mcp-controller/types
 */
import type { McpServerStats, McpToolInfo } from '@deepseek-ai/dsh-mcp-status/types'

export type { McpServerStats, McpToolInfo, McpToolParameter, McpToolUsage } from '@deepseek-ai/dsh-mcp-status/types'
export type { McpToolMode, McpToolPolicy } from '@deepseek-ai/dsh-mcp-policy/types'

/** One server's registered tools. */
export interface McpToolsResult {
  /** The tools registered from the server right now; empty while it is not connected or has no client. */
  tools: readonly McpToolInfo[]
}

/** One running server's usage and default. */
export interface McpServerUsage {
  serverName: string
  /** Whether a Session that has made no selection of its own uses this server, after the selection plugin's overrides. */
  defaultActive: boolean
  /** Usage counters and connection facts since the client loaded. */
  stats: McpServerStats
  /** The same counters restricted to the Session the overview was read for; absent when no Session was named. */
  sessionStats?: McpServerStats
}

/** Usage of every running MCP client, read together. */
export interface McpOverview {
  /** Host clock when the figures were read, in epoch milliseconds, for durations such as uptime. */
  readAt: number
  /** One entry per running client, in the order each server first registered. */
  servers: McpServerUsage[]
}

/** The servers a Session uses after a selection. */
export interface McpSessionServers {
  /** Server names in configured order. */
  active: string[]
}

/** Machine-readable failure of `allowTool`. */
export type McpAllowToolErrorCode = 'unknown-tool' | 'no-policy-store' | 'write-failed'

/** Outcome of `allowTool`. */
export type McpAllowToolResult =
  | { ok: true; serverName: string; tool: string }
  | { ok: false; code: McpAllowToolErrorCode; message: string }
