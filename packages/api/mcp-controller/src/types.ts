/** Records shared by the MCP server Remote and its clients. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PluginFiberPhase } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import type { McpServerStats, McpServerStatus, McpToolInfo } from '@deepseek-ai/dsh-mcp-status/types'

export type {
  McpConnectionState, McpServerStats, McpServerStatus, McpToolInfo, McpToolParameter, McpToolUsage,
} from '@deepseek-ai/dsh-mcp-status/types'

/** Row id as the profile patch declares it. */
export type McpEntryId = Branded<'McpEntryId'>

/**
 * One `env` or `headers` value. `env` references the Host process environment at
 * load time; `expression` is a `!!js` value the file already holds, shown as-is
 * and kept only while the same source is sent back for the same key; `kept` stands
 * for a literal secret the file already holds, which the Host never returns.
 */
export type McpValue =
  | { kind: 'literal'; value: string }
  | { kind: 'env'; name: string; scheme?: 'Bearer' }
  | { kind: 'expression'; source: string }
  | { kind: 'kept' }

/** What happens when the model calls a tool: run it, ask the person first, or refuse it. */
export type McpToolMode = 'allow' | 'ask' | 'deny'

/** Whether each of a server's tools runs, asks first, or is refused. */
export interface McpToolPolicy {
  /** Mode of every tool `tools` does not name. */
  default: McpToolMode
  /** Modes by the server's own tool name. */
  tools: Record<string, McpToolMode>
}

/** Fields every transport shares. */
export interface McpSpecBase {
  /** Local namespace of the server's tool names; `[A-Za-z0-9_-]{1,32}`. */
  serverName: string
  /** Timeout per tool call or resource request in milliseconds; omitted keeps the plugin default. */
  toolCallTimeoutMs?: number
  /** Fail plugin activation when the first connection fails; omitted keeps the plugin default. */
  failOnStartupError?: boolean
  /** Whether a Session that has made no selection of its own uses this server; omitted keeps the plugin default, which is true. */
  defaultActive?: boolean
  /** Tool-call policy; omitted asks before every call. */
  toolPolicy?: McpToolPolicy
}

/** A local server started as a child process. */
export interface McpStdioSpec extends McpSpecBase {
  transport: 'stdio'
  command: string
  args: string[]
  env: Record<string, McpValue>
  /** Working directory; omitted keeps the Host's. */
  cwd?: string
}

/** A server reached over Streamable HTTP. */
export interface McpHttpSpec extends McpSpecBase {
  transport: 'streamable-http'
  url: string
  headers: Record<string, McpValue>
}

/** Editable configuration of one MCP server. */
export type McpServerSpec = McpStdioSpec | McpHttpSpec

/** Why a listed server cannot be edited or removed from the profile patch. */
export type McpReadOnlyReason =
  /** The row comes from a bundle, home patch, or command-line overlay. */
  | 'unaddressable'
  /** The row holds a `!!js` expression or other value the form cannot represent. */
  | 'custom-expression'
  /** The row's URL or command-line arguments embed a credential. */
  | 'embedded-credentials'

/** One configured MCP server row. */
export interface McpServerInfo {
  id: McpEntryId
  serverName: string
  transport: McpServerSpec['transport']
  /** The command line or URL, without secret values. */
  summary: string
  /** Whether the row loads; a disabled row keeps its configuration. */
  enabled: boolean
  /** Whether a Session that has made no selection of its own uses this server. */
  defaultActive: boolean
  /** The tool-call policy the row configures; a row that names none asks before every call. */
  toolPolicy: McpToolPolicy
  /** Root-fiber phase of the running entry; null when none is live. */
  fiberPhase: PluginFiberPhase
  /** The client's live connection state; absent while the plugin is not loaded or no status service is mounted. */
  status?: McpServerStatus
  /** Present when the row can be edited. */
  spec?: McpServerSpec
  /** Present when the row cannot be edited; it can still be enabled, disabled, or removed only if the profile patch owns it. */
  readOnlyReason?: McpReadOnlyReason
  /** Whether the profile patch owns the row, so enable, disable, and remove apply. */
  owned: boolean
}

/** Machine-readable failure of one change. */
export type McpErrorCode =
  | 'invalid-config'
  | 'duplicate-server'
  | 'confirmation-required'
  | 'literal-secret'
  | 'unknown-server'
  | 'read-only'
  | 'unreadable-patch'
  | 'operation-error'

/** Failure of one change. */
export interface McpError {
  code: McpErrorCode
  message: string
  /** Present with `confirmation-required`: the exact command line the caller must echo back. */
  command?: string
}

/** Options for `upsert`. */
export interface McpUpsertOptions {
  /** Row to replace; omitted adds a row. */
  id?: McpEntryId
  /** The command line shown to the person; required to add or change a stdio server. */
  confirmedCommand?: string
}

/** Persisted change and independently observed application outcome. */
export interface McpChangeResult {
  /** Whether the profile patch changed on disk. */
  changed: boolean
  application: 'applied' | 'restart-required' | 'failed'
  /** Row the change addressed. */
  target: string
  error?: McpError
  /** Pre-existing inactive entries the reload left as they were. */
  warnings?: string[]
}

/** A server's tools with the state they were read under. */
export interface McpToolsResult {
  /** The client's connection state; absent when no client is registered for the row. */
  status?: McpServerStatus
  /** The tools registered from the server right now. */
  tools: readonly McpToolInfo[]
}

/** Outcome of asking a server to connect now. */
export interface McpReconnectResult {
  /** False when the server was already connected or connecting, or no client is registered for the row. */
  started: boolean
}

/** One configured server with its live state and usage. */
export interface McpServerOverview {
  id: McpEntryId
  serverName: string
  /** Whether the row loads. */
  enabled: boolean
  /** Whether a Session that has made no selection of its own uses this server. */
  defaultActive: boolean
  /** The client's connection state; absent while the plugin is not loaded or no status service is mounted. */
  status?: McpServerStatus
  /** Usage counters and connection facts since the client loaded; absent with `status`. */
  stats?: McpServerStats
  /** The same counters restricted to the Session the overview was read for; absent with `stats` or when no Session was named. */
  sessionStats?: McpServerStats
}

/** The servers a Session uses after a selection. */
export interface McpSessionServers {
  /** Server names in configured order. */
  active: string[]
}

/** Every configured server's state and usage, read together. */
export interface McpOverview {
  /** Host clock when the figures were read, in epoch milliseconds, for durations such as uptime. */
  readAt: number
  servers: McpServerOverview[]
}
