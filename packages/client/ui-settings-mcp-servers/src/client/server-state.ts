/** The dot and label of one managed server's status, shared by the page rows, the status item, and the selector. */
import { useEffect, useState } from 'react'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpManagedServerStatus } from '@deepseek-ai/dsh-api-remotes/client'
import { formatSpan } from './format.ts'
import type { McpServersLocaleKey } from './locales.ts'

/** Reads this plugin's dictionary; the same seat the components receive as `t`. */
export type Translate = (key: McpServersLocaleKey, params?: Record<string, unknown>) => string

/**
 * Describe a managed server's status.
 * @param status - the status the MCP manager reports.
 * @param t - dictionary reader.
 * @param now - the current time, for the countdown to the next reconnect attempt.
 * @returns the dot tone and the localized label.
 */
export function connectionView(status: McpManagedServerStatus, t: Translate, now: number): { dot: StateDotState; text: string } {
  switch (status.state) {
    case 'connected': return { dot: 'done', text: t('stateConnected') }
    case 'connecting': return { dot: 'ongoing', text: t('stateConnecting') }
    case 'reconnecting': return {
      dot: 'warning',
      text: t('stateReconnecting', { attempt: status.attempt, max: status.maxAttempts, wait: formatSpan(status.nextRetryAtMs - now, t) }),
    }
    case 'waiting-credentials': return { dot: 'warning', text: t('stateWaitingCredentials') }
    case 'disabled': return { dot: 'idle', text: t('phaseOff') }
    case 'closed': return { dot: 'idle', text: t('stateClosed') }
    case 'failed':
      switch (status.reason) {
        case 'load': return { dot: 'error', text: t('phaseFailed') }
        case 'cleanup':
        case 'unclosed-generation': return { dot: 'error', text: t('stateCleanup') }
        case 'gave-up':
        case 'reconnect-disabled': return { dot: 'error', text: t('stateFailed') }
      }
  }
}

/**
 * The last failure a status carries, for display under the server.
 * @param status - the status the MCP manager reports.
 * @returns the diagnostic text, or undefined for a status without one.
 */
export function problemOf(status: McpManagedServerStatus): string | undefined {
  switch (status.state) {
    case 'reconnecting':
    case 'waiting-credentials': return status.lastError
    case 'failed': return status.reason === 'cleanup' ? status.result.cleanupError : status.lastError
    case 'closed': return status.result.cleanupError
    case 'connected':
    case 'connecting':
    case 'disabled': return undefined
  }
}

/**
 * Whether a restart can help: the server stopped trying, waits out a backoff, or waits for a credential.
 * @param status - the status the MCP manager reports.
 * @returns true when the restart action applies.
 */
export function restartable(status: McpManagedServerStatus): boolean {
  return status.state === 'reconnecting' || status.state === 'waiting-credentials'
    || (status.state === 'failed' && (status.reason === 'gave-up' || status.reason === 'reconnect-disabled' || status.reason === 'load'))
}

/**
 * The current time, re-read every second while `active`, so a countdown moves.
 * @param active - whether anything on screen counts down.
 * @returns epoch milliseconds.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [active])
  return now
}
