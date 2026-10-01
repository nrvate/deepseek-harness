/**
 * The MCP servers page: the profile's servers with their state, an enable
 * switch, and edit and remove actions, plus the dialogs those actions open.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpServerInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { McpServerEditor, RemoveDialog } from './McpServerEditor.tsx'
import { McpToolsDialog } from './McpToolsDialog.tsx'
import type { McpServersFace } from './mcp-servers-controller.ts'
import type { McpServersLocaleKey } from './locales.ts'
import css from './McpServers.module.css'

/** Props the renderer binds for the MCP servers page. */
export type McpServersCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.mcpServers'>
  & InjectFace<McpServersFace>

const PHASE: Record<NonNullable<McpServerInfo['fiberPhase']> | 'off', { dot: StateDotState; key: McpServersLocaleKey }> = {
  active: { dot: 'done', key: 'phaseLoaded' },
  pending: { dot: 'ongoing', key: 'phaseLoading' },
  loading: { dot: 'ongoing', key: 'phaseLoading' },
  unloading: { dot: 'warning', key: 'phaseLoading' },
  failed: { dot: 'error', key: 'phaseFailed' },
  off: { dot: 'idle', key: 'phaseOff' },
}

const REASON: Record<NonNullable<McpServerInfo['readOnlyReason']>, McpServersLocaleKey> = {
  unaddressable: 'readOnlyOutside',
  'custom-expression': 'readOnlyExpression',
  'embedded-credentials': 'readOnlyCredentials',
}

/**
 * Render the one-liner or the page, as the Plugins page asks.
 * @param props - the view asked for, locale copy, the page snapshot, and its actions.
 * @returns the one-liner, or the page.
 */
export function McpServersCard(props: McpServersCardProps): ReactNode {
  if (props.view === 'summary') return props.t('description')
  return <McpServersPage {...props} />
}

function McpServersPage(props: McpServersCardProps): ReactNode {
  const { t, load, openAdd } = props
  const state = props.useMcpServers(snapshot => snapshot)
  useEffect(() => { load() }, [load])
  return (
    <div className={css.page}>
      <div className={css.head}>
        <p className={css.intro}>{t('intro')}</p>
        <Button variant="primary" size="sm" onClick={openAdd}>{t('add')}</Button>
      </div>
      <ServerList {...props} status={state.status} rows={state.rows} pending={state.pending} />
      <McpServerEditor {...props} editor={state.editor} />
      <RemoveDialog {...props} removal={state.removal} />
      <McpToolsDialog {...props} tools={state.tools} />
    </div>
  )
}

function ServerList(props: McpServersCardProps & {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  rows: readonly McpServerInfo[]
  pending: string | null
}): ReactNode {
  const { t, status, rows, load } = props
  if (status === 'idle' || status === 'loading') {
    return <div className={css.center} role="status"><StateDot state="ongoing" /></div>
  }
  if (status === 'failed') {
    return (
      <div className={css.failure} role="alert">
        <span>{t('loadFailed')}</span>
        <Button variant="outline" size="sm" onClick={load}>{t('retry')}</Button>
      </div>
    )
  }
  return (
    <>
      {rows.length === 0
        ? <p className={css.empty}>{t('empty')}</p>
        : <ul className={css.list}>{rows.map(row => <ServerRow key={row.id} {...props} row={row} />)}</ul>}
      {rows.some(row => row.status === undefined) && <p className={css.note}>{t('statusNote')}</p>}
    </>
  )
}

/** The dot and label of a row: its client's connection state when it reports one, else the plugin's load phase. */
function stateOf(row: McpServerInfo, t: McpServersCardProps['t']): { dot: StateDotState; text: string } {
  const { status } = row
  if (row.enabled && status !== undefined) {
    switch (status.state) {
      case 'connected': return { dot: 'done', text: t('stateConnected') }
      case 'connecting': return { dot: 'ongoing', text: t('stateConnecting') }
      case 'reconnecting': return { dot: 'warning', text: t('stateReconnecting', { attempt: status.attempt, max: status.maxAttempts }) }
      case 'failed': return { dot: 'error', text: t('stateFailed') }
    }
  }
  const phase = PHASE[row.enabled ? row.fiberPhase ?? 'off' : 'off']
  return { dot: phase.dot, text: t(phase.key) }
}

function ServerRow(props: McpServersCardProps & { row: McpServerInfo; pending: string | null }): ReactNode {
  const { t, row, pending, toggle, openEdit, askRemove, openTools, reconnect } = props
  const state = stateOf(row, t)
  const name = row.serverName === '' ? row.id : row.serverName
  const connection = row.enabled ? row.status : undefined
  const retryable = connection?.state === 'failed' || connection?.state === 'reconnecting'
  return (
    <li className={css.row}>
      <StateDot state={state.dot} />
      <div className={css.rowBody}>
        <div className={css.rowTitle}>
          <span className={css.name}>{name}</span>
          <Tag>{t(row.transport === 'stdio' ? 'transportStdio' : 'transportHttp')}</Tag>
          <Tag tone={state.dot === 'error' ? 'danger' : state.dot === 'warning' ? 'warning' : 'outline'}>{state.text}</Tag>
        </div>
        <div className={css.summary}>{row.summary}</div>
        {connection?.error !== undefined && connection.state !== 'connected' && <div className={css.problem}>{connection.error}</div>}
        {row.readOnlyReason !== undefined && <div className={css.reason}>{t(REASON[row.readOnlyReason])}</div>}
      </div>
      <div className={css.actions}>
        {connection !== undefined && connection.toolCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => { openTools(row.id) }}>{t('toolsButton', { count: connection.toolCount })}</Button>
        )}
        {retryable && (
          <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => { reconnect(row.id) }}>{t('reconnect')}</Button>
        )}
        {row.spec !== undefined && (
          <Button variant="ghost" size="sm" onClick={() => { openEdit(row.id) }}>{t('edit')}</Button>
        )}
        {row.owned && <Button variant="ghost" size="sm" onClick={() => { askRemove(row.id) }}>{t('remove')}</Button>}
        <Switch
          label={t('enableServer', { name })}
          checked={row.enabled}
          disabled={!row.owned || pending !== null}
          onChange={(next) => { toggle(row.id, next) }}
        />
      </div>
    </li>
  )
}
