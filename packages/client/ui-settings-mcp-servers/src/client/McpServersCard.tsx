/**
 * The MCP servers page: the servers the MCP manager runs with their live
 * status, an enable switch, and test, edit, remove, and restore actions, plus
 * the dialogs those actions open.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { McpServerEditor, RemoveDialog } from './McpServerEditor.tsx'
import { McpProbeDialog } from './McpProbeDialog.tsx'
import { McpToolsDialog } from './McpToolsDialog.tsx'
import { entrySummary } from './entries.ts'
import { connectionView, problemOf, restartable, useNow } from './server-state.ts'
import type { McpServerRow, McpServerSource, McpServersFace, McpServersState } from './mcp-servers-controller.ts'
import type { McpServersLocaleKey } from './locales.ts'
import css from './McpServers.module.css'

/** Props the renderer binds for the MCP servers page. */
export type McpServersCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.mcpServers'>
  & InjectFace<McpServersFace>

const SOURCE: Record<McpServerSource, McpServersLocaleKey | undefined> = {
  user: undefined,
  inherited: 'sourceInherited',
  overridden: 'sourceOverridden',
  plugin: 'sourcePlugin',
  removed: 'sourceRemoved',
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
        <Button variant="primary" size="sm" disabled={state.status !== 'ready' || !state.writable} onClick={openAdd}>{t('add')}</Button>
      </div>
      <div className={css.preference}>
        <span className={css.label}>{t('statusItemToggle')}</span>
        <Switch
          label={t('statusItemToggle')}
          checked={state.statusItem}
          disabled={!state.statusItemWritable}
          onChange={props.setStatusItem}
        />
      </div>
      <ServerList {...props} state={state} />
      <McpServerEditor {...props} editor={state.editor} />
      <RemoveDialog {...props} removal={state.removal} />
      <McpToolsDialog {...props} tools={state.tools} rows={state.rows} writable={state.writable} />
      <McpProbeDialog {...props} probeState={state.probe} />
    </div>
  )
}

function ServerList(props: McpServersCardProps & { state: McpServersState }): ReactNode {
  const { t, state, load } = props
  const counting = state.rows.some(row => row.status?.state === 'reconnecting')
  const now = useNow(counting)
  if (state.status === 'idle' || state.status === 'loading') {
    return <div className={css.center} role="status"><StateDot state="ongoing" /></div>
  }
  if (state.status === 'missing') return <p className={css.empty}>{t('managerMissing')}</p>
  if (state.status === 'failed') {
    return (
      <div className={css.failure} role="alert">
        <span>{t('loadFailed')}</span>
        <Button variant="outline" size="sm" onClick={load}>{t('retry')}</Button>
      </div>
    )
  }
  return state.rows.length === 0
    ? <p className={css.empty}>{t('empty')}</p>
    : <ul className={css.list}>{state.rows.map(row => <ServerRow key={row.name} {...props} row={row} now={now} />)}</ul>
}

/** The dot and label of a row: the manager's status when it lists the server, else waiting for its first report. */
function stateOf(row: McpServerRow, t: McpServersCardProps['t'], now: number): { dot: StateDotState; text: string } {
  if (row.status !== undefined) return connectionView(row.status, t, now)
  if (row.entry?.enabled === false) return { dot: 'idle', text: t('phaseOff') }
  return { dot: 'ongoing', text: t('phaseLoading') }
}

function ServerRow(props: McpServersCardProps & { state: McpServersState; row: McpServerRow; now: number }): ReactNode {
  const { t, row, now, state, toggle, openEdit, askRemove, openTools, restart, probe } = props
  const view = stateOf(row, t, now)
  const { status, entry } = row
  const problem = status === undefined ? undefined : problemOf(status)
  const source = SOURCE[row.source]
  const busy = state.pending !== null
  return (
    <li className={css.row}>
      <StateDot state={view.dot} />
      <div className={css.rowBody}>
        <div className={css.rowTitle}>
          <span className={css.name}>{row.name}</span>
          {entry !== undefined && <Tag>{t(entry.transport === 'stdio' ? 'transportStdio' : 'transportHttp')}</Tag>}
          <Tag tone={view.dot === 'error' ? 'danger' : view.dot === 'warning' ? 'warning' : 'outline'}>{view.text}</Tag>
          {source !== undefined && <Tag>{t(source)}</Tag>}
          {row.policy.default === 'allow' && <Tag tone="warning">{t('rowCallsAllowed')}</Tag>}
          {row.policy.default === 'deny' && <Tag>{t('rowCallsBlocked')}</Tag>}
        </div>
        {entry !== undefined && <div className={css.summary}>{entrySummary(entry)}</div>}
        {problem !== undefined && <div className={css.problem}>{problem}</div>}
      </div>
      <div className={css.actions}>
        {status?.state === 'connected' && status.toolCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => { openTools(row.name) }}>{t('toolsButton', { count: status.toolCount })}</Button>
        )}
        {status !== undefined && restartable(status) && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { restart(row.name) }}>{t('reconnect')}</Button>
        )}
        {row.source !== 'removed' && (
          <Button variant="ghost" size="sm" disabled={state.probe?.status === 'running'} onClick={() => { probe(row.name) }}>{t('probe')}</Button>
        )}
        {entry !== undefined && state.writable && (
          <Button variant="ghost" size="sm" onClick={() => { openEdit(row.name) }}>{t('edit')}</Button>
        )}
        {(row.source === 'user' || row.source === 'overridden') && state.writable && (
          <Button variant="ghost" size="sm" onClick={() => { askRemove(row.name) }}>{t(row.source === 'user' ? 'remove' : 'restore')}</Button>
        )}
        {entry !== undefined && (
          <Switch
            label={t('enableServer', { name: row.name })}
            checked={entry.enabled}
            disabled={!state.writable || busy}
            onChange={(next) => { toggle(row.name, next) }}
          />
        )}
      </div>
    </li>
  )
}
