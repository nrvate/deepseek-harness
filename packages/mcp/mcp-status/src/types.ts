/**
 * Tool lists and usage counters an MCP client publishes about its server.
 * Connection state is the client's `McpConnectionStatus`, not part of these records.
 * Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-mcp-status/types
 */

/** One parameter of a tool's input schema. */
export interface McpToolParameter {
  name: string
  /** The schema `type` (several joined with `|`), or `any` when the schema gives none. */
  type: string
  required: boolean
  /** The schema `description`, empty when absent. */
  description: string
}

/** One tool a server offers. */
export interface McpToolInfo {
  /** The server's own name for the tool. */
  name: string
  /** The name the model sees. */
  publicName: string
  /** The server's description, empty when absent. */
  description: string
  parameters: readonly McpToolParameter[]
}

/** How often one tool was called since its client loaded. */
export interface McpToolUsage {
  /** The server's own name for the tool. */
  name: string
  calls: number
  errors: number
  /** Summed wall time of its finished calls in milliseconds. */
  totalMs: number
}

/**
 * Counters and facts about one server since its client loaded. Token figures are
 * estimates at four characters per token, the density the context meter uses.
 */
export interface McpServerStats {
  /** Tool calls sent to the server. */
  calls: number
  /** Calls that failed: a transport error, a timeout, a cancellation, or a result the server marked as an error. */
  errors: number
  /** Estimated tokens of the arguments sent to the server. */
  inputTokens: number
  /** Estimated tokens of the result text returned to the model; images and other binary blocks are not counted. */
  outputTokens: number
  /** Summed wall time of finished calls in milliseconds. */
  totalMs: number
  /** Longest finished call in milliseconds. */
  maxMs: number
  /** Epoch milliseconds when the last call started. */
  lastCallAt?: number
  /** Successful connections made, the first included. */
  connections: number
  /** Estimated tokens the server's tool definitions add to every model request. */
  schemaTokens: number
  /** The name and version the server reports about itself. */
  serverInfo?: { name: string; version: string }
  /** The MCP protocol revision the connection negotiated. */
  protocolVersion?: string
  transport: 'stdio' | 'streamable-http'
  /** Tools called at least once, most-called first. */
  tools: McpToolUsage[]
}

/** One configured server and whether new Sessions start with it active. */
export interface McpConfiguredServer {
  /** The configured `serverName`. */
  serverName: string
  /** Whether a Session that has made no selection of its own uses this server. */
  defaultActive: boolean
}

/** One finished tool call, as a client reports it for usage counters. */
export interface McpCallRecord {
  /** The server's own name for the tool. */
  tool: string
  /** Wall time from the request to its result or failure. */
  ms: number
  /** Whether the call threw or the server marked its result as an error. */
  failed: boolean
  /** Length of the JSON arguments sent. */
  inputChars: number
  /** Length of the text blocks returned; binary blocks are not counted. */
  outputChars: number
  /** The Session whose model made the call; absent for a call made outside any Session. */
  session?: string
}

/** What a client hands the registry for one server; every read reflects the live connection. */
export interface McpServerHandle {
  /** Whether a Session that has made no selection of its own uses this server, as configured. */
  readonly defaultActive: boolean
  /** @returns the tools registered from the server right now. */
  tools(): readonly McpToolInfo[]
  /**
   * Read usage counters and connection facts since the client loaded.
   * @param session - a Session id; when given, the counters cover only that Session's calls.
   * @returns the counters, with the connection facts either way.
   */
  stats(session?: string): McpServerStats
  /**
   * Observe tool-list changes.
   * @param listener - called after each change has been applied.
   * @returns the disposer that stops the observation.
   */
  subscribe(listener: () => void): () => void
}
