/** Reasoning-level declarations for a model on a pi-ai route. */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconPlusOutlineRegular, IconTrashOutlineRegular, Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import { modelDrafts } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Declared levels in stored order, each with the value stored for it, whatever a hand edit left there. */
type Entries = readonly (readonly [string, unknown])[]

/**
 * Levels a model starts with when the switch is turned on: every level the
 * schema names, which is what a model declaring no `reasoningEfforts`
 * resolves to. A protocol accepting only some of them narrows this.
 */
const INITIAL_LEVELS: readonly string[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** The wire value a level sends unless its row says otherwise; `null` is the Off entry that sends nothing. */
function defaultValue(level: string): string | null {
  return level === 'off' ? null : level
}

/**
 * Whether pi-ai accepts a stored value: a non-empty string, or nothing for Off.
 * @param level - the declared level.
 * @param wire - the value stored for it.
 * @returns whether the adapter would resolve the entry.
 */
function acceptedValue(level: string, wire: unknown): boolean {
  return typeof wire === 'string' ? wire.length > 0 : wire === null && level === 'off'
}

/**
 * Read the declared levels from a row in their stored order, including a key
 * the offered levels do not name, so an edit never drops it.
 * @param model - model row as drafted.
 * @returns the entries; empty for a valueless field, which pi-ai refuses, and
 * `undefined` when the field is absent or `false`.
 */
function readEfforts(model: DeepSeekModelDraft): Entries | undefined {
  const value = model['reasoningEfforts']
  if (value === null) return []
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  return Object.entries(value)
}

/**
 * Replace a row's declared levels, preserving every other field.
 * @param model - model row as drafted.
 * @param entries - the levels to write in row order, `undefined` to remove the field, or `false` to declare a non-reasoning model.
 * @returns the replacement row.
 */
function withEfforts(model: DeepSeekModelDraft, entries: Entries | false | undefined): DeepSeekModelDraft {
  const next = { ...model }
  if (entries === undefined) {
    // Absent keeps the installed catalog's levels; a model the catalog does not describe then offers every level.
    Reflect.deleteProperty(next, 'reasoningEfforts')
    return next
  }
  next['reasoningEfforts'] = entries === false ? false : Object.fromEntries(entries)
  return next
}

/**
 * Replace a row's own default level, preserving every other field.
 *
 * Used by the default selector only, and it also guards the reverse direction:
 * levels removed from `reasoningEfforts` must not leave a default behind, since
 * the adapter refuses a default naming a level the model no longer offers.
 * @param model - model row as drafted.
 * @param level - the level requests should default to, or `undefined` to inherit the route's.
 * @returns the replacement row.
 */
function withDefaultEffort(model: DeepSeekModelDraft, level: string | undefined): DeepSeekModelDraft {
  const next = { ...model }
  if (level === undefined) {
    Reflect.deleteProperty(next, 'defaultReasoningEffort')
  } else {
    next['defaultReasoningEffort'] = level
  }
  return next
}

/**
 * The row's own default level, whatever a hand edit left there.
 * @param model - model row as drafted.
 * @returns the stored level, or `undefined` when the row inherits the route's.
 */
function readDefaultEffort(model: DeepSeekModelDraft): string | undefined {
  const value = model['defaultReasoningEffort']
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** A reasoning-level failure the Models cards name by row. */
export interface ReasoningEffortsFailure {
  /** Zero-based model position. */
  index: number
  /** Message key owned by the Models settings section. */
  key: 'modelReasoningValueRequired' | 'modelReasoningNeedsLevel' | 'modelReasoningLevelsOnly'
}

/**
 * Whether an entry breaks a protocol that accepts only its offered levels,
 * each sent under its own name.
 * @param only - the accepted levels.
 * @param level - the declared level.
 * @param wire - the value stored for it.
 * @returns whether the entry is outside the accepted levels.
 */
function outsideLevels(only: readonly string[], level: string, wire: unknown): boolean {
  return !only.includes(level) || wire !== level
}

/**
 * Mirror the pi-ai refusals of a model's `reasoningEfforts`, so a card
 * names the row instead of failing at the write.
 * @param value - drafted `models` value, or `undefined` while inherited.
 * @param only - the levels the route's protocol accepts, each sent under its
 * own name, or `undefined` when the protocol accepts any declared value.
 * @returns the first refused row, or `undefined` when the adapter will accept every row.
 */
export function validateReasoningEfforts(value: unknown, only?: readonly string[]): ReasoningEffortsFailure | undefined {
  for (const [index, model] of modelDrafts(value).entries()) {
    const entries = readEfforts(model)
    if (entries === undefined) continue
    if (only !== undefined && entries.some(([level, wire]) => outsideLevels(only, level, wire))) {
      return { index, key: 'modelReasoningLevelsOnly' }
    }
    if (entries.some(([level, wire]) => !acceptedValue(level, wire))) return { index, key: 'modelReasoningValueRequired' }
    if (!entries.some(([level]) => level !== 'off')) return { index, key: 'modelReasoningNeedsLevel' }
  }
  return undefined
}

/** Props of {@link ModelReasoningEfforts}. */
interface ModelReasoningEffortsProps {
  /** Effective model row, including fields outside the curated editor. */
  model: DeepSeekModelDraft
  /** Levels the adapter's schema accepts as `reasoningEfforts` keys, in escalation order. */
  levels: readonly string[]
  /** Whether the route's protocol accepts only {@link levels}, each sent under its own name. */
  levelsOnly: boolean
  /**
   * Whether the installed catalog describes this model, so an absent
   * `reasoningEfforts` keeps the catalog's levels. A model it does not
   * describe reasons at every level while the field is absent, and only
   * `false` declares it non-reasoning.
   */
  inherits: boolean
  /** One-based row position for accessible names. */
  position: number
  /** Prevent changes while read-only or saving. */
  disabled: boolean
  /** Section copy. */
  t: (key: ModelsKey) => string
  /** Replace this row, preserving unrelated configuration. */
  onChange: (model: DeepSeekModelDraft) => void
}

/**
 * Edit the `reasoningEfforts` a pi-ai model offers: a switch,
 * then one row per level pairing the level with the value sent for it. Every
 * row is read from the model, so a reused instance shows its new model.
 * @param props - model declaration and row replacement action.
 * @returns the reasoning-level group.
 */
export function ModelReasoningEfforts(props: ModelReasoningEffortsProps): ReactNode {
  const { model, levels, levelsOnly, inherits, position, disabled, t, onChange } = props
  // Seeded from the levels the schema names, so a protocol's own accepted set
  // narrows it while a hand-written spelling stays available to add by hand.
  const initialEntries: Entries = levels
    .filter(level => INITIAL_LEVELS.includes(level))
    .map(level => [level, defaultValue(level)] as const)
  // A model the catalog does not describe reasons while the field is absent,
  // so the switch reads on and shows the rows it would be seeded with; they
  // are stored once a row is edited.
  const entries = readEfforts(model) ?? (!inherits && model['reasoningEfforts'] === undefined ? initialEntries : undefined)
  // Only the focused field keeps its own text, so a field cleared while typing
  // stays empty although its level's name is stored. Leaving the field drops
  // it, and deleting a model, resetting the list, or folding these options all
  // move focus first, so no text outlives the field it was typed into.
  const [typing, setTyping] = useState<{ level: string; text: string } | undefined>(undefined)
  const label = `${t('modelReasoning')} ${String(position)}`
  const used = entries?.map(([level]) => level) ?? []
  const defaultEffort = readDefaultEffort(model)

  /**
   * Write new levels together with the default they have to stay consistent
   * with: a default naming a level the row no longer declares is refused at
   * load, so it is dropped rather than written beside a declaration that
   * cannot carry it.
   * @param next - the levels to store in row order.
   * @param renamedTo - the level a renamed default row now declares, when this
   *   write renames the row the default names.
   */
  const write = (next: Entries | false | undefined, renamedTo?: string): void => {
    const kept = next === undefined || next === false ? [] : next
    const selected = readDefaultEffort(model)
    const follows = renamedTo !== undefined && selected !== undefined
    const survives = selected !== undefined && kept.some(([level]) => level === selected)
    const withLevels = withEfforts(model, next)
    if (follows) {
      onChange(withDefaultEffort(withLevels, renamedTo))
      return
    }
    onChange(selected !== undefined && !survives ? withDefaultEffort(withLevels, undefined) : withLevels)
  }
  const replaceAt = (current: Entries, index: number, entry: readonly [string, unknown]): Entries =>
    current.map((existing, at) => at === index ? entry : existing)

  const changeLevel = (current: Entries, index: number, from: string, wire: unknown, to: string): void => {
    // Only a custom spelling between two thinking levels carries over; a value
    // still spelled as its old level, or one crossing to or from Off, resets.
    // A protocol accepting only its offered levels sends each under its own name, so nothing carries.
    const carried = !levelsOnly && typeof wire === 'string' && wire.length > 0 && wire !== from && from !== 'off' && to !== 'off'
    // Renaming the row that holds the default renames the default with it: the
    // user moved a level, not removed one, and keeping the old name would both
    // drop their choice and leave the route's level to apply instead.
    write(replaceAt(current, index, [to, carried ? wire : defaultValue(to)]), defaultEffort === from ? to : undefined)
  }

  const addLevel = (current: Entries): void => {
    const highest = Math.max(-1, ...used.map(level => levels.indexOf(level)))
    const level = levels.find((candidate, index) => index > highest && !used.includes(candidate))
      ?? levels.find(candidate => !used.includes(candidate))
    /* v8 ignore next -- the add button is disabled once every level has a row */
    if (level === undefined) return
    write([...current, [level, defaultValue(level)]])
  }

  const editValue = (current: Entries, index: number, level: string, text: string): void => {
    setTyping({ level, text })
    const trimmed = text.trim()
    write(replaceAt(current, index, [level, trimmed.length === 0 ? defaultValue(level) : trimmed]))
  }

  const leaveValue = (current: Entries, index: number, level: string, wire: unknown): void => {
    setTyping(undefined)
    // Leaving a field whose stored value the adapter refuses repairs it with the level name.
    if (!acceptedValue(level, wire)) write(replaceAt(current, index, [level, defaultValue(level)]))
  }

  // A stored key the offered levels do not name stays selectable in its own row.
  const choicesFor = (level: string): readonly string[] => [
    ...levels.includes(level) ? [] : [level],
    ...levels.filter(choice => choice === level || !used.includes(choice)),
  ]
  const refused = entries?.some(([level, wire]) => !acceptedValue(level, wire)) === true
  const missingLevel = entries !== undefined && !used.some(level => level !== 'off')
  const outside = levelsOnly && entries?.some(([level, wire]) => outsideLevels(levels, level, wire)) === true

  return (
    <div className={styles['modelReasoning']} role="group" aria-label={label}>
      <div className={styles['modelReasoningHead']}>
        <span className={`${styles['modelFieldLabel']} ${styles['modelReasoningLabel']}`}>
          {t('modelReasoning')}
          <Tooltip label={t('modelReasoningHelpText')} side="right" delayMs={0} focusDelayMs={0} portal openOnClick>
            <button type="button" className={styles['helpButton']} aria-label={t('modelReasoningHelp')}>?</button>
          </Tooltip>
        </span>
        <Switch
          checked={entries !== undefined}
          label={label}
          disabled={disabled}
          // Switching off removes the field where that keeps the catalog's levels; elsewhere only `false` stops reasoning.
          onChange={(on) => { write(on ? initialEntries : inherits ? undefined : false) }}
        />
      </div>
      {entries === undefined
        ? null
        : (
          <>
            {entries.length > 0
              ? (
                <div className={styles['modelReasoningRow']} aria-hidden="true">
                  <span className={styles['modelFieldLabel']}>{t('modelReasoningLevel')}</span>
                  <span className={styles['modelFieldLabel']}>{t('modelReasoningValue')}</span>
                </div>
              )
              : null}
            {entries.map(([level, wire], index) => (
              // A row is the entry at this position of the stored dict: changing its
              // level edits that entry in place and rows keep no state of their own,
              // so the position is the row's identity. Keying by level would remount
              // the select on every change and drop keyboard focus.
              <div key={index} className={styles['modelReasoningRow']}>
                <select
                  className={`${styles['input']} ${styles['selectInput']}`}
                  value={level}
                  aria-label={`${t('modelReasoningLevel')} ${String(index + 1)}`}
                  disabled={disabled}
                  onChange={(event) => { changeLevel(entries, index, level, wire, event.target.value) }}
                >
                  {choicesFor(level).map(choice => (
                    <option key={choice} value={choice}>{choice}</option>
                  ))}
                </select>
                <input
                  className={`${styles['input']} ${styles['modelReasoningValueInput']}`}
                  type="text"
                  value={typing?.level === level ? typing.text : typeof wire === 'string' ? wire : ''}
                  placeholder={level === 'off' ? t('modelReasoningOffValuePlaceholder') : level}
                  aria-label={`${level} ${t('modelReasoningValue')}`}
                  aria-invalid={!acceptedValue(level, wire)}
                  // Off only turns reasoning off; a value stored in cordis.patch.yml is shown and kept.
                  // A protocol accepting only its offered levels sends each under its own name.
                  disabled={disabled || level === 'off' || levelsOnly}
                  onChange={(event) => { editValue(entries, index, level, event.target.value) }}
                  onBlur={() => { leaveValue(entries, index, level, wire) }}
                />
                <button
                  type="button"
                  className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
                  aria-label={`${t('modelReasoningRemove')} ${level}`}
                  title={t('modelReasoningRemove')}
                  disabled={disabled}
                  onClick={() => { write(entries.filter((_entry, at) => at !== index)) }}
                >
                  <IconTrashOutlineRegular size={14} />
                </button>
              </div>
            ))}
            {outside
              ? <p className={styles['error']}>{t('modelReasoningLevelsOnly')}</p>
              : refused
                ? <p className={styles['error']}>{t('modelReasoningValueRequired')}</p>
                : missingLevel ? <p className={styles['error']}>{t('modelReasoningNeedsLevel')}</p> : null}
            <button
              type="button"
              className={styles['addModelButton']}
              disabled={disabled || levels.every(level => used.includes(level))}
              onClick={() => { addLevel(entries) }}
            >
              <IconPlusOutlineRegular size={14} />
              {t('modelReasoningAdd')}
            </button>
            {entries.length > 0
              ? (
                // Not a `label`: it would label the help button, its first control, instead of the select.
                <div className={styles['modelDefaultEffort']}>
                  <span className={`${styles['modelFieldLabel']} ${styles['modelReasoningLabel']}`}>
                    {t('modelDefaultEffort')}
                    <Tooltip label={t('modelDefaultEffortHelpText')} side="right" delayMs={0} focusDelayMs={0} portal openOnClick>
                      <button type="button" className={styles['helpButton']} aria-label={t('modelDefaultEffortHelp')}>?</button>
                    </Tooltip>
                  </span>
                  <select
                    className={`${styles['input']} ${styles['selectInput']}`}
                    value={defaultEffort === undefined ? '' : defaultEffort}
                    aria-label={t('modelDefaultEffort')}
                    disabled={disabled}
                    onChange={(event) => { onChange(withDefaultEffort(model, event.target.value === '' ? undefined : event.target.value)) }}
                  >
                    <option value="">{t('modelDefaultEffortInherit')}</option>
                    {/* Every declared level, Off included: only levels this
                        model offers, because the adapter refuses a default it
                        cannot take at load. Off is a real choice here — it pins
                        this model to not thinking while the route keeps its own
                        level for the others. */}
                    {entries.map(([level]) => (
                      <option key={level} value={level}>{level}</option>
                    ))}
                  </select>
                </div>
              )
              : null}
          </>
        )}
    </div>
  )
}
