/** The tool-call modes as the server form and the tools dialog offer them. */
import type { McpToolMode, McpToolPolicy } from '@deepseek-ai/dsh-api-remotes/client'
import type { McpServersLocaleKey } from './locales.ts'

/** Every mode, safest-sounding first, in the order the selects list them. */
export const TOOL_MODES: readonly McpToolMode[] = ['ask', 'allow', 'deny']

/** The label of each mode. */
export const TOOL_MODE_LABEL: Record<McpToolMode, McpServersLocaleKey> = {
  ask: 'modeAsk',
  allow: 'modeAllow',
  deny: 'modeDeny',
}

/** The policy of a server that names none: every call asks first. */
export const ASK_EVERY_CALL: McpToolPolicy = { default: 'ask', tools: {} }

/**
 * Whether a policy is the plugin default, which the profile patch leaves unwritten.
 * @param policy - the policy to test.
 * @returns true when every call asks first and no tool has its own mode.
 */
export function asksEveryCall(policy: McpToolPolicy): boolean {
  return policy.default === 'ask' && Object.keys(policy.tools).length === 0
}
