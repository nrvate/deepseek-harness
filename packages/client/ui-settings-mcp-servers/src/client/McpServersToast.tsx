/** Outcome feedback hosted outside the Plugins panel's lifetime. */
import type { ReactNode } from 'react'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpNotice, McpServersFace } from './mcp-servers-controller.ts'
import type { McpServersLocaleKey } from './locales.ts'

/** The controller's notice source and dismissal action. */
export type McpServersToastFace = Pick<McpServersFace, 'dismissNotice'> & { hooks: Pick<McpServersFace['hooks'], 'mcpServers'> }

/** Render inputs bound from the shared controller and plugin dictionary. */
export type McpServersToastProps = InjectFace<McpServersToastFace> & PropsLocale<'settings.mcpServers'>

const TEXT: Record<McpNotice['kind'], McpServersLocaleKey> = {
  saved: 'noticeSaved',
  removed: 'noticeRemoved',
  enabled: 'noticeEnabled',
  disabled: 'noticeDisabled',
  failed: 'noticeFailed',
  'refresh-failed': 'noticeRefreshFailed',
}

/**
 * Report the last change's outcome, including after navigation leaves the Plugins panel.
 * @param props - notice hook, dismissal action, and locale seat.
 * @returns the toast, or null while there is nothing to report.
 */
export function McpServersToast({ useMcpServers, dismissNotice, t }: McpServersToastProps): ReactNode {
  const notice = useMcpServers(state => state.notice)
  if (notice === null) return null
  const failed = notice.kind === 'failed' || notice.kind === 'refresh-failed'
  return (
    <Toast
      key={notice.seq}
      text={t(notice.restart && !failed ? 'noticeRestart' : TEXT[notice.kind])}
      {...failed ? { icon: <IconWarningOutlineRegular /> } : { tone: 'success' as const }}
      onDone={dismissNotice}
    />
  )
}
