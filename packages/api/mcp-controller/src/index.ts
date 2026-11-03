/**
 * The `mcpServers` Remote: the MCP reads and writes a browser needs beyond the
 * MCP manager and Settings. It reports each server's registered tools and usage
 * counters, sets the servers a Session uses, and lets one tool run without
 * asking. Server entries, tool-call policies, and default selection are edited
 * through the Settings Remote; connection status, restart, and probe are the
 * `mcpManager` Remote's.
 *
 * @module @deepseek-ai/dsh-api-mcp-controller
 */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-mcp-status'
import type {} from '@deepseek-ai/dsh-mcp-selection'
import McpPolicyStore from '@deepseek-ai/dsh-mcp-policy'
import type { McpToolPolicy } from '@deepseek-ai/dsh-mcp-policy/types'
import type {} from '@deepseek-ai/dsh-config-editor'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { McpAllowToolResult, McpOverview, McpSessionServers, McpToolsResult } from './types.ts'

export type * from './types.ts'

/** Module of the store that holds the person's tool-call policies. */
const POLICY_STORE_MODULE = '@deepseek-ai/dsh-mcp-policy'

/** The policy of a server the store names none for: every call asks first. */
const ASK_EVERY_CALL: McpToolPolicy = { default: 'ask', tools: {} }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** MCP tool, usage, and per-Session selection operations for browser clients. */
    mcpServersController: McpServersController
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Remote owner of the MCP reads and writes the manager and Settings do not cover. */
export class McpServersController extends TypertRemoteService {
  /** @param ctx - the context that owns the Remote. */
  constructor(ctx: Context) {
    super(ctx, 'mcpServersController', { namespace: 'mcpServers' })
  }

  /**
   * Read the tools one server offers.
   * @param serverName - the server's configured name.
   * @returns the tools registered from it right now; empty when it is not connected or has no client.
   */
  @Remote
  tools(serverName: string): McpToolsResult {
    return { tools: this.ctx.get('mcpStatus')?.tools(serverName) ?? [] }
  }

  /**
   * Read every running client's usage counters in one call.
   * @param sessionId - Session whose own share of the counters to include; omitted reads the totals only.
   * @returns one entry per running client, with the Host clock the figures were read at.
   */
  @Remote
  overview(sessionId?: string): McpOverview {
    const statuses = this.ctx.get('mcpStatus')
    const selection = this.ctx.get('mcpSelection')
    return {
      readAt: Date.now(),
      servers: (statuses?.servers() ?? []).flatMap(({ serverName, defaultActive }) => {
        const stats = statuses?.stats(serverName)
        if (stats === undefined) return []
        const sessionStats = sessionId === undefined ? undefined : statuses?.stats(serverName, sessionId)
        return [{
          serverName,
          defaultActive: selection?.defaultOf(serverName, defaultActive) ?? defaultActive,
          stats,
          ...sessionStats === undefined ? {} : { sessionStats },
        }]
      }),
    }
  }

  /**
   * Replace the servers one Session uses. The choice is logged on the Session and
   * takes effect on its next model request.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @param active - every server name the Session uses from now on; an empty list uses none.
   * @returns the servers in use afterwards.
   * @throws when a name is not a configured server, or the profile mounts no selection service.
   */
  @Remote
  setSessionServers(agent: Agent, active: string[]): McpSessionServers {
    const selection = this.ctx.get('mcpSelection')
    if (selection === undefined) throw new Error('This profile does not support choosing MCP servers per session')
    return { active: selection.select(agent, active) }
  }

  /**
   * Let one MCP tool run without asking from now on, by its model-facing name. The
   * change goes to the policy store, so the server keeps its connection.
   * @param publicName - the tool's model-facing name, as an approval request names it.
   * @returns the server and tool now allowed, or why nothing changed.
   */
  @Remote
  async allowTool(publicName: string): Promise<McpAllowToolResult> {
    const statuses = this.ctx.get('mcpStatus')
    const owner = statuses?.servers().flatMap(({ serverName }) => statuses.tools(serverName)
      .filter(tool => tool.publicName === publicName)
      .map(tool => ({ serverName, tool: tool.name })))[0]
    if (owner === undefined) return { ok: false, code: 'unknown-tool', message: `No MCP server offers the tool "${publicName}"` }
    const editor = this.ctx.get('configEditor')
    // A profile names the store by module; a composition that registers the class directly is matched by its plugin.
    const entry = this.ctx.get('mcpPolicy') === undefined ? undefined : editor?.entries().find(candidate =>
      candidate.options.name === POLICY_STORE_MODULE || candidate.fiber?.runtime?.callback === McpPolicyStore)
    if (editor === undefined || entry === undefined) {
      return { ok: false, code: 'no-policy-store', message: 'This profile does not mount the MCP policy store' }
    }
    const current = this.ctx.get('mcpPolicy')?.policyOf(owner.serverName) ?? ASK_EVERY_CALL
    const next: McpToolPolicy = { default: current.default, tools: { ...current.tools, [owner.tool]: 'allow' } }
    try {
      await editor.edit(entry, current => ({
        ...current,
        servers: { ...(current.servers ?? {}) as Record<string, unknown>, [owner.serverName]: next },
      }))
    } catch (error) {
      return { ok: false, code: 'write-failed', message: messageOf(error) }
    }
    return { ok: true, ...owner }
  }
}

export default McpServersController
