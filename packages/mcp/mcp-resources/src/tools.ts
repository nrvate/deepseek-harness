/**
 * Three shared tools adapt model arguments to scoped resource operations.
 *
 * @module @deepseek-ai/dsh-mcp-resources
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { McpResourceRequest } from './index.ts'
import { renderResourceResult } from './render.ts'

type RequestResource = (server: string, request: McpResourceRequest, exec: ToolExecution) => Promise<JsonValue>

/** Names of the three shared resource tools, in registration order. */
export const RESOURCE_TOOL_NAMES = ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'] as const

const listParameters = {
  server: { type: 'string', required: true, description: 'Configured MCP server name.' },
  cursor: { type: 'string', description: 'Continuation cursor returned by this server.' },
} as const

const output = {
  schema: { type: 'json' } as const,
  render: (args: { server: string }, value: JsonValue) => renderResourceResult(args.server, value),
}

/**
 * Register resource operations in the consumer's tool scope.
 * @param ctx - context owning the tool registrations.
 * @param request - caller-aware resource operation.
 * @returns the effect disposer that removes all three tools synchronously.
 */
export function registerResourceTools(ctx: Context, request: RequestResource): () => void {
  const dispose = ctx.effect(function* () {
    yield ctx.tools.register(defineTool({
      name: RESOURCE_TOOL_NAMES[0],
      description: 'List resources available from an MCP server.',
      parameters: listParameters,
      output,
      execute: (args, exec) => request(args.server, {
        method: 'resources/list', ...args.cursor === undefined ? {} : { cursor: args.cursor },
      }, exec),
    }))
    yield ctx.tools.register(defineTool({
      name: RESOURCE_TOOL_NAMES[1],
      description: 'List parameterized resource URI templates from an MCP server.',
      parameters: listParameters,
      output,
      execute: (args, exec) => request(args.server, {
        method: 'resources/templates/list', ...args.cursor === undefined ? {} : { cursor: args.cursor },
      }, exec),
    }))
    yield ctx.tools.register(defineTool({
      name: RESOURCE_TOOL_NAMES[2],
      description: 'Read an MCP resource by URI from the named server. Use a listed URI or an expanded resource template.',
      parameters: {
        server: listParameters.server,
        uri: { type: 'string', required: true, description: 'Resource URI to read.' },
      },
      output,
      execute: (args, exec) => request(args.server, { method: 'resources/read', uri: args.uri }, exec),
    }))
  }, 'mcpResources.resourceTools')
  // oxlint-disable-next-line typescript/no-misused-promises -- all collected tool disposers are synchronous
  return dispose
}
