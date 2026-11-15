// The simulation page's settings, and how they travel in a link.
// A teammate who opens the link gets the same setup and presses Start.

import type { Incident, TimeHHMM } from '../types.ts'
import type { TimingCase } from './trucks.ts'
import { SIM_SPEEDS, type SimSpeed } from './useSimClock.ts'

/** What trucks affected by the closure do. Applied to all of them alike; not a recommendation. */
export type SimResponse = 'wait' | 'reroute'

export interface SimSettings {
  /** False runs the normal day with no closure. */
  closure: boolean
  segmentId: string
  start: TimeHHMM
  reopen: TimeHHMM
  response: SimResponse
  timingCase: TimingCase
  speed: SimSpeed
}

/** The dashboard's sample incident: NB-03 closed 10:00, reported reopening 11:10. */
export const DEFAULT_SETTINGS: SimSettings = {
  closure: true,
  segmentId: 'NB-03',
  start: '10:00',
  reopen: '11:10',
  response: 'wait',
  timingCase: 'slow',
  speed: 5,
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** Read settings from a query string. Anything missing or invalid keeps its default. */
export function parseSettings(search: string, segmentIds: readonly string[]): SimSettings {
  const query = new URLSearchParams(search)
  const settings = { ...DEFAULT_SETTINGS }
  if (!segmentIds.includes(settings.segmentId) && segmentIds.length > 0) settings.segmentId = segmentIds[0]

  const closure = query.get('closure')
  if (closure === '0' || closure === '1') settings.closure = closure === '1'
  const segment = query.get('segment')
  if (segment !== null && segmentIds.includes(segment)) settings.segmentId = segment
  const start = query.get('start')
  if (start !== null && TIME.test(start)) settings.start = start
  const reopen = query.get('reopen')
  if (reopen !== null && TIME.test(reopen)) settings.reopen = reopen
  const response = query.get('response')
  if (response === 'wait' || response === 'reroute') settings.response = response
  const timingCase = query.get('case')
  if (timingCase === 'slow' || timingCase === 'fast') settings.timingCase = timingCase
  const speed = Number(query.get('speed'))
  if ((SIM_SPEEDS as readonly number[]).includes(speed)) settings.speed = speed as SimSpeed
  return settings
}

/** The query string for a link to this setup (no leading "?"). */
export function serializeSettings(settings: SimSettings): string {
  return new URLSearchParams({
    closure: settings.closure ? '1' : '0',
    segment: settings.segmentId,
    start: settings.start,
    reopen: settings.reopen,
    response: settings.response,
    case: settings.timingCase,
    speed: String(settings.speed),
  }).toString()
}

/** A plain-language problem with the settings, or null when they can run. */
export function settingsError(settings: SimSettings): string | null {
  if (!settings.closure) return null
  if (!TIME.test(settings.start) || !TIME.test(settings.reopen)) {
    return 'Enter the closure start and reopening as times of day.'
  }
  if (settings.reopen < settings.start) return 'The reopening time must not be before the closure starts.'
  return null
}

/** The closure the engine is given, or null for the normal day. */
export function incidentOf(settings: SimSettings): Incident | null {
  if (!settings.closure) return null
  return {
    segment_id: settings.segmentId,
    type: 'closure',
    start_time: settings.start,
    reported_reopen_time: settings.reopen,
    assumed_reopen_time: null,
    evidence_text: `SIMULATED: ${settings.segmentId} closed from ${settings.start}, reopening ${settings.reopen} (set on the simulation page).`,
    confirmed_by_user: true,
  }
}
