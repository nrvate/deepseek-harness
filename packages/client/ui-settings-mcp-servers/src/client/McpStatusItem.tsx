/**
 * The MCP status item below the prompt box: a compact count of connected
 * servers that opens a panel of each server's state and usage counters.
 * Renders nothing while the preference is off or no server is configured.
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Button, StateDot, Tooltip, useAnchoredPosition, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpServerOverview } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the composer's SlotMap merge (the 'conversation.composer.dock' entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
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
  const { t, load, setOpen } = props
  const state = props.useMcpTray(snapshot => snapshot)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const shown = state.visible && state.servers.length > 0
  const open = state.open && shown
  const position = useAnchoredPosition({ open, anchorRef: rootRef, panelRef, side: 'top', gap: 8, margin: 12 })
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)
  useEffect(() => { load() }, [load])
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
          ref={panelRef}
          className={css.panel}
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          aria-label={t('trayTitle')}
        >
          <Panel {...props} servers={state.servers} readAt={state.readAt} summary={summary} />
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

function Panel(props: McpStatusItemProps & {
  servers: readonly McpServerOverview[]
  readAt: number
  summary: { connected: number; total: number }
}): ReactNode {
  const { t, servers, summary, openManager } = props
  const total = { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, schemaTokens: 0 }
  for (const { stats } of servers) {
    if (stats === undefined) continue
    total.calls += stats.calls
    total.errors += stats.errors
    total.inputTokens += stats.inputTokens
    total.outputTokens += stats.outputTokens
    total.schemaTokens += stats.schemaTokens
  }
  return (
    <>
      <div className={css.header}>
        <span className={css.title}>{t('trayTitle')}</span>
        <span className={css.count}>{t('trayConnected', summary)}</span>
      </div>
      <dl className={css.figures}>
        <Figure label={t('statCalls')} value={formatCount(total.calls, t)} />
        <Figure label={t('statErrors')} value={formatCount(total.errors, t)} />
        <Figure label={t('statTokensIn')} value={t('statApprox', { value: formatCount(total.inputTokens, t) })} />
        <Figure label={t('statTokensOut')} value={t('statApprox', { value: formatCount(total.outputTokens, t) })} />
      </dl>
      <p className={css.definitions}>
        {t('statDefinitions')}
        {': '}
        {t('statPerRequest', { value: formatCount(total.schemaTokens, t) })}
      </p>
      <ul className={css.servers}>
        {servers.map(server => <Server key={server.id} {...props} server={server} />)}
      </ul>
      <p className={css.note}>{t('trayNote')}</p>
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

function Server(props: McpStatusItemProps & { server: McpServerOverview; readAt: number }): ReactNode {
  const { t, server, readAt } = props
  const { status, stats } = server
  const view = viewOf(server, t)
  const name = server.serverName === '' ? server.id : server.serverName
  return (
    <li className={css.server}>
      <div className={css.serverHead}>
        <StateDot state={view.dot} />
        <span className={css.serverName}>{name}</span>
        <span className={css.serverState}>{view.text}</span>
      </div>
      {server.enabled && status?.error !== undefined && status.state !== 'connected' && (
        <p className={css.problem}>{status.error}</p>
      )}
      {stats !== undefined && (
        <>
          <dl className={css.figures}>
            <Figure label={t('statCalls')} value={formatCount(stats.calls, t)} />
            <Figure label={t('statErrors')} value={formatCount(stats.errors, t)} />
            <Figure label={t('statTokensIn')} value={t('statApprox', { value: formatCount(stats.inputTokens, t) })} />
            <Figure label={t('statTokensOut')} value={t('statApprox', { value: formatCount(stats.outputTokens, t) })} />
          </dl>
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
