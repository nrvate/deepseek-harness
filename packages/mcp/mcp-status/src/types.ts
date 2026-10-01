/** Records an MCP client publishes about its server and consumers read. */

/** Where a server's connection stands. */
export type McpConnectionState =
  /** The first attempt, started when the plugin loaded or the person asked to reconnect, is in flight. */
  | 'connecting'
  /** The server answered and its tools are registered. */
  | 'connected'
  /** The connection was lost or an attempt failed; the next attempt is waiting or in flight. */
  | 'reconnecting'
  /** No attempt is pending: the retry budget is spent, reconnecting is off, or a failed generation could not be closed. */
  | 'failed'

/** One server's connection state. */
export interface McpServerStatus {
  /** The configured `serverName`. */
  serverName: string
  state: McpConnectionState
  /** Consecutive failed attempts in the current outage; 0 while connected. */
  attempt: number
  /** Failed attempts allowed before the client stops, as configured. */
  maxAttempts: number
  /** The last failure's message, kept until the next successful connection. */
  error?: string
  /** Epoch milliseconds of the last successful connection. */
  connectedAt?: number
  /** Tools registered from this server right now. */
  toolCount: number
}

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

/** What a client hands the registry for one server; every read reflects the live connection. */
export interface McpServerHandle {
  /** @returns the current connection state. */
  status(): McpServerStatus
  /** @returns the tools registered from the server right now. */
  tools(): readonly McpToolInfo[]
  /**
   * Connect now instead of waiting for the next scheduled attempt, and restart the retry budget.
   * @returns false when a connection is already live or being made, so nothing changed.
   */
  reconnect(): Promise<boolean>
  /**
   * Observe state and tool changes.
   * @param listener - called after each change has been applied.
   * @returns the disposer that stops the observation.
   */
  subscribe(listener: () => void): () => void
}
