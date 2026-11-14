import type { TimeHHMM } from '../types.ts'

/** Validate whole minutes since midnight on the single demo day; no rollover. */
export function assertDayMinute(minutes: number, field = 'time'): void {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
    throw new RangeError(`${field} must be a whole minute on the demo day (0–1439)`)
  }
}

/** Parse a strict 24-hour HH:MM clock time into minutes since midnight. */
export function parseTime(time: TimeHHMM, field = 'time'): number {
  if (typeof time !== 'string' || time.length !== 5 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new RangeError(`${field} must be a 24-hour HH:MM time on the demo day`)
  }
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
}

/** Format whole demo-day minutes; crossing midnight is an error, never wrapped. */
export function formatTime(minutes: number): TimeHHMM {
  assertDayMinute(minutes)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
