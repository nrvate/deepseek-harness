/** The dot and label of one connection state, shared by the page rows and the status item. */
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpServerStatus } from '@deepseek-ai/dsh-api-remotes/client'
import type { McpServersLocaleKey } from './locales.ts'

/** Reads this plugin's dictionary; the same seat the components receive as `t`. */
export type Translate = (key: McpServersLocaleKey, params?: Record<string, unknown>) => string

/**
 * Describe a connection state.
 * @param status - the client's published state.
 * @param t - dictionary reader.
 * @returns the dot tone and the localized label, with the attempt count while reconnecting.
 */
export function connectionView(status: McpServerStatus, t: Translate): { dot: StateDotState; text: string } {
  switch (status.state) {
    case 'connected': return { dot: 'done', text: t('stateConnected') }
    case 'connecting': return { dot: 'ongoing', text: t('stateConnecting') }
    case 'reconnecting': return { dot: 'warning', text: t('stateReconnecting', { attempt: status.attempt, max: status.maxAttempts }) }
    case 'failed': return { dot: 'error', text: t('stateFailed') }
  }
}
