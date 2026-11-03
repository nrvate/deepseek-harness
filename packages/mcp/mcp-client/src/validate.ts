/**
 * Load-time rejection of server settings no reconnect attempt can repair.
 *
 * @module
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { Config } from './index.ts'

/**
 * Reject server settings that no reconnect attempt can repair. Programmatic
 * construction may bypass Schemastery normalization, so the bounds are
 * re-judged here and a failure rejects the plugin instance at load instead of
 * spending the reconnect budget. Template-bearing URLs are judged only after
 * expansion, by the connection.
 *
 * @param config - Resolved plugin config.
 * @param path - Diagnostic prefix naming the server in thrown messages.
 */
export function validateServerConfig(config: Config, path: string): void {
  if (!Number.isFinite(config.toolCallTimeoutMs) || config.toolCallTimeoutMs <= 0 || config.toolCallTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.toolCallTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (config.maxInstructionBytes !== undefined && (!Number.isInteger(config.maxInstructionBytes) || config.maxInstructionBytes < 1)) {
    throw new Error(`${path}.maxInstructionBytes must be a positive integer`)
  }
  switch (config.transport) {
    case 'stdio':
      if (config.command.trim() === '') throw new Error(`${path}.command must not be empty`)
      break
    case 'streamable-http': {
      if (config.expandTemplates && config.url.includes('${')) break
      let url: URL
      try {
        url = new URL(config.url)
      } catch (_error) {
        // The text is not echoed: a malformed URL can still hold a token.
        throw new Error(`${path}.url is not a valid URL`)
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${path}.url must use http: or https:, got ${url.protocol}`)
      }
      break
    }
    /* v8 ignore next 2 -- transport is the closed Config discriminant */
    default:
      assertNever(config)
  }
}
