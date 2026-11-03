/**
 * The connection test dialog: the MCP manager connects to one server apart
 * from its running instance, lists its tools, and closes again. Shows what the
 * server reported, or the stage that failed, and whether the test connection
 * closed cleanly.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpServersCardProps } from './McpServersCard.tsx'
import type { McpProbeResult, ProbeState } from './mcp-servers-controller.ts'
import { formatLatency } from './format.ts'
import css from './McpServers.module.css'

/**
 * Render the connection test dialog.
 * @param props - page actions and locale, with the running or finished test, or null.
 * @returns the dialog, or null while no test is open.
 */
export function McpProbeDialog(props: McpServersCardProps & { probeState: ProbeState | null }): ReactNode {
  const { t, probeState: probe, closeProbe } = props
  if (probe === null) return null
  return (
    <Modal
      open
      title={t('probeTitle', { name: probe.name })}
      closeLabel={t('close')}
      onClose={closeProbe}
      className={clsx(css.dialog)}
      contentClassName={clsx(css.dialogBody)}
      footer={<Button variant="outline" onClick={closeProbe}>{t(probe.status === 'running' ? 'cancel' : 'close')}</Button>}
    >
      <div className={css.form}>
        {probe.status === 'running' && (
          <div className={css.center} role="status"><StateDot state="ongoing" /> <span>{t('probeRunning')}</span></div>
        )}
        {probe.status === 'failed' && <p className={css.problem} role="alert">{t('probeRefused', { detail: probe.detail })}</p>}
        {probe.result !== undefined && <ProbeOutcome {...props} result={probe.result} />}
      </div>
    </Modal>
  )
}

function ProbeOutcome(props: McpServersCardProps & { result: McpProbeResult }): ReactNode {
  const { t, result } = props
  const duration = formatLatency(result.durationMs, t)
  const cleanup = !result.closeConfirmed || result.cleanupError !== undefined
  return (
    <>
      {result.ok
        ? (
          <>
            <p className={css.body} role="status">
              {result.serverInfo === undefined
                ? t('probeOk', { duration })
                : t('probeOkServer', { server: `${result.serverInfo.name} ${result.serverInfo.version}`, duration })}
            </p>
            {result.toolNames.length === 0
              ? <p className={css.hint}>{t('toolsEmpty')}</p>
              : (
                <>
                  <p className={css.label}>{t('probeTools', { count: result.toolNames.length })}</p>
                  <code className={css.command}>{result.toolNames.join(', ')}</code>
                  {result.truncated && <p className={css.hint}>{t('probeTruncated')}</p>}
                </>
              )}
          </>
        )
        : (
          <p className={css.problem} role="alert">
            {t(result.stage === 'connect' ? 'probeFailedConnect' : 'probeFailedList', { duration })}
            <span className={css.detail}> {result.message}</span>
          </p>
        )}
      {cleanup && (
        <p className={css.hint}>
          {t('probeCleanup')}
          {result.cleanupError !== undefined && <span className={css.detail}> {result.cleanupError}</span>}
        </p>
      )}
    </>
  )
}
