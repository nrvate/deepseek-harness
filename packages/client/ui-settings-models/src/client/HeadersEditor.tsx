/**
 * The request-header rows of a provider's editor card: the `headers` dict of a
 * profile whose schema declares one, edited as name and value pairs. Rows keep
 * the text as typed, so a half-entered or repeated name stays visible while
 * {@link headersFailure} refuses it; {@link headersOf} is the dict a valid set
 * of rows stores.
 */

import type { ReactNode } from 'react'
import { IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** One drafted header as typed. */
export interface HeaderRow {
  name: string
  value: string
}

/** An HTTP field name: one or more `token` characters (RFC 9110). */
const FIELD_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u

/** A field value Fetch accepts: one line of bytes without NUL. */
const FIELD_VALUE = /^[\t -~\u0080-ÿ]+$/u

/**
 * Read a stored `headers` dict as rows.
 * @param stored - the profile's user-layer `headers` value.
 * @returns one row per string entry, in stored order.
 */
export function headerRows(stored: unknown): HeaderRow[] {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return []
  return Object.entries(stored).flatMap(([name, value]) => typeof value === 'string' ? [{ name, value }] : [])
}

/** A row with nothing typed in either input; it stores nothing and fails nothing. */
function isBlank(row: HeaderRow): boolean {
  return row.name.trim().length === 0 && row.value.trim().length === 0
}

/**
 * The dict a set of rows stores.
 * @param rows - drafted rows.
 * @returns names and values without surrounding whitespace, or undefined when no row carries a header.
 */
export function headersOf(rows: readonly HeaderRow[]): Record<string, string> | undefined {
  const entries = rows.filter(row => !isBlank(row)).map(row => [row.name.trim(), row.value.trim()] as const)
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

/** A refused row: the message and the row's position. */
export interface HeadersFailure {
  message: string
  index: number
}

/**
 * The first row that cannot be stored: a name that is not an HTTP field name,
 * a value that is empty or not one line of bytes, or a name an earlier row
 * already uses in any capitalization.
 * @param rows - drafted rows.
 * @param t - section copy.
 * @returns the failure, or undefined when every row is valid or blank.
 */
export function headersFailure(rows: readonly HeaderRow[], t: (key: ModelsKey) => string): HeadersFailure | undefined {
  const seen = new Set<string>()
  for (const [index, row] of rows.entries()) {
    if (isBlank(row)) continue
    const name = row.name.trim()
    const key = !FIELD_NAME.test(name) ? 'headerNameInvalid'
      : !FIELD_VALUE.test(row.value.trim()) ? 'headerValueInvalid'
        : seen.has(name.toLowerCase()) ? 'headerDuplicate'
          : undefined
    if (key !== undefined) return { message: t(key).replace('{index}', () => String(index + 1)), index }
    seen.add(name.toLowerCase())
  }
  return undefined
}

/** Props of {@link HeadersEditor}. */
export interface HeadersEditorProps {
  /** Drafted rows. */
  rows: readonly HeaderRow[]
  /** Failure from {@link headersFailure}. */
  failure: HeadersFailure | undefined
  /** Id of the element showing the failure message. */
  failureId: string
  /** Show the failure message below the rows; otherwise the owner shows it. */
  showFailure: boolean
  /** Section copy. */
  t: (key: ModelsKey) => string
  /** Disable edits. */
  disabled: boolean
  /** Replace the drafted rows. */
  onChange: (next: HeaderRow[]) => void
}

/**
 * Render the header rows and the control that adds one.
 * @param props - drafted rows, their failure, and the draft writer.
 * @returns the request-headers field group.
 */
export function HeadersEditor(props: HeadersEditorProps): ReactNode {
  const { t, rows, disabled, failure } = props
  const labelId = `${props.failureId}-label`
  const hintId = `${props.failureId}-hint`
  const edit = (index: number, field: keyof HeaderRow, text: string): void => {
    props.onChange(rows.map((row, position) => position === index ? { ...row, [field]: text } : row))
  }
  return (
    <div className={styles['field']} role="group" aria-labelledby={labelId} aria-describedby={hintId}>
      <span id={labelId} className={styles['fieldLabel']}>{t('requestHeaders')}</span>
      {rows.map((row, index) => {
        const position = String(index + 1)
        const invalid = failure?.index === index
        const input = (field: keyof HeaderRow, label: ModelsKey): ReactNode => (
          <input
            className={styles['input']}
            type="text"
            // Header names and values are not prose; a corrected capital changes the value sent.
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={row[field]}
            placeholder={t(label)}
            aria-label={`${t(label)} ${position}`}
            aria-invalid={invalid}
            aria-describedby={invalid ? props.failureId : undefined}
            disabled={disabled}
            onChange={(event) => { edit(index, field, event.target.value) }}
          />
        )
        return (
          // Rows have no identity beyond their position; the inputs are controlled, so a removal re-renders each from its row.
          <div key={index} className={styles['headerRow']}>
            {input('name', 'headerName')}
            {input('value', 'headerValue')}
            <button
              type="button"
              className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
              aria-label={`${t('headerRemove')} ${position}`}
              title={t('headerRemove')}
              disabled={disabled}
              onClick={() => { props.onChange(rows.filter((_, other) => other !== index)) }}
            >
              <IconTrashOutlineRegular size={14} />
            </button>
          </div>
        )
      })}
      <div>
        <button
          type="button"
          className={styles['secondaryButton']}
          disabled={disabled}
          onClick={() => { props.onChange([...rows, { name: '', value: '' }]) }}
        >
          {t('headerAdd')}
        </button>
      </div>
      <span id={hintId} className={styles['advancedHint']}>{t('requestHeadersHint')}</span>
      {failure === undefined || !props.showFailure
        ? null
        : <p id={props.failureId} className={styles['error']}>{failure.message}</p>}
    </div>
  )
}
