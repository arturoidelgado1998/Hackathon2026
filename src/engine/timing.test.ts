import { describe, expect, it } from 'vitest'
import {
  assumptions,
  getRoute,
  getShipment,
  getShipmentSummary,
  sampleIncident,
  segments,
  shipments,
} from '../data'
import type { Incident, RoadSegment } from '../types'
import { formatTime, parseTime } from './time'
import { departure, routeTiming } from './timing'

const reference = getShipment('S-01')!
const referenceRoute = getRoute(reference.assigned_route_id)!
const unknownIncident: Incident = {
  ...sampleIncident,
  reported_reopen_time: null,
  assumed_reopen_time: null,
}

function withApproach(min: number, max: number): RoadSegment[] {
  return segments.map((segment) => segment.id === 'PORT-01'
    ? { ...segment, minutes_min: min, minutes_max: max }
    : segment)
}

describe('departure and normal route timing', () => {
  it('matches S-01 and all typed-fixture normal baselines', () => {
    expect(departure(reference, assumptions)).toBe(parseTime('10:00'))
    for (const shipment of shipments) {
      const start = departure(shipment, assumptions)
      const timing = routeTiming(getRoute(shipment.assigned_route_id)!, segments, start, null)
      const baseline = getShipmentSummary(shipment.id, 'normal')
      expect(timing.status).toBe('KNOWN')
      expect(formatTime(timing.arrival_min!)).toBe(baseline.arrival_min)
      expect(formatTime(timing.arrival_max!)).toBe(baseline.arrival_max)
    }
    const timing = routeTiming(referenceRoute, segments, 600, null)
    expect(timing).toMatchObject({ arrival_min: 660, arrival_max: 674, closure: null })
    expect(timing.segments.map((segment) => [segment.segment_id, segment.arrival_min, segment.arrival_max]))
      .toEqual([['PORT-01', 600, 600], ['NB-03', 610, 612], ['WH-A-APPR', 640, 650]])
  })

  it('moves departure and arrival with pickup handling, cargo and truck availability', () => {
    const laterPickup = { ...assumptions, pickup_handling_min: 45 }
    const start = departure(reference, laterPickup)
    expect(start).toBe(615)
    expect(routeTiming(referenceRoute, segments, start, null))
      .toMatchObject({ arrival_min: 675, arrival_max: 689 })
    expect(departure({ cargo_ready: '10:00', truck_available: '09:00' }, assumptions)).toBe(630)
    expect(departure({ cargo_ready: '09:00', truck_available: '10:00' }, assumptions)).toBe(630)
  })

  it('follows route order without mutating input data and is deterministic', () => {
    const before = JSON.stringify({ referenceRoute, segments, sampleIncident })
    const first = routeTiming(referenceRoute, [...segments].reverse(), 600, sampleIncident)
    expect(routeTiming(referenceRoute, segments, 600, sampleIncident)).toEqual(first)
    expect(JSON.stringify({ referenceRoute, segments, sampleIncident })).toBe(before)
  })
})

describe('closure timing', () => {
  it('matches the typed disrupted fixture arrivals for every shipment', () => {
    for (const shipment of shipments) {
      const timing = routeTiming(
        getRoute(shipment.assigned_route_id)!,
        segments,
        departure(shipment, assumptions),
        sampleIncident,
      )
      const summary = getShipmentSummary(shipment.id, 'disrupted')
      expect(formatTime(timing.arrival_min!)).toBe(summary.arrival_min)
      expect(formatTime(timing.arrival_max!)).toBe(summary.arrival_max)
      expect(timing.closure?.affected ?? false).toBe(summary.affected)
    }
  })

  it('waits only the remaining 58–60 minutes for S-01, then arrives at 12:00–12:12', () => {
    const timing = routeTiming(referenceRoute, segments, 600, sampleIncident)
    expect(timing).toMatchObject({ status: 'KNOWN', arrival_min: 720, arrival_max: 732 })
    expect(timing.closure).toMatchObject({ reopen: 670, source: 'reported', estimated: true, affected: true })
    expect(timing.segments[1]).toMatchObject({
      arrival_min: 610,
      arrival_max: 612,
      entry_min: 670,
      entry_max: 670,
      wait_min: 58,
      wait_max: 60,
      closure_affected: true,
    })
  })

  it('leaves trucks reaching the segment after reopening unaffected', () => {
    const shipment = getShipment('S-06')!
    const start = departure(shipment, assumptions)
    const normal = routeTiming(referenceRoute, segments, start, null)
    const timing = routeTiming(referenceRoute, segments, start, sampleIncident)
    expect(timing.arrival_min).toBe(normal.arrival_min)
    expect(timing.arrival_max).toBe(normal.arrival_max)
    expect(timing.segments).toEqual(normal.segments)
    expect(timing.closure?.affected).toBe(false)
  })

  it('leaves routes without the incident segment unchanged, even for an unknown reopening', () => {
    const route = getRoute('R-C-ORIG')!
    const normal = routeTiming(route, segments, 600, null)
    expect(routeTiming(route, segments, 600, sampleIncident)).toEqual(normal)
    expect(routeTiming(route, segments, 600, unknownIncident)).toEqual(normal)
  })

  it('propagates unknown reopening downstream without erasing known upstream timing', () => {
    const timing = routeTiming(referenceRoute, segments, 600, unknownIncident)
    expect(timing).toMatchObject({ status: 'UNKNOWN', arrival_min: null, arrival_max: null })
    expect(timing.closure).toMatchObject({ source: 'unknown', reopen: null, estimated: false, affected: true })
    expect(timing.segments[0]).toMatchObject({ exit_min: 610, exit_max: 612 })
    expect(timing.segments[1]).toMatchObject({
      arrival_min: 610,
      arrival_max: 612,
      entry_min: null,
      entry_max: null,
      wait_min: null,
      wait_max: null,
    })
    expect(timing.segments[2]).toMatchObject({ arrival_min: null, arrival_max: null })
  })

  it('uses and identifies dispatcher assumptions ahead of conflicting reported estimates', () => {
    const timing = routeTiming(referenceRoute, segments, 600, {
      ...sampleIncident,
      assumed_reopen_time: '10:30',
    })
    expect(timing).toMatchObject({ status: 'KNOWN', arrival_min: 680, arrival_max: 692 })
    expect(timing.closure).toMatchObject({ source: 'assumed', reopen: 630, estimated: true })
    expect(routeTiming(referenceRoute, segments, 600, { ...unknownIncident, assumed_reopen_time: '10:30' }))
      .toEqual(timing)
  })

  it('does not delay a truck that enters before closure, even if it is still traversing at closure start', () => {
    const timing = routeTiming(referenceRoute, withApproach(9, 9), 590, unknownIncident)
    expect(timing).toMatchObject({ status: 'KNOWN', arrival_min: 649, arrival_max: 661 })
    expect(timing.closure?.affected).toBe(false)
    expect(timing.segments[1]).toMatchObject({ arrival_min: 599, exit_min: 629, wait_min: 0, wait_max: 0 })
  })

  it('includes the closure start but excludes the reopening instant', () => {
    const atStart = routeTiming(referenceRoute, withApproach(0, 0), 600, sampleIncident)
    expect(atStart.segments[1]).toMatchObject({ arrival_min: 600, wait_min: 70, wait_max: 70 })
    const atReopening = routeTiming(referenceRoute, withApproach(0, 0), 670, sampleIncident)
    expect(atReopening.segments[1]).toMatchObject({ wait_min: 0, wait_max: 0, closure_affected: false })
    expect(atReopening.closure?.affected).toBe(false)
  })

  it('captures the longest wait inside an interval straddling closure start', () => {
    const timing = routeTiming(referenceRoute, withApproach(9, 12), 590, sampleIncident)
    expect(timing.segments[1]).toMatchObject({
      arrival_min: 599,
      arrival_max: 602,
      entry_min: 599,
      entry_max: 670,
      wait_min: 0,
      wait_max: 70,
    })
    expect(timing).toMatchObject({ arrival_min: 649, arrival_max: 732 })
  })

  it('keeps an unaffected earliest path when only later arrivals encounter an unknown reopening', () => {
    const timing = routeTiming(referenceRoute, withApproach(9, 12), 590, unknownIncident)
    expect(timing).toMatchObject({ status: 'UNKNOWN', arrival_min: 649, arrival_max: null })
    expect(timing.segments[1]).toMatchObject({ entry_min: 599, entry_max: null, wait_min: 0, wait_max: null })
  })

  it('handles arrival ranges crossing reopening and zero-length closures', () => {
    const timing = routeTiming(referenceRoute, withApproach(9, 12), 660, sampleIncident)
    expect(timing.segments[1]).toMatchObject({
      arrival_min: 669,
      arrival_max: 672,
      entry_min: 670,
      entry_max: 672,
      wait_min: 0,
      wait_max: 1,
    })
    const emptyClosure = { ...sampleIncident, reported_reopen_time: sampleIncident.start_time }
    expect(routeTiming(referenceRoute, segments, 600, emptyClosure).segments)
      .toEqual(routeTiming(referenceRoute, segments, 600, null).segments)
  })
})

describe('explicit input validation', () => {
  it('rejects missing shipment times and pickup handling', () => {
    expect(() => departure({ ...reference, cargo_ready: undefined as unknown as string }, assumptions))
      .toThrow(/cargo_ready/)
    expect(() => departure(reference, { pickup_handling_min: undefined as unknown as number }))
      .toThrow(/pickup_handling_min/)
  })

  it.each([-1, 0.5, NaN, Infinity])('rejects invalid pickup handling %s', (minutes) => {
    expect(() => departure(reference, { pickup_handling_min: minutes })).toThrow(/pickup_handling_min/)
  })

  it('rejects missing, duplicate and unordered-duration segment inputs', () => {
    expect(() => routeTiming(referenceRoute, segments.filter((s) => s.id !== 'NB-03'), 600, unknownIncident))
      .toThrow(/Missing route segment: NB-03/)
    expect(() => routeTiming(referenceRoute, [...segments, segments[0]], 600, null))
      .toThrow(/Duplicate segment id/)
    expect(() => routeTiming(referenceRoute, withApproach(12, 10), 600, null))
      .toThrow(/minutes_min must not exceed/)
    expect(() => routeTiming({ segment_ids: [] }, segments, 600, null)).toThrow(/segment_ids/)
  })

  it.each([undefined, null, -1, 0.5, NaN, Infinity])('rejects invalid segment duration %s', (minutes) => {
    const invalid = withApproach(minutes as number, 12)
    expect(() => routeTiming(referenceRoute, invalid, 600, null)).toThrow(/PORT-01.minutes_min/)
  })

  it('rejects missing incident times and reopening before closure start', () => {
    expect(() => routeTiming(referenceRoute, segments, 600, {
      ...sampleIncident,
      start_time: undefined as unknown as string,
    })).toThrow(/incident.start_time/)
    expect(() => routeTiming(referenceRoute, segments, 600, {
      ...sampleIncident,
      reported_reopen_time: undefined as unknown as string,
    })).toThrow(/incident.reported_reopen_time/)
    expect(() => routeTiming(referenceRoute, segments, 600, {
      ...sampleIncident,
      assumed_reopen_time: '09:59',
    })).toThrow(/must not precede/)
  })

  it('rejects out-of-day departure and computed midnight rollover', () => {
    expect(() => routeTiming(referenceRoute, segments, 1440, null)).toThrow(/departure/)
    expect(() => departure({ cargo_ready: '23:50', truck_available: '23:00' }, assumptions))
      .toThrow(/departure/)
    expect(() => routeTiming(referenceRoute, segments, parseTime('23:30'), null))
      .toThrow(/demo day/)
  })
})
