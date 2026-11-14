import type { Assumptions, Incident, RoadSegment, Route, Shipment } from '../types.ts'
import { assertDayMinute, parseTime } from './time.ts'

export type TimingStatus = 'KNOWN' | 'UNKNOWN'
export type ReopeningSource = 'reported' | 'assumed' | 'unknown'

/**
 * All clock values are whole minutes since midnight, not HH:MM strings.
 * A null endpoint means that extremum cannot be determined, not zero or infinity.
 * In particular, an unknown reopening preserves a known earliest arrival only
 * when that earliest path enters the segment before the closure starts.
 */
export interface SegmentTiming {
  segment_id: string
  /** Arrival at the segment start, before any closure wait. */
  arrival_min: number | null
  arrival_max: number | null
  /** Entry into the segment, after any closure wait. */
  entry_min: number | null
  entry_max: number | null
  exit_min: number | null
  exit_max: number | null
  /** Wait extrema over the arrival interval; not paired with arrival extrema. */
  wait_min: number | null
  wait_max: number | null
  /** True when at least one possible arrival encounters the closure. */
  closure_affected: boolean
}

export interface ClosureTiming {
  segment_id: string
  start: number
  reopen: number | null
  /** A dispatcher's explicit assumption overrides the reported reopening. */
  source: ReopeningSource
  /** Both reported and assumed reopening times are estimates, not guarantees. */
  estimated: boolean
  affected: boolean
}

export interface RouteTimingResult {
  /** UNKNOWN iff at least one destination-arrival endpoint is null. */
  status: TimingStatus
  departure: number
  arrival_min: number | null
  arrival_max: number | null
  /** Ordered like route.segment_ids, regardless of the segments input order. */
  segments: SegmentTiming[]
  /** Null when no incident is supplied or its segment is not in this route. */
  closure: ClosureTiming | null
}

function assertDuration(minutes: number, field: string): void {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new RangeError(`${field} must be a nonnegative whole number of minutes`)
  }
}

function addMinutes(time: number | null, duration: number, field: string): number | null {
  if (time === null) return null
  const result = time + duration
  assertDayMinute(result, field)
  return result
}

/** max(cargo_ready, truck_available) + pickup handling, in demo-day minutes. */
export function departure(
  shipment: Pick<Shipment, 'cargo_ready' | 'truck_available'>,
  assumptions: Pick<Assumptions, 'pickup_handling_min'>,
): number {
  const ready = parseTime(shipment.cargo_ready, 'cargo_ready')
  const available = parseTime(shipment.truck_available, 'truck_available')
  assertDuration(assumptions.pickup_handling_min, 'pickup_handling_min')
  const result = Math.max(ready, available) + assumptions.pickup_handling_min
  assertDayMinute(result, 'departure')
  return result
}

function closureTiming(incident: Incident): ClosureTiming {
  if (incident.type !== 'closure') throw new RangeError('incident.type must be closure')
  if (typeof incident.segment_id !== 'string' || incident.segment_id.length === 0) {
    throw new RangeError('incident.segment_id must be a nonempty segment id')
  }
  const start = parseTime(incident.start_time, 'incident.start_time')
  const reported = incident.reported_reopen_time === null
    ? null
    : parseTime(incident.reported_reopen_time, 'incident.reported_reopen_time')
  const assumed = incident.assumed_reopen_time === null
    ? null
    : parseTime(incident.assumed_reopen_time, 'incident.assumed_reopen_time')
  for (const [field, time] of [['reported_reopen_time', reported], ['assumed_reopen_time', assumed]] as const) {
    if (time !== null && time < start) {
      throw new RangeError(`incident.${field} must not precede incident.start_time on the demo day`)
    }
  }
  return {
    segment_id: incident.segment_id,
    start,
    reopen: assumed ?? reported,
    source: assumed !== null ? 'assumed' : reported !== null ? 'reported' : 'unknown',
    estimated: assumed !== null || reported !== null,
    affected: false,
  }
}

function applyClosure(timing: SegmentTiming, closure: ClosureTiming): void {
  const { arrival_min: min, arrival_max: max } = timing
  const { start, reopen } = closure
  if (max !== null && max < start) return
  if (reopen !== null && (reopen === start || (min !== null && min >= reopen))) return

  timing.closure_affected = true
  closure.affected = true
  if (reopen === null) {
    timing.entry_min = min !== null && min < start ? min : null
    timing.entry_max = null
    timing.wait_min = timing.entry_min !== null ? 0 : null
    timing.wait_max = null
    return
  }

  const wait = (time: number) => time >= start && time < reopen ? reopen - time : 0
  timing.entry_min = min === null ? null : min + wait(min)
  timing.entry_max = max === null ? null : max + wait(max)
  timing.wait_min = min === null || max === null ? null : Math.min(wait(min), wait(max))
  // The longest wait is at the closure start when the arrival interval crosses it.
  timing.wait_max = min === null || max === null
    ? null
    : min <= start && max >= start ? reopen - start : Math.max(wait(min), wait(max))
}

/**
 * Walk segment travel ranges and the half-open closure interval [start, reopen).
 * A truck already inside the segment when it closes is not delayed.
 * Inputs and calculated known times must stay within the single demo day;
 * missing/invalid times, segments, durations and midnight rollover throw.
 * No input is mutated, and only timing-related fields are read.
 */
export function routeTiming(
  route: Pick<Route, 'segment_ids'>,
  segments: readonly RoadSegment[],
  departureTime: number,
  incident: Incident | null,
): RouteTimingResult {
  assertDayMinute(departureTime, 'departure')
  if (!Array.isArray(route.segment_ids) || route.segment_ids.length === 0) {
    throw new RangeError('route.segment_ids must contain at least one segment id')
  }
  if (!Array.isArray(segments)) throw new TypeError('segments must be an array')
  const byId = new Map<string, RoadSegment>()
  for (const segment of segments) {
    if (byId.has(segment.id)) throw new RangeError(`Duplicate segment id: ${segment.id}`)
    byId.set(segment.id, segment)
  }
  const ordered = route.segment_ids.map((id) => {
    const segment = byId.get(id)
    if (!segment) throw new RangeError(`Missing route segment: ${id}`)
    assertDuration(segment.minutes_min, `${id}.minutes_min`)
    assertDuration(segment.minutes_max, `${id}.minutes_max`)
    if (segment.minutes_min > segment.minutes_max) {
      throw new RangeError(`${id}.minutes_min must not exceed minutes_max`)
    }
    return segment
  })
  const parsedClosure = incident === null ? null : closureTiming(incident)
  const closure = parsedClosure !== null && route.segment_ids.includes(parsedClosure.segment_id)
    ? parsedClosure
    : null

  let min: number | null = departureTime
  let max: number | null = departureTime
  const timings: SegmentTiming[] = []
  for (const segment of ordered) {
    const timing: SegmentTiming = {
      segment_id: segment.id,
      arrival_min: min,
      arrival_max: max,
      entry_min: min,
      entry_max: max,
      exit_min: null,
      exit_max: null,
      wait_min: 0,
      wait_max: 0,
      closure_affected: false,
    }
    if (closure?.segment_id === segment.id) applyClosure(timing, closure)
    min = addMinutes(timing.entry_min, segment.minutes_min, `${segment.id} exit_min`)
    max = addMinutes(timing.entry_max, segment.minutes_max, `${segment.id} exit_max`)
    timing.exit_min = min
    timing.exit_max = max
    timings.push(timing)
  }
  return {
    status: min === null || max === null ? 'UNKNOWN' : 'KNOWN',
    departure: departureTime,
    arrival_min: min,
    arrival_max: max,
    segments: timings,
    closure,
  }
}
