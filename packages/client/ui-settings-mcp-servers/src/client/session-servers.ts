/**
 * One Session's choice of MCP servers, as the composer selector and the status
 * panel both show it: the servers on offer, the ones in use, and a toggle that
 * shows its result at once and sends the new selection to the Host.
 */
import { useEffect, useRef, useState } from 'react'
import type { McpServerOverview } from '@deepseek-ai/dsh-api-remotes/client'

/** What a selection control renders and calls. */
export interface SessionServers {
  /** Servers a Session can use: the enabled rows that name a server. */
  readonly options: readonly McpServerOverview[]
  /** Names of the servers the Session uses, in the order of `options`. */
  readonly active: readonly string[]
  /** Switch one server on or off for the Session. */
  toggle: (serverName: string) => void
}

/**
 * Resolve the servers a Session uses from its logged selection.
 * @param options - the servers on offer.
 * @param logged - the Session's logged selection; null while it follows each server's default.
 * @returns the names in use, in the order of `options`.
 */
export function activeServers(options: readonly McpServerOverview[], logged: readonly string[] | null): string[] {
  return options
    .filter(server => logged === null ? server.defaultActive : logged.includes(server.serverName))
    .map(server => server.serverName)
}

/**
 * Track one Session's server selection for a control. A toggle is shown before
 * the Host confirms it. What the control assumed gives way to the Session's
 * next logged selection once no request is in flight, and to the logged
 * selection at once when the Host refuses the latest request.
 * @param servers - every configured server row.
 * @param logged - the Session's logged selection; null while it follows each server's default.
 * @param select - sends a complete selection; resolves to whether the Host applied it.
 * @returns the servers on offer, the ones in use, and the toggle.
 */
export function useSessionServers(
  servers: readonly McpServerOverview[],
  logged: readonly string[] | null,
  select: (servers: readonly string[]) => Promise<boolean>,
): SessionServers {
  const [assumed, setAssumed] = useState<readonly string[] | null>(null)
  const sent = useRef(0)
  const inFlight = useRef(0)
  const loggedKey = logged === null ? null : logged.join('\n')
  // While a request is in flight the log may still show the selection before it.
  useEffect(() => { if (inFlight.current === 0) setAssumed(null) }, [loggedKey])
  const options = servers.filter(server => server.enabled && server.serverName !== '')
  const active = assumed === null
    ? activeServers(options, logged)
    : options.map(server => server.serverName).filter(name => assumed.includes(name))
  return {
    options,
    active,
    toggle: (serverName) => {
      const next = active.includes(serverName) ? active.filter(name => name !== serverName) : [...active, serverName]
      const request = ++sent.current
      inFlight.current += 1
      setAssumed(next)
      void select(next).then((applied) => {
        inFlight.current -= 1
        // Only the latest request decides: an earlier refusal concerns a selection already replaced.
        if (!applied && request === sent.current) setAssumed(null)
      })
    },
  }
}
