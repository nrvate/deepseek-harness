/**
 * The dialogs of the MCP servers page: the add and edit form, the command
 * confirmation a local server needs before it is saved, and the removal
 * confirmation. Each reads its state from the page snapshot and writes only
 * through the controller's actions.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, Checkbox, Input, Modal, SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpServersCardProps } from './McpServersCard.tsx'
import type { EditorError, EditorState, McpServersState, ValueDraft, ValueMode } from './mcp-servers-controller.ts'
import type { McpServersLocaleKey } from './locales.ts'
import css from './McpServers.module.css'

const MODES: readonly ValueMode[] = ['env', 'bearer', 'literal', 'kept', 'expression']

const MODE_LABEL: Record<ValueMode, McpServersLocaleKey> = {
  env: 'kindEnv', bearer: 'kindBearer', literal: 'kindLiteral', kept: 'kindKept', expression: 'kindExpression',
}

const MODE_HINT: Partial<Record<ValueMode, McpServersLocaleKey>> = {
  env: 'hintEnv', bearer: 'hintBearer', kept: 'hintKept', expression: 'hintExpression',
}

const ERROR_TEXT: Record<EditorError['code'], McpServersLocaleKey> = {
  'invalid-config': 'errorInvalid',
  'duplicate-server': 'errorDuplicate',
  'literal-secret': 'errorSecret',
  'read-only': 'errorReadOnly',
  'unknown-server': 'errorUnknown',
  'unreadable-patch': 'errorPatch',
  'operation-error': 'errorOperation',
  'confirmation-required': 'errorOperation',
  timeout: 'errorTimeout',
  transport: 'errorTransport',
}

/**
 * Render the add and edit form, and the command confirmation over it.
 * @param props - page actions and locale, with the open editor or null.
 * @returns the dialogs, or null while no editor is open.
 */
export function McpServerEditor(props: McpServersCardProps & { editor: McpServersState['editor'] }): ReactNode {
  const { editor } = props
  if (editor === null) return null
  return (
    <>
      <EditorDialog {...props} editor={editor} />
      <ConfirmDialog {...props} editor={editor} />
    </>
  )
}

function Field(props: { id: string; label: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={props.id}>{props.label}</label>
      {props.children}
      {props.hint !== undefined && <span className={css.hint}>{props.hint}</span>}
    </div>
  )
}

function EditorDialog(props: McpServersCardProps & { editor: EditorState }): ReactNode {
  const { t, editor, closeEditor, save, editField, setTransport, setFailOnStartup, setDefaultActive } = props
  const { draft, saving, error } = editor
  const stdio = draft.transport === 'stdio'
  const complete = draft.serverName.trim() !== '' && (stdio ? draft.command.trim() !== '' : draft.url.trim() !== '')
  return (
    <Modal
      open={editor.confirm === null}
      title={t(draft.rowId === undefined ? 'addTitle' : 'editTitle')}
      closeLabel={t('close')}
      onClose={closeEditor}
      className={clsx(css.dialog)}
      contentClassName={clsx(css.dialogBody)}
      footer={(
        <>
          {error !== null && (
            <p className={css.footerError} role="alert">
              {t(ERROR_TEXT[error.code])}
              {error.detail !== '' && <span className={css.detail}> {error.detail}</span>}
            </p>
          )}
          <Button variant="outline" onClick={closeEditor}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!complete || saving} onClick={save}>
            {t(saving ? 'saving' : 'save')}
          </Button>
        </>
      )}
    >
      <form className={css.form} onSubmit={(event) => { event.preventDefault() }}>
        <Field id="mcp-server-name" label={t('serverName')} hint={t('serverNameHint')}>
          <Input
            id="mcp-server-name"
            data-modal-autofocus
            value={draft.serverName}
            onChange={(event) => { editField('serverName', event.target.value) }}
          />
        </Field>
        <SegmentedControl
          id="mcp-server-transport"
          label={t('transport')}
          value={draft.transport}
          disabled={draft.rowId !== undefined}
          options={[
            { value: 'stdio', label: t('transportStdio') },
            { value: 'streamable-http', label: t('transportHttp') },
          ]}
          onChange={setTransport}
        />
        {stdio ? (
          <>
            <Field id="mcp-server-command" label={t('command')}>
              <Input id="mcp-server-command" value={draft.command} onChange={(event) => { editField('command', event.target.value) }} />
            </Field>
            <Field id="mcp-server-args" label={t('args')} hint={t('argsHint')}>
              <textarea
                id="mcp-server-args"
                className={css.textarea}
                rows={3}
                value={draft.args}
                onChange={(event) => { editField('args', event.target.value) }}
              />
            </Field>
            <Field id="mcp-server-cwd" label={t('cwd')} hint={t('cwdHint')}>
              <Input id="mcp-server-cwd" value={draft.cwd} onChange={(event) => { editField('cwd', event.target.value) }} />
            </Field>
          </>
        ) : (
          <Field id="mcp-server-url" label={t('url')}>
            <Input id="mcp-server-url" value={draft.url} onChange={(event) => { editField('url', event.target.value) }} />
          </Field>
        )}
        <ValueList {...props} />
        <Field id="mcp-server-timeout" label={t('timeout')} hint={t('timeoutHint')}>
          <Input id="mcp-server-timeout" inputMode="numeric" value={draft.timeoutMs} onChange={(event) => { editField('timeoutMs', event.target.value) }} />
        </Field>
        <div className={css.switchRow}>
          <span className={css.label}>{t('failOnStartup')}</span>
          <Switch label={t('failOnStartup')} checked={draft.failOnStartupError} onChange={setFailOnStartup} />
        </div>
        <div className={css.switchRow}>
          <span className={css.switchText}>
            <span className={css.label}>{t('defaultActive')}</span>
            <span className={css.hint}>{t('defaultActiveHint')}</span>
          </span>
          <Switch label={t('defaultActive')} checked={draft.defaultActive} onChange={setDefaultActive} />
        </div>
      </form>
    </Modal>
  )
}

function ValueList(props: McpServersCardProps & { editor: EditorState }): ReactNode {
  const { t, editor, addValue } = props
  return (
    <fieldset className={css.values}>
      <legend className={css.label}>{t(editor.draft.transport === 'stdio' ? 'env' : 'headers')}</legend>
      {editor.draft.values.map(entry => <ValueRow key={entry.uid} {...props} entry={entry} />)}
      <Button variant="outline" size="sm" className={css.addValue} onClick={addValue}>{t('addValue')}</Button>
    </fieldset>
  )
}

function ValueRow(props: McpServersCardProps & { entry: ValueDraft }): ReactNode {
  const { t, entry, editValue, removeValue } = props
  const hint = MODE_HINT[entry.mode]
  return (
    <div className={css.valueRow}>
      <Input
        aria-label={t('valueName')}
        value={entry.key}
        onChange={(event) => { editValue(entry.uid, { key: event.target.value }) }}
      />
      <select
        className={css.select}
        aria-label={t('valueKind')}
        value={entry.mode}
        onChange={(event) => { editValue(entry.uid, { mode: event.target.value as ValueMode }) }}
      >
        {MODES.map(mode => <option key={mode} value={mode}>{t(MODE_LABEL[mode])}</option>)}
      </select>
      <Input
        aria-label={t('valueText')}
        value={entry.text}
        disabled={entry.mode === 'kept'}
        onChange={(event) => { editValue(entry.uid, { text: event.target.value }) }}
      />
      <Button variant="ghost" size="sm" onClick={() => { removeValue(entry.uid) }}>{t('removeValue')}</Button>
      {hint !== undefined && <span className={css.valueHint}>{t(hint)}</span>}
    </div>
  )
}

function ConfirmDialog(props: McpServersCardProps & { editor: EditorState }): ReactNode {
  const { t, editor, cancelConfirm, acknowledge, confirmSave } = props
  const confirm = editor.confirm
  return (
    <Modal
      open={confirm !== null}
      title={t('confirmTitle')}
      closeLabel={t('close')}
      onClose={cancelConfirm}
      className={clsx(css.dialog)}
      footer={(
        <>
          <Button variant="outline" onClick={cancelConfirm}>{t('cancel')}</Button>
          <Button variant="primary" disabled={confirm?.acknowledged !== true || editor.saving} onClick={confirmSave}>
            {t(editor.saving ? 'saving' : 'confirmAction')}
          </Button>
        </>
      )}
    >
      <div className={css.form}>
        <p className={css.body}>{t('confirmBody')}</p>
        <div className={css.field}>
          <span className={css.label}>{t('confirmCommand')}</span>
          <code className={css.command}>{confirm?.command}</code>
        </div>
        <Checkbox label={t('confirmAcknowledge')} checked={confirm?.acknowledged === true} onChange={acknowledge} />
      </div>
    </Modal>
  )
}

/**
 * Render the removal confirmation.
 * @param props - page actions and locale, with the server awaiting removal or null.
 * @returns the dialog, or null while nothing awaits removal.
 */
export function RemoveDialog(props: McpServersCardProps & { removal: McpServersState['removal'] }): ReactNode {
  const { t, removal, cancelRemove, confirmRemove } = props
  return (
    <Modal
      open={removal !== null}
      title={t('removeTitle')}
      closeLabel={t('close')}
      onClose={cancelRemove}
      footer={(
        <>
          <Button variant="outline" onClick={cancelRemove}>{t('cancel')}</Button>
          <Button variant="primary" disabled={removal?.saving === true} onClick={confirmRemove}>{t('removeAction')}</Button>
        </>
      )}
    >
      <div className={css.form}>
        <p className={css.name}>{removal === null ? '' : removal.row.serverName === '' ? removal.row.id : removal.row.serverName}</p>
        <p className={css.body}>{t('removeBody')}</p>
      </div>
    </Modal>
  )
}
