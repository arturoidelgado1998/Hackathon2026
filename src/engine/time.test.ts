import { describe, expect, it } from 'vitest'
import { formatTime, parseTime } from './time'

describe('single-demo-day clock helpers', () => {
  it.each([
    ['00:00', 0],
    ['09:05', 545],
    ['23:59', 1439],
  ])('round-trips %s as %i minutes', (time, minutes) => {
    expect(parseTime(time)).toBe(minutes)
    expect(formatTime(minutes)).toBe(time)
  })

  it.each(['9:05', '24:00', '12:60', '', ' 10:00', '10:00\n', '10:00:00'])(
    'rejects malformed or out-of-day clock input %j',
    (time) => expect(() => parseTime(time)).toThrow(/HH:MM/),
  )

  it('rejects missing clock inputs instead of defaulting', () => {
    expect(() => parseTime(undefined as unknown as string, 'cargo_ready')).toThrow(/cargo_ready/)
  })

  it.each([-1, 1440, 1.5, NaN, Infinity])('does not round or wrap %s minutes', (minutes) => {
    expect(() => formatTime(minutes)).toThrow(/demo day/)
  })
})
