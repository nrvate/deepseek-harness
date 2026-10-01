/** Compact counts, call latencies, and spans as the status panel shows them. */
import { expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { formatCount, formatLatency, formatSpan, type Format } from '../src/client/format.ts'
import { en, zh } from '../src/client/locales.ts'

const t = makeTranslate(en) as Format

it.each([
  [0, '0'], [999, '999'], [1_000, '1K'], [1_234, '1.2K'], [99_949, '99.9K'], [123_456, '123K'],
  [1_000_000, '1M'], [2_500_000, '2.5M'], [250_000_000, '250M'],
])('shortens the count %d to %s', (value, text) => {
  expect(formatCount(value, t)).toBe(text)
})

it.each([
  [0, '0 ms'], [12.4, '12 ms'], [999, '999 ms'], [1_000, '1 s'], [1_250, '1.3 s'], [125_000, '125 s'],
])('formats the latency %d ms as %s', (ms, text) => {
  expect(formatLatency(ms, t)).toBe(text)
})

it.each([
  [-500, '0 s'], [0, '0 s'], [59_999, '59 s'], [60_000, '1 min'], [3_599_000, '59 min'],
  [3_600_000, '1 h 0 min'], [5_400_000, '1 h 30 min'], [86_400_000, '1 d 0 h'], [100_800_000, '1 d 4 h'],
])('formats the span %d ms as %s', (ms, text) => {
  expect(formatSpan(ms, t)).toBe(text)
})

it('reads the units from the active dictionary', () => {
  const zhT = makeTranslate(zh) as Format
  expect(formatSpan(5_400_000, zhT)).toBe('1 小时 30 分钟')
  expect(formatLatency(12, zhT)).toBe('12 毫秒')
})
