/**
 * Approval gate for `web_fetch`. A fetched URL is data leaving the machine:
 * a prompt-injected model can put conversation content into a query string.
 * Unless the deployment allows every fetch, a fetch to a host outside the
 * allow-list asks the person first, in the tool registry's
 * `tools/pre-execute` waterfall so PTC and subagent calls pass through it too.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
// Side-effect type import: declaration-merges the optional `ctx.sandboxPolicy`.
import type {} from '@deepseek-ai/dsh-sandbox-policy'

/** Whether `web_fetch` asks before fetching a host outside the allow-list, or fetches every URL without asking. */
export type FetchApproval = 'ask' | 'allow'

/**
 * Whether a host is on the allow-list. An entry is an exact host name, or
 * `*.` followed by a domain, which matches every subdomain but not the domain itself.
 * @param host - the URL's host name, lower case.
 * @param allowed - the configured entries.
 * @returns true when an entry matches.
 */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    const pattern = entry.trim().toLowerCase()
    return pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern
  })
}

/**
 * Validate the configured allow-list entries.
 * @param allowed - the configured entries.
 * @throws when an entry is empty, holds a scheme, path, or port, or uses `*` other than as a leading `*.`.
 */
export function assertAllowedHosts(allowed: readonly string[]): void {
  for (const entry of allowed) {
    if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(entry.trim())) {
      throw new Error(`tool-web: fetchAllowedHosts entry "${entry}" must be a host name or "*." followed by a domain`)
    }
  }
}

/**
 * Gate every `web_fetch` call. A call that already fails validation, an allowed
 * host, and the `allow` setting run as before; a Session with full access runs
 * without asking, as the person chose; any other call asks with the exact URL.
 * A later listener's refusal is never relaxed.
 * @param ctx - the tool plugin's context; the listener lives as long as it.
 * @param approval - the configured setting.
 * @param allowed - hosts fetched without asking.
 */
export function registerFetchApproval(ctx: Context, approval: FetchApproval, allowed: readonly string[]): void {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== 'web_fetch' || approval === 'allow') return next()
    const url = String((exec.arguments as { url?: unknown } | null)?.url)
    let host: string | undefined
    try {
      host = new URL(url).hostname.toLowerCase()
    } catch (_error) {
      // An unparsable URL is refused by the fetch itself, so it needs no approval.
      host = undefined
    }
    const downstream = await next()
    if (host === undefined || hostAllowed(host, allowed) || downstream.kind !== 'allow') return downstream
    const session = exec.agent?.session
    if (session !== undefined && ctx.get('sandboxPolicy')?.resolve({ session }).mode === 'danger-full-access') return downstream
    return {
      kind: 'ask',
      reason: `web_fetch of ${url} requires approval: ${host} is not on the fetch allow-list`,
      displayReason: { en: `Allow fetching ${url}?`, zh: `允许获取 ${url} 吗？` },
    }
  })
}
