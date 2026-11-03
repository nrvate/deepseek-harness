/**
 * Tool lists and usage counters of one MCP server, published to the optional
 * `mcpStatus` registry. Connection state is not recorded here: the instance's
 * {@link McpConnectionStatusHandle} owns it.
 *
 * @module
 */

import type {
  McpCallRecord, McpServerHandle, McpServerStats, McpToolInfo, McpToolParameter, McpToolUsage,
} from '@deepseek-ai/dsh-mcp-status/types'

/** What the recorder reads from a connected client when stats are requested. */
export interface McpConnectedPeer {
  getServerVersion(): { name: string; version: string } | undefined
  getNegotiatedProtocolVersion(): string | undefined
}

/** The fixed text density the context meter prices content at; usage counters report the same estimate. */
const CHARS_PER_TOKEN = 4

/** Running usage sums in characters and milliseconds, overall or for one Session. */
interface Usage {
  calls: number
  errors: number
  inputChars: number
  outputChars: number
  totalMs: number
  maxMs: number
  lastCallAt?: number
  /** Per-tool counts, keyed by the server's own tool name. */
  tools: Map<string, McpToolUsage>
}

function emptyUsage(): Usage {
  return { calls: 0, errors: 0, inputChars: 0, outputChars: 0, totalMs: 0, maxMs: 0, tools: new Map() }
}

function addCall(usage: Usage, call: McpCallRecord): void {
  usage.calls += 1
  usage.inputChars += call.inputChars
  usage.outputChars += call.outputChars
  usage.totalMs += call.ms
  usage.maxMs = Math.max(usage.maxMs, call.ms)
  usage.lastCallAt = Date.now() - call.ms
  const tool = usage.tools.get(call.tool) ?? { name: call.tool, calls: 0, errors: 0, totalMs: 0 }
  tool.calls += 1
  tool.totalMs += call.ms
  if (call.failed) {
    usage.errors += 1
    tool.errors += 1
  }
  usage.tools.set(call.tool, tool)
}

/** Records one server's registered tools and finished calls for the life of its plugin instance; a reconnect keeps the counters. */
export class McpUsageRecorder {
  private registered: McpToolInfo[] = []
  private schemaChars = 0
  private connections = 0
  private peer: McpConnectedPeer | undefined
  private readonly overall = emptyUsage()
  private readonly bySession = new Map<string, Usage>()
  private readonly observers = new Set<() => void>()

  /**
   * @param transport - the configured transport, reported with the stats.
   * @param defaultActive - whether a Session with no selection of its own uses this server.
   */
  constructor(private readonly transport: 'stdio' | 'streamable-http', defaultActive: boolean) {
    this.handle = this.createHandle(defaultActive)
  }

  /**
   * Replace the registered tool list; an empty list after a rollback or teardown.
   * @param tools - the tools now registered.
   * @param schemaChars - length of their definitions as the model receives them.
   */
  setTools(tools: McpToolInfo[], schemaChars: number): void {
    this.registered = tools
    this.schemaChars = schemaChars
    this.notify()
  }

  /**
   * Count one finished tool call; counters are read on demand, so no observer is told.
   * @param call - the finished call.
   */
  recordCall(call: McpCallRecord): void {
    addCall(this.overall, call)
    if (call.session === undefined) return
    const session = this.bySession.get(call.session) ?? emptyUsage()
    addCall(session, call)
    this.bySession.set(call.session, session)
  }

  /**
   * Note one successful connection; the server's identity and protocol revision are read from it on demand.
   * @param peer - the connected client.
   */
  connected(peer: McpConnectedPeer): void {
    this.connections += 1
    this.peer = peer
  }

  /** Stop telling observers about changes; the counters stay readable. */
  detach(): void {
    this.observers.clear()
  }

  /** The read side the registry holds. */
  readonly handle: McpServerHandle

  private createHandle(defaultActive: boolean): McpServerHandle {
    return {
      defaultActive,
      tools: () => this.registered,
      stats: (session?: string): McpServerStats => {
        const totals = session === undefined ? this.overall : this.bySession.get(session) ?? emptyUsage()
        const reported = this.peer?.getServerVersion()
        const protocolVersion = this.peer?.getNegotiatedProtocolVersion()
        return {
          calls: totals.calls,
          errors: totals.errors,
          inputTokens: Math.ceil(totals.inputChars / CHARS_PER_TOKEN),
          outputTokens: Math.ceil(totals.outputChars / CHARS_PER_TOKEN),
          totalMs: totals.totalMs,
          maxMs: totals.maxMs,
          ...totals.lastCallAt === undefined ? {} : { lastCallAt: totals.lastCallAt },
          connections: this.connections,
          schemaTokens: Math.ceil(this.schemaChars / CHARS_PER_TOKEN),
          ...reported === undefined ? {} : { serverInfo: { name: reported.name, version: reported.version } },
          ...protocolVersion === undefined ? {} : { protocolVersion },
          transport: this.transport,
          tools: [...totals.tools.values()]
            .map(tool => ({ ...tool }))
            .sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name)),
        }
      },
      subscribe: (listener) => {
        this.observers.add(listener)
        return () => { this.observers.delete(listener) }
      },
    }
  }

  private notify(): void {
    for (const observer of [...this.observers]) observer()
  }
}

/** `type` of one schema property, several joined with `|`, `any` when the schema gives none. */
function schemaType(property: Record<string, unknown>): string {
  const { type } = property
  if (typeof type === 'string') return type
  if (Array.isArray(type)) return type.filter((item): item is string => typeof item === 'string').join('|') || 'any'
  return 'any'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Describe one server tool for display: its description and the parameters of its input schema.
 * @param publicName - the name the model sees.
 * @param tool - the server's tool definition.
 * @returns the tool's name, description, and parameters.
 */
export function describeTool(
  publicName: string,
  tool: { name: string; description?: string | undefined; inputSchema: Record<string, unknown> },
): McpToolInfo {
  const properties = isPlainObject(tool.inputSchema.properties) ? tool.inputSchema.properties : {}
  const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : []
  const parameters = Object.entries(properties).map(([name, property]): McpToolParameter => {
    const schema = isPlainObject(property) ? property : {}
    return {
      name,
      type: schemaType(schema),
      required: required.includes(name),
      description: typeof schema.description === 'string' ? schema.description : '',
    }
  })
  return { name: tool.name, publicName, description: tool.description ?? '', parameters }
}

/**
 * Summed length of the text blocks of a raw call result.
 * @param result - the raw MCP `tools/call` result.
 * @returns the character count, 0 for a result with no text blocks.
 */
export function textChars(result: unknown): number {
  if (!isPlainObject(result) || !Array.isArray(result.content)) return 0
  let chars = 0
  for (const block of result.content) {
    if (isPlainObject(block) && block.type === 'text' && typeof block.text === 'string') chars += block.text.length
  }
  return chars
}
