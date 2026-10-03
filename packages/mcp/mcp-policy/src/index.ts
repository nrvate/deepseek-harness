/**
 * The tool-call policies a person sets for MCP servers, keyed by server name.
 * The `servers` field is volatile: a profile-patch change to it reaches the
 * running store without reloading anything, so allowing a tool never
 * reconnects its server. Each MCP client reads its server's entry at every
 * call and falls back to the `toolPolicy` in its own configuration when the
 * store has none.
 *
 * @module @deepseek-ai/dsh-mcp-policy
 */
import { Service, type Context, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { McpToolMode, McpToolPolicy } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The person's MCP tool-call policies. */
    mcpPolicy: McpPolicyStore
  }
}

/** Every tool-call mode, in the order a form offers them. */
export const MCP_TOOL_MODES: readonly McpToolMode[] = ['ask', 'allow', 'deny']

const ToolMode = z.union([...MCP_TOOL_MODES])

/** Plugin config. */
export interface Config {
  /** Policies by configured server name; changes apply to the next call without a reload. */
  servers: Volatile<Record<string, McpToolPolicy>>
}

/** Holds the person's policies and answers them per server. */
export class McpPolicyStore extends Service {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config = z.object({
    servers: z.dict(z.object({
      default: ToolMode.default('ask'),
      tools: z.dict(ToolMode).default({}),
    })).default({}).volatile(),
  })

  private readonly servers: Volatile<Record<string, McpToolPolicy>>

  /**
   * @param ctx - the context that owns the store.
   * @param config - the stored policies.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'mcpPolicy')
    this.servers = config.servers
  }

  /**
   * Read one server's stored policy.
   * @param server - configured server name.
   * @returns the policy the person set, or undefined while the store holds none for the server.
   */
  policyOf(server: string): McpToolPolicy | undefined {
    return Object.hasOwn(this.servers.get(), server) ? this.servers.get()[server] : undefined
  }
}

export default McpPolicyStore
