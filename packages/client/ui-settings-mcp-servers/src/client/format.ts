/** Compact number and duration text for the MCP status panel. */

/** Reads this plugin's dictionary; the same seat the components receive as `t`. */
export type Format = (
  key: 'numberThousand' | 'numberMillion' | 'durationMs' | 'durationSeconds' | 'durationMinutes' | 'durationHours' | 'durationDays',
  params: Record<string, unknown>,
) => string

/** One decimal below 100, none from 100 up, so a figure never exceeds four characters. */
function scaled(value: number): string {
  return value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
}

/**
 * Format a count for a narrow panel.
 * @param value - non-negative count.
 * @param t - dictionary reader.
 * @returns the count, shortened with K or M from one thousand up.
 */
export function formatCount(value: number, t: Format): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('numberThousand', { value: scaled(value / 1_000) })
  return t('numberMillion', { value: scaled(value / 1_000_000) })
}

/**
 * Format how long one call took.
 * @param ms - duration in milliseconds.
 * @param t - dictionary reader.
 * @returns milliseconds below one second, seconds with one decimal above.
 */
export function formatLatency(ms: number, t: Format): string {
  if (ms < 1_000) return t('durationMs', { value: Math.round(ms) })
  return t('durationSeconds', { value: scaled(ms / 1_000) })
}

/**
 * Format a span such as an uptime, in its two largest units.
 * @param ms - span in milliseconds; negative spans read as zero.
 * @param t - dictionary reader.
 * @returns seconds, minutes, hours and minutes, or days and hours.
 */
export function formatSpan(ms: number, t: Format): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  if (seconds < 60) return t('durationSeconds', { value: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('durationMinutes', { value: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('durationHours', { hours, minutes: minutes % 60 })
  return t('durationDays', { days: Math.floor(hours / 24), hours: hours % 24 })
}
