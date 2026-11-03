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
