/**
 * The tools dialog: every tool one server offers, filterable by name or
 * description, each expandable to its description, its parameters, and what
 * happens when the model calls it.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, Input, Modal, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpToolInfo, McpToolMode } from '@deepseek-ai/dsh-api-remotes/client'
import { TOOL_MODE_LABEL, TOOL_MODES } from './tool-modes.ts'
import type { McpServersCardProps } from './McpServersCard.tsx'
import type { McpServersState } from './mcp-servers-controller.ts'
import css from './McpServers.module.css'

/** The first line of a description, for the collapsed row. */
function firstLine(text: string): string {
  return text.split('\n', 1).join('')
}

/**
 * Render the tools dialog.
 * @param props - page actions and locale, with the open tools state or null.
 * @returns the dialog, or null while none is open.
 */
export function McpToolsDialog(props: McpServersCardProps & { tools: McpServersState['tools'] }): ReactNode {
  const { t, tools, closeTools } = props
  if (tools === null) return null
  const name = tools.row.serverName === '' ? tools.row.id : tools.row.serverName
  return (
    <Modal
      open
      title={t('toolsTitle', { name })}
      closeLabel={t('close')}
      onClose={closeTools}
      className={clsx(css.toolsDialog)}
      contentClassName={clsx(css.dialogBody)}
      footer={<Button variant="outline" onClick={closeTools}>{t('close')}</Button>}
    >
      <ToolsBody {...props} tools={tools} />
    </Modal>
  )
}

function ToolsBody(props: McpServersCardProps & { tools: NonNullable<McpServersState['tools']> }): ReactNode {
  const { t, tools } = props
  const [filter, setFilter] = useState('')
  if (tools.status === 'loading') return <div className={css.center} role="status"><StateDot state="ongoing" /></div>
  if (tools.status === 'failed') return <p className={css.body} role="alert">{t('toolsFailed')}</p>
  if (tools.tools.length === 0) return <p className={css.body}>{t('toolsEmpty')}</p>
  const query = filter.trim().toLowerCase()
  const shown = query === ''
    ? tools.tools
    : tools.tools.filter(tool => `${tool.publicName} ${tool.description}`.toLowerCase().includes(query))
  return (
    <div className={css.form}>
      <p className={css.body}>{t('toolsIntro')}</p>
      {tools.row.spec === undefined && <p className={css.hint}>{t('toolsPolicyReadOnly')}</p>}
      <Input aria-label={t('toolsFilter')} placeholder={t('toolsFilter')} value={filter} onChange={(event) => { setFilter(event.target.value) }} />
      {shown.length === 0
        ? <p className={css.body}>{t('toolsNoMatch')}</p>
        : <ul className={css.toolList}>{shown.map(tool => <ToolItem key={tool.name} {...props} tools={tools} tool={tool} />)}</ul>}
    </div>
  )
}

/** The select value that follows the server default. */
const INHERIT = 'inherit'

function ToolItem(props: McpServersCardProps & { tools: NonNullable<McpServersState['tools']>; tool: McpToolInfo }): ReactNode {
  const { t, tools, tool, setToolMode } = props
  const policy = tools.row.toolPolicy
  const own = policy.tools[tool.name]
  const effective = own ?? policy.default
  const selectId = `mcp-tool-mode-${tool.name}`
  return (
    <li>
      <details className={css.tool}>
        <summary className={css.toolSummary}>
          <span className={css.toolName}>{tool.publicName}</span>
          {tool.description !== '' && <span className={css.toolBrief}>{firstLine(tool.description)}</span>}
          <Tag tone={effective === 'allow' ? 'warning' : 'outline'} className={css.toolMode}>{t(TOOL_MODE_LABEL[effective])}</Tag>
        </summary>
        <div className={css.toolHelp}>
          <div className={css.toolModeRow}>
            <label className={css.label} htmlFor={selectId}>{t('toolMode')}</label>
            <select
              id={selectId}
              className={css.select}
              value={own ?? INHERIT}
              disabled={tools.row.spec === undefined || tools.savingTool !== null}
              onChange={(event) => {
                const value = event.target.value
                setToolMode(tool.name, value === INHERIT ? null : value as McpToolMode)
              }}
            >
              <option value={INHERIT}>{t('toolModeInherit', { mode: t(TOOL_MODE_LABEL[policy.default]) })}</option>
              {TOOL_MODES.map(mode => <option key={mode} value={mode}>{t(TOOL_MODE_LABEL[mode])}</option>)}
            </select>
          </div>
          <p className={css.toolText}>{tool.description === '' ? t('toolNoDescription') : tool.description}</p>
          {tool.parameters.length === 0
            ? <p className={css.hint}>{t('toolNoParameters')}</p>
            : (
              <table className={css.params}>
                <thead>
                  <tr>
                    <th scope="col">{t('paramName')}</th>
                    <th scope="col">{t('paramType')}</th>
                    <th scope="col">{t('paramDescription')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tool.parameters.map(parameter => (
                    <tr key={parameter.name}>
                      <td>
                        <code>{parameter.name}</code>
                        <span className={css.paramFlag}>{t(parameter.required ? 'paramRequired' : 'paramOptional')}</span>
                      </td>
                      <td><code>{parameter.type}</code></td>
                      <td>{parameter.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </details>
    </li>
  )
}
