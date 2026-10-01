/** Records shared by the MCP server Remote and its clients. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PluginFiberPhase } from '@deepseek-ai/dsh-host-plugin-inventory/types'

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

/** Fields every transport shares. */
export interface McpSpecBase {
  /** Local namespace of the server's tool names; `[A-Za-z0-9_-]{1,32}`. */
  serverName: string
  /** Timeout per tool call or resource request in milliseconds; omitted keeps the plugin default. */
  toolCallTimeoutMs?: number
  /** Fail plugin activation when the first connection fails; omitted keeps the plugin default. */
  failOnStartupError?: boolean
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
  /** The row's URL embeds a user name or password. */
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
  /** Root-fiber phase of the running entry; null when none is live. */
  fiberPhase: PluginFiberPhase
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
