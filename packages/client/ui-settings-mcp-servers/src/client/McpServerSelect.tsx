/**
 * The MCP server selector in the composer tool row, before the model selector:
 * a chip showing how many servers the Session uses, opening a list where each
 * server is switched on or off for this Session. Renders nothing while the
 * Host offers no per-Session selection or no server is enabled.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutlineRegular, IconCordisPluginOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the composer's SlotMap merge (the 'conversation.input.right' entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the `mcpServers` projection key.
import type {} from '@deepseek-ai/dsh-mcp-selection/client'
import type { McpTrayFace } from './mcp-tray-controller.ts'
import { connectionView } from './server-state.ts'
import { useSessionServers } from './session-servers.ts'
import css from './McpServerSelect.module.css'

/** Props the renderer binds for the selector. */
export type McpServerSelectProps =
  PropsRuntime<'conversation.input.right'>
  & PropsLocale<'settings.mcpServers'>
  & InjectFace<McpTrayFace>

/** Menu row ids: one per server, and the row that opens the servers page. */
const SERVER_ROW = 'server:'
const MANAGE_ROW = 'manage'

/**
 * Render the selector chip and, while open, its list of servers.
 * @param props - locale copy, the Session's identity and projections, the server snapshot, and its actions.
 * @returns the selector, or null while there is nothing to select.
 */
export function McpServerSelect(props: McpServerSelectProps): ReactNode {
  const { t, sessionId, load, selectServers, openManager } = props
  const servers = props.useMcpTray(state => state.servers)
  const problem = props.useMcpTray(state => state.problem)
  const selection = props.useProjection('mcpServers')
  const [open, setOpen] = useState(false)
  useEffect(() => { load(sessionId) }, [load, sessionId])
  const { options, active, toggle } = useSessionServers(
    servers, selection?.active ?? null, names => selectServers(sessionId, names))

  if (selection === undefined || options.length === 0) return null

  const items: MenuEntry[] = [
    { type: 'label', id: 'heading', text: t('selectHeading') },
    ...options.map((server): MenuEntry => {
      // A server that is not connected says so beside its name; it can still be selected for when it returns.
      const trouble = server.status === undefined || server.status.state === 'connected'
        ? undefined : connectionView(server.status, t).text
      return {
        id: `${SERVER_ROW}${server.serverName}`,
        label: trouble === undefined
          ? server.serverName
          : (
            <span className={css.option}>
              <span className={css.optionName}>{server.serverName}</span>
              <span className={css.optionState}>{trouble}</span>
            </span>
          ),
      }
    }),
    ...problem === undefined ? [] : [{ type: 'label' as const, id: 'problem', text: t('selectFailed', { detail: problem }) }],
    { type: 'separator', id: 'manage-separator' },
    { id: MANAGE_ROW, label: t('trayManage') },
  ]
  const count = { active: active.length, total: options.length }
  return (
    <Menu
      open={open}
      items={items}
      selectedIds={active.map(name => `${SERVER_ROW}${name}`)}
      onSelect={(id) => {
        // Choosing a server keeps the list open, so several can be switched in one visit.
        if (id.startsWith(SERVER_ROW)) {
          toggle(id.slice(SERVER_ROW.length))
          return
        }
        setOpen(false)
        openManager()
      }}
      onClose={() => { setOpen(false) }}
      side="top"
      portal
      anchor={
        <button
          type="button"
          className={css.trigger}
          aria-label={t('selectLabel', count)}
          title={t('selectLabel', count)}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          <span className={css.triggerIcon} aria-hidden><IconCordisPluginOutlineRegular /></span>
          <span className={css.triggerLabel}>{t('selectShort', count)}</span>
          <span className={clsx(css.chevron, open && css.chevronOpen)} aria-hidden>
            <IconChevronDownOutlineRegular />
          </span>
        </button>
      }
    />
  )
}
