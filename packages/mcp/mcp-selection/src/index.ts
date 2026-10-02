/**
 * Per-Session selection of MCP servers. A Session's model requests carry the
 * tools, instructions, and resource access of the servers that are active for
 * it: the Session's own logged selection, or each server's configured default
 * while it has logged none. The selection is enforced through the tool
 * registry's per-agent restriction, so an inactive server's tools are absent
 * from schemas and refused at execution alike.
 *
 * @module @deepseek-ai/dsh-mcp-selection
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-mcp-status'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tools'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { McpServersProjection } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The MCP servers this Session uses from this point on: log-only,
     * non-surface, whole-value replace. The last `mcp/servers` wins; a log
     * with none follows each server's configured default.
     */
    'mcp/servers': { active: string[] }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Which configured MCP servers each Session uses. */
    mcpSelection: McpSelection
  }
}

const projectionSchema: ZodType<McpServersProjection> = zod.object({
  active: zod.array(zod.string()).nullable(),
})

/** Projection of the logged selection; the last `mcp/servers` event wins. */
export const mcpServersProjectionDefinition = {
  key: 'mcpServers',
  stateVersion: 1,
  stateSchema: projectionSchema,
  init: () => ({ active: null }),
  apply: (state, event) => event.type === 'mcp/servers' ? { active: event.data.active } : state,
  wire: {
    viewSchema: projectionSchema,
    view: state => state,
  },
} satisfies ProjectionDefinition<'mcpServers', McpServersProjection>

/** The restriction one agent carries: its private scope and the names it denies now. */
interface AgentMask {
  scope?: Scope
  denied: ReadonlySet<string>
  lift?: (() => void) | undefined
}

/** Decides and enforces which configured MCP servers each Session uses. */
export class McpSelection extends Service {
  static inject = ['sessionProjections', 'tools', 'mcpStatus']

  private readonly masks = new Map<Agent, AgentMask>()
  /** Tool names that serve MCP servers in general; hidden from a Session with no active server. */
  private readonly sharedTools = new Set<string>()
  /** Set while this service changes restrictions, whose `tools/change` it must not answer. */
  private refreshing = false

  /** @param ctx - the context that owns the selection state and its registrations. */
  constructor(ctx: Context) {
    super(ctx, 'mcpSelection')
    ctx.sessionProjections.register(mcpServersProjectionDefinition)
    ctx.on('agent/created', ({ agent }) => {
      this.masks.set(agent, { denied: new Set() })
      agent.ctx.effect(() => async () => {
        const mask = this.masks.get(agent)
        this.masks.delete(agent)
        await mask?.scope?.dispose()
      }, 'mcpSelection.mask')
      this.refresh()
      return undefined
    }, { prepend: true })
    // A server's tools arrive and leave with its connection, and a restriction names tools one by one.
    ctx.on('tools/change', () => { this.refresh() })
    ctx.on('mcp-status/changed', () => { this.refresh() })
  }

  /**
   * Read the selection a Session logged for itself.
   * @param session - the Session to read.
   * @returns the logged server names, or undefined while the Session follows the configured defaults.
   */
  logged(session: Session): readonly string[] | undefined {
    return this.ctx.sessionProjections.stateOf(session, 'mcpServers')?.active ?? undefined
  }

  /**
   * Resolve the servers a Session uses now: its logged selection restricted to
   * the servers still configured, or the servers configured as active by default.
   * @param session - the Session to resolve for.
   * @returns the active server names, in the order the servers are configured.
   */
  active(session: Session): string[] {
    const logged = this.logged(session)
    return this.ctx.mcpStatus.servers()
      .filter(server => logged === undefined ? server.defaultActive : logged.includes(server.serverName))
      .map(server => server.serverName)
  }

  /**
   * Whether one server reaches an agent's model requests.
   * @param server - configured server name.
   * @param agent - the agent whose Session decides; a caller with no agent is not restricted.
   * @returns false only when the agent's Session does not use the server.
   */
  isActive(server: string, agent: Agent | undefined): boolean {
    return agent === undefined || this.active(agent.session).includes(server)
  }

  /**
   * Replace a Session's selection, log it, and apply it to the agent's tools at once.
   * A request that names the servers already in use logs nothing.
   * @param agent - the agent whose Session selects.
   * @param servers - every server the Session uses from now on; duplicates are dropped.
   * @returns the servers in use afterwards, in configured order.
   * @throws when a name is not a configured server.
   */
  select(agent: Agent, servers: readonly string[]): string[] {
    const configured = this.ctx.mcpStatus.servers().map(server => server.serverName)
    const unknown = servers.find(name => !configured.includes(name))
    if (unknown !== undefined) throw new Error(`MCP server "${unknown}" is not configured`)
    const next = configured.filter(name => servers.includes(name))
    const current = this.active(agent.session)
    if (next.length === current.length && next.every((name, index) => name === current[index])) return current
    agent.session.append('mcp/servers', { active: next })
    this.refresh()
    return next
  }

  /**
   * Hide tools that serve MCP servers in general from every Session that uses no server.
   * @param names - registered tool names, such as the shared resource tools.
   * @returns the disposer that stops hiding them.
   */
  hideWhenNone(names: readonly string[]): () => void {
    // oxlint-disable-next-line typescript/no-misused-promises -- the disposer below is synchronous
    return this.ctx.effect(() => {
      for (const name of names) this.sharedTools.add(name)
      this.refresh()
      return () => {
        for (const name of names) this.sharedTools.delete(name)
        this.refresh()
      }
    }, 'mcpSelection.hideWhenNone')
  }

  /** The tool names an agent's Session must not see: every tool of an inactive server, and the shared tools when none is active. */
  private unwanted(agent: Agent): Set<string> {
    const active = this.active(agent.session)
    const names = new Set<string>()
    for (const { serverName } of this.ctx.mcpStatus.servers()) {
      if (active.includes(serverName)) continue
      for (const tool of this.ctx.mcpStatus.tools(serverName)) names.add(tool.publicName)
    }
    if (active.length === 0) for (const name of this.sharedTools) names.add(name)
    return names
  }

  /**
   * Bring every agent's restriction in line with its Session's selection. A
   * restriction is replaced only when it would deny a different set, so a
   * registry change that concerns no inactive server changes nothing.
   */
  private refresh(): void {
    if (this.refreshing) return
    this.refreshing = true
    try {
      for (const [agent, mask] of this.masks) {
        const unwanted = this.unwanted(agent)
        const visible = this.ctx.tools.schemas(agent).map(tool => tool.name)
        const settled = !visible.some(name => unwanted.has(name)) && [...mask.denied].every(name => unwanted.has(name))
        if (settled) continue
        mask.lift?.()
        mask.lift = undefined
        // With the old restriction lifted, the view lists every tool the agent inherits.
        const deny = this.ctx.tools.schemas(agent).map(tool => tool.name).filter(name => unwanted.has(name))
        mask.denied = new Set(deny)
        if (deny.length === 0) continue
        mask.scope ??= createScope(this.ctx, agent)
        mask.lift = mask.scope.ctx.tools.restrict({ deny })
      }
    } finally {
      this.refreshing = false
    }
  }
}

export default McpSelection
