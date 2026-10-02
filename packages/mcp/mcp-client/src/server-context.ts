/**
 * Publish connection-owned MCP resources and literal server instructions.
 *
 * @module @deepseek-ai/dsh-mcp-client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { McpResourceProvider } from '@deepseek-ai/dsh-mcp-resources'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-mcp-selection'
import type { McpServerHandle } from '@deepseek-ai/dsh-mcp-status'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Connection-owned values used by the resource and prompt consumers. */
export interface ServerContext {
  /** Resource access through the current connection generation. */
  resources: McpResourceProvider
  /** Live connection state, tool list, and the reconnect action. */
  handle: McpServerHandle
  /**
   * Read the last successfully connected server's attributed instructions.
   * @returns literal prompt text, or an empty string when no server instructions are active.
   */
  instructions(): string
}

/**
 * Contribute server context to the services enabled by this composition.
 * @param ctx - server plugin's registration scope and effect owner.
 * @param server - configured server identity.
 * @param connection - live resource operations and successful instruction snapshot.
 */
export function registerServerContext(ctx: Context, server: string, connection: ServerContext): void {
  ctx.inject(['mcpResources'], (inner) => {
    inner.mcpResources.register(server, connection.resources)
  })
  ctx.inject(['mcpStatus'], (inner) => {
    inner.mcpStatus.register(server, connection.handle)
  })
  ctx.inject(['systemPrompt'], (inner) => {
    inner.systemPrompt.section({
      name: `mcp:${server}`,
      order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
      interpolate: false,
      // A Session that does not use this server gets none of its instructions.
      text: context => inner.get('mcpSelection')?.isActive(server, context.agent) === false ? '' : connection.instructions(),
    })
  })
}
