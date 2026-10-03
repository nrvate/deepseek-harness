/**
 * Tool-call policy for one MCP server: whether each of its tools runs, asks
 * the person first, or is refused. The decision is made in the tool
 * registry's `tools/pre-execute` waterfall, so native calls, PTC calls, and
 * subagent calls all pass through it.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import type { McpToolInfo } from '@deepseek-ai/dsh-mcp-status/types'
// Side-effect type import: declaration-merges the optional `ctx.sandboxPolicy`.
import type {} from '@deepseek-ai/dsh-sandbox-policy'

import type { McpToolMode, McpToolPolicy } from '@deepseek-ai/dsh-mcp-policy/types'

export type { McpToolMode, McpToolPolicy } from '@deepseek-ai/dsh-mcp-policy/types'

/** Every tool-call mode, in the order a form offers them. */
export const MCP_TOOL_MODES: readonly McpToolMode[] = ['ask', 'allow', 'deny']

/** Policy fields as configuration supplies them; omitted fields take the defaults. */
export type McpToolPolicyInput = Partial<McpToolPolicy>

/** The policy of a server whose configuration names none: every call asks first. */
export const DEFAULT_TOOL_POLICY: McpToolPolicy = { default: 'ask', tools: {} }

function isMode(value: unknown): value is McpToolMode {
  return value === 'allow' || value === 'ask' || value === 'deny'
}

/**
 * Resolve and validate a configured tool-call policy.
 * @param input - the configured policy, possibly partial or absent.
 * @param label - diagnostic prefix naming the server.
 * @returns the complete policy.
 * @throws when a mode is not `allow`, `ask`, or `deny`.
 */
export function resolveToolPolicy(input: McpToolPolicyInput | undefined, label: string): McpToolPolicy {
  const policy = { default: input?.default ?? DEFAULT_TOOL_POLICY.default, tools: { ...input?.tools } }
  if (!isMode(policy.default)) throw new Error(`${label}: toolPolicy.default must be "allow", "ask", or "deny"`)
  for (const [tool, mode] of Object.entries(policy.tools)) {
    if (!isMode(mode)) throw new Error(`${label}: toolPolicy.tools.${tool} must be "allow", "ask", or "deny"`)
  }
  return policy
}

/**
 * Gate every call to this server's tools by its policy. `deny` refuses the
 * call. `ask` routes it through the approval service unless the calling
 * Session runs with full access, which is the person's choice to run without
 * prompts. `allow` leaves the call to the rest of the waterfall, so hooks and
 * other policies still apply; a later listener's refusal is never relaxed.
 * @param ctx - the client's plugin context; the listener lives as long as it.
 * @param server - configured server name, used in the reasons the model and the person read.
 * @param policy - reads the policy in force at each call.
 * @param tools - the server's currently registered tools.
 */
export function registerToolPolicy(
  ctx: Context,
  server: string,
  policy: () => McpToolPolicy,
  tools: () => readonly McpToolInfo[],
): void {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const tool = tools().find(candidate => candidate.publicName === exec.name)
    if (tool === undefined) return next()
    const current = policy()
    const mode = current.tools[tool.name] ?? current.default
    if (mode === 'deny') {
      return {
        kind: 'deny',
        reason: `the user's policy for MCP server "${server}" does not allow the tool "${tool.name}"`,
        info: { name: 'McpToolPolicy', code: 'MCP_TOOL_DENIED' },
      }
    }
    const downstream = await next()
    if (mode === 'allow' || downstream.kind !== 'allow') return downstream
    const session = exec.agent?.session
    if (session !== undefined && ctx.get('sandboxPolicy')?.resolve({ session }).mode === 'danger-full-access') return downstream
    return {
      kind: 'ask',
      reason: `MCP server "${server}" tool "${tool.name}" requires approval by its tool policy`,
      displayReason: {
        en: `Allow the MCP server "${server}" to run its tool "${tool.name}"?`,
        zh: `允许 MCP 服务器“${server}”运行其工具“${tool.name}”吗？`,
      },
    }
  })
}
