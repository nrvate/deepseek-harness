/**
 * The MCP status item below the prompt box: a compact count of connected
 * servers that opens a panel of each server's state and usage counters, for
 * this Session and in total, with a switch per server that decides whether the
 * Session uses it. Renders nothing while the preference is off or no server is
 * configured.
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Button, StateDot, Switch, Tooltip, useAnchoredPosition, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpServerOverview, McpServerStats } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the composer's SlotMap merge (the 'conversation.composer.dock' entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the `mcpServers` projection key.
import type {} from '@deepseek-ai/dsh-mcp-selection/client'
import { useSessionServers, type SessionServers } from './session-servers.ts'
import { formatCount, formatLatency, formatSpan } from './format.ts'
import type { McpTrayFace } from './mcp-tray-controller.ts'
import { connectionView, type Translate } from './server-state.ts'
import css from './McpStatusItem.module.css'

/** Props the renderer binds for the status item. */
export type McpStatusItemProps =
  PropsRuntime<'conversation.composer.dock'>
  & PropsLocale<'settings.mcpServers'>
  & InjectFace<McpTrayFace>

/** How many tools the per-server breakdown lists. */
const TOP_TOOLS = 5

/** The count the trigger shows and the tone of its dot. */
function summarize(servers: readonly McpServerOverview[]): { connected: number; total: number; dot: StateDotState } {
  const enabled = servers.filter(server => server.enabled)
  const connected = enabled.filter(server => server.status?.state === 'connected').length
  if (enabled.length === 0) return { connected, total: 0, dot: 'idle' }
  if (enabled.some(server => server.status?.state === 'failed')) return { connected, total: enabled.length, dot: 'error' }
  return { connected, total: enabled.length, dot: connected === enabled.length ? 'done' : 'warning' }
}

/**
 * Render the status item and, while open, its panel.
 * @param props - locale copy, the item snapshot, and its actions.
 * @returns the item, or null while it is hidden or no server is configured.
 */
export function McpStatusItem(props: McpStatusItemProps): ReactNode {
  const { t, load, setOpen, sessionId, selectServers } = props
  const state = props.useMcpTray(snapshot => snapshot)
  const logged = props.useProjection('mcpServers')
  const selection = useSessionServers(state.servers, logged?.active ?? null, names => selectServers(sessionId, names))
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const shown = state.visible && state.servers.length > 0
  const open = state.open && shown
  const position = useAnchoredPosition({ open, anchorRef: rootRef, panelRef, side: 'top', gap: 8, margin: 12 })
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)
  useEffect(() => { load(sessionId) }, [load, sessionId])
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, setOpen])

  if (!shown) return null
  const summary = summarize(state.servers)
  const label = t('trayLabel', { connected: summary.connected, total: summary.total })
  return (
    <span ref={rootRef} className={css.root}>
      <Tooltip label={label} side="top" delayMs={200} disabled={open}>
        <button
          type="button"
          className={css.trigger}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          <StateDot state={summary.dot} />
          <span>{t('trayShort', { connected: summary.connected, total: summary.total })}</span>
        </button>
      </Tooltip>
      {open && createPortal(
        <div
          role="dialog"
          aria-label={t('trayTitle')}
          ref={panelRef}
          className={css.panel}
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
        >
          <Panel
            {...props}
            servers={state.servers}
            readAt={state.readAt}
            summary={summary}
            problem={state.problem}
            perSession={state.statsSession === sessionId}
            choice={logged === undefined ? undefined : selection}
          />
        </div>,
        document.body,
      )}
    </span>
  )
}

function Figure(props: { label: string; value: string }): ReactNode {
  return (
    <div className={css.figure}>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  )
}

/** The counters the panel adds up across servers. */
type Totals = Pick<McpServerStats, 'calls' | 'errors' | 'inputTokens' | 'outputTokens'>

function sum(all: readonly (Totals | undefined)[]): Totals {
  const total = { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0 }
  for (const stats of all) {
    if (stats === undefined) continue
    total.calls += stats.calls
    total.errors += stats.errors
    total.inputTokens += stats.inputTokens
    total.outputTokens += stats.outputTokens
  }
  return total
}

/** The four headline counters; with `session`, each reads "this Session / all Sessions". */
function Counters(props: { t: Translate; total: Totals; session?: Totals | undefined }): ReactNode {
  const { t, total, session } = props
  const approx = (value: number): string => t('statApprox', { value: formatCount(value, t) })
  const pair = (read: (totals: Totals) => string): string =>
    session === undefined ? read(total) : t('statSplit', { session: read(session), total: read(total) })
  return (
    <dl className={css.figures}>
      <Figure label={t('statCalls')} value={pair(totals => formatCount(totals.calls, t))} />
      <Figure label={t('statErrors')} value={pair(totals => formatCount(totals.errors, t))} />
      <Figure label={t('statTokensIn')} value={pair(totals => approx(totals.inputTokens))} />
      <Figure label={t('statTokensOut')} value={pair(totals => approx(totals.outputTokens))} />
    </dl>
  )
}

/** What the panel adds to the item's props. */
interface PanelProps {
  servers: readonly McpServerOverview[]
  readAt: number
  summary: { connected: number; total: number }
  problem: string | undefined
  /** Whether the figures on hand include this Session's own share. */
  perSession: boolean
  /** The Session's server selection; undefined while the Host offers none. */
  choice: SessionServers | undefined
}

function Panel(props: McpStatusItemProps & PanelProps): ReactNode {
  const { t, servers, summary, openManager, perSession, choice, problem } = props
  // A Session that selects its servers carries only the definitions of the ones it uses.
  const carried = servers.filter(server => choice === undefined || choice.active.includes(server.serverName))
  const schemaTokens = carried.reduce((tokens, server) => tokens + (server.stats?.schemaTokens ?? 0), 0)
  return (
    <>
      <div className={css.header}>
        <span className={css.title}>{t('trayTitle')}</span>
        <span className={css.count}>{t('trayConnected', summary)}</span>
      </div>
      {perSession && (
        <>
          <p className={css.caption}>{t('trayThisSession')}</p>
          <Counters t={t} total={sum(servers.map(server => server.sessionStats))} />
          <p className={css.caption}>{t('trayAllSessions')}</p>
        </>
      )}
      <Counters t={t} total={sum(servers.map(server => server.stats))} />
      <p className={css.definitions}>
        {t('statDefinitions')}
        {': '}
        {t('statPerRequest', { value: formatCount(schemaTokens, t) })}
      </p>
      {problem !== undefined && <p className={css.problem} role="alert">{t('selectFailed', { detail: problem })}</p>}
      <ul className={css.servers}>
        {servers.map(server => <Server key={server.id} {...props} server={server} />)}
      </ul>
      <p className={css.note}>{perSession ? `${t('traySplitNote')} ${t('trayNote')}` : t('trayNote')}</p>
      <div className={css.footer}>
        <Button variant="outline" size="sm" onClick={openManager}>{t('trayManage')}</Button>
      </div>
    </>
  )
}

/** The dot and label of one server in the panel. */
function viewOf(server: McpServerOverview, t: Translate): { dot: StateDotState; text: string } {
  if (!server.enabled) return { dot: 'idle', text: t('phaseOff') }
  if (server.status === undefined) return { dot: 'ongoing', text: t('phaseLoading') }
  return connectionView(server.status, t)
}

function Server(props: McpStatusItemProps & PanelProps & { server: McpServerOverview }): ReactNode {
  const { t, server, readAt, perSession, choice } = props
  const { status, stats } = server
  const view = viewOf(server, t)
  const name = server.serverName === '' ? server.id : server.serverName
  const selectable = choice?.options.includes(server) === true
  const used = choice?.active.includes(server.serverName) === true
  return (
    <li className={css.server}>
      <div className={css.serverHead}>
        <StateDot state={view.dot} />
        <span className={selectable && !used ? css.serverNameUnused : css.serverName}>{name}</span>
        <span className={css.serverState}>{view.text}</span>
        {selectable && (
          <Switch
            label={t('trayUseServer', { name })}
            title={t('trayUseServer', { name })}
            checked={used}
            onChange={() => { choice.toggle(server.serverName) }}
          />
        )}
      </div>
      {server.enabled && status?.error !== undefined && status.state !== 'connected' && (
        <p className={css.problem}>{status.error}</p>
      )}
      {stats !== undefined && (
        <>
          <Counters t={t} total={stats} session={perSession ? server.sessionStats : undefined} />
          <details className={css.details}>
            <summary className={css.detailsSummary}>{t('trayDetails')}</summary>
            <dl className={css.facts}>
              {stats.serverInfo !== undefined && (
                <Figure label={t('statServer')} value={`${stats.serverInfo.name} ${stats.serverInfo.version}`} />
              )}
              {stats.protocolVersion !== undefined && <Figure label={t('statProtocol')} value={stats.protocolVersion} />}
              <Figure label={t('transport')} value={t(stats.transport === 'stdio' ? 'transportStdio' : 'transportHttp')} />
              {status?.connectedAt !== undefined && (
                <Figure label={t('statUptime')} value={formatSpan(readAt - status.connectedAt, t)} />
              )}
              <Figure label={t('statConnections')} value={String(stats.connections)} />
              <Figure label={t('statTools')} value={String(status?.toolCount ?? 0)} />
              <Figure label={t('statDefinitions')} value={t('statPerRequest', { value: formatCount(stats.schemaTokens, t) })} />
              {stats.calls > 0 && <Figure label={t('statAverage')} value={formatLatency(stats.totalMs / stats.calls, t)} />}
              {stats.calls > 0 && <Figure label={t('statSlowest')} value={formatLatency(stats.maxMs, t)} />}
              <Figure
                label={t('statLastCall')}
                value={stats.lastCallAt === undefined
                  ? t('statNever')
                  : t('statAgo', { value: formatSpan(readAt - stats.lastCallAt, t) })}
              />
            </dl>
            {stats.tools.length > 0 && (
              <>
                <p className={css.subhead}>{t('statTopTools')}</p>
                <ul className={css.toolUsage}>
                  {stats.tools.slice(0, TOP_TOOLS).map(tool => (
                    <li key={tool.name}>
                      <code>{tool.name}</code>
                      <span>
                        {t('statToolLine', {
                          calls: formatCount(tool.calls, t),
                          errors: formatCount(tool.errors, t),
                          average: formatLatency(tool.totalMs / tool.calls, t),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </details>
        </>
      )}
    </li>
  )
}
