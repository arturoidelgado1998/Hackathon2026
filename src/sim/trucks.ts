// Where each truck is at a given clock time. SIMULATED.
//
// Nothing here calculates travel: every time comes from the engine's
// routeTiming, so a truck reaches its warehouse at exactly the arrival the
// board shows. This module only turns those times into a place on a line.

import { formatTime, parseTime } from '../engine/time.ts'
import { departure, routeTiming } from '../engine/timing.ts'
import type {
  Assumptions,
  Incident,
  LonLat,
  RoadSegment,
  Route,
  Shipment,
} from '../types.ts'

/** Which end of the engine's travel-time range the truck is drawn at. */
export type TimingCase = 'slow' | 'fast'

export type TruckStatus = 'at_port' | 'moving' | 'waiting' | 'arrived'

/** One segment of a truck's trip, in minutes since midnight. */
export interface TruckLeg {
  segment_id: string
  /** Reaches the start of the segment. */
  arrive: number
  /** Enters the segment, after any wait at a closure. Null: reopening unknown. */
  enter: number | null
  /** Leaves the segment. Null: reopening unknown. */
  exit: number | null
}

export interface TruckPlan {
  shipment_id: string
  route_id: string
  /** True when the truck takes a route other than its assigned one. */
  rerouted: boolean
  /** Ready to leave: cargo and truck ready, pickup handled. */
  departure: number
  /**
   * When the truck actually leaves the port. Later than `departure` when it is
   * held there for a closure; null when it is held and the reopening is unknown.
   */
  leaves: number | null
  /** The closed segment the truck is held at the port for, or null. */
  held_for: string | null
  /** Where the trip starts, so a held truck can still be placed at the port. */
  first_segment_id: string
  /** Arrival at the warehouse. Null: reopening unknown. */
  arrival: number | null
  legs: TruckLeg[]
}

export interface TruckState {
  shipment_id: string
  route_id: string
  rerouted: boolean
  status: TruckStatus
  /** The segment the truck is on or waiting to enter; null at the port or warehouse. */
  segment_id: string | null
  /** 0 at the start of the segment, 1 at its end. */
  fraction: number
  /** When a waiting truck can move again. Null: not waiting, or reopening unknown. */
  wait_until: number | null
  /** Held at the port for this closed segment, instead of being sent to queue at it. */
  held_for: string | null
  /** Null when the segment has no drawn line. */
  position: LonLat | null
}

/**
 * The timed trip for one shipment on one route. Pass the incident for the
 * disrupted scenario and null for the normal one.
 */
export function planTruck(
  shipment: Shipment,
  route: Route,
  segments: readonly RoadSegment[],
  incident: Incident | null,
  assumptions: Pick<Assumptions, 'pickup_handling_min'>,
  timingCase: TimingCase = 'slow',
): TruckPlan {
  const start = departure(shipment, assumptions)
  const timing = routeTiming(route, segments, start, incident)
  const slow = timingCase === 'slow'
  const legs: TruckLeg[] = []
  for (const segment of timing.segments) {
    const arrive = slow ? segment.arrival_max : segment.arrival_min
    // Past an unknown reopening the engine has no times; the trip stops there.
    if (arrive === null) break
    legs.push({
      segment_id: segment.segment_id,
      arrive,
      enter: slow ? segment.entry_max : segment.entry_min,
      exit: slow ? segment.exit_max : segment.exit_min,
    })
  }

  // A dispatcher does not send a truck to queue at a road already known to be
  // closed. If the closure has started by the time the truck is ready, it is
  // held at the port and leaves in time to reach the segment as it reopens.
  // The engine's arrival is unchanged: the wait simply happens at the port.
  let leaves: number | null = start
  let heldFor: string | null = null
  const blocked = legs.findIndex((leg) => leg.enter === null || leg.enter > leg.arrive)
  if (incident !== null && blocked >= 0 && start >= parseTime(incident.start_time)) {
    const leg = legs[blocked]
    heldFor = leg.segment_id
    if (leg.enter === null) {
      leaves = null
      legs.length = 0
    } else {
      const wait = leg.enter - leg.arrive
      leaves = start + wait
      for (const earlier of legs.slice(0, blocked)) {
        earlier.arrive += wait
        if (earlier.enter !== null) earlier.enter += wait
        if (earlier.exit !== null) earlier.exit += wait
      }
      leg.arrive = leg.enter
    }
  }

  return {
    shipment_id: shipment.id,
    route_id: route.id,
    rerouted: route.id !== shipment.assigned_route_id,
    departure: start,
    leaves,
    held_for: heldFor,
    first_segment_id: route.segment_ids[0],
    arrival: slow ? timing.arrival_max : timing.arrival_min,
    legs,
  }
}

/** Distance between two lon/lat points in km (flat-earth, fine at city scale). */
function km(a: LonLat, b: LonLat): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180)
  const dx = (b[0] - a[0]) * 111.32 * Math.cos(lat)
  const dy = (b[1] - a[1]) * 110.57
  return Math.hypot(dx, dy)
}

/** The point a given share of the way along a line, measured by length. */
export function pointAlong(coordinates: readonly LonLat[], fraction: number): LonLat | null {
  if (coordinates.length === 0) return null
  const share = Math.min(1, Math.max(0, fraction))
  if (coordinates.length === 1 || share === 0) return [...coordinates[0]] as LonLat
  const lengths = coordinates.slice(1).map((point, i) => km(coordinates[i], point))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  if (total === 0 || share === 1) return [...coordinates[coordinates.length - 1]] as LonLat
  let remaining = share * total
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const part = lengths[i] === 0 ? 0 : remaining / lengths[i]
      const [ax, ay] = coordinates[i]
      const [bx, by] = coordinates[i + 1]
      return [ax + (bx - ax) * part, ay + (by - ay) * part]
    }
    remaining -= lengths[i]
  }
  return [...coordinates[coordinates.length - 1]] as LonLat
}

/** Where the truck is at `time` (minutes since midnight; may be fractional). */
export function truckStateAt(
  plan: TruckPlan,
  time: number,
  segments: readonly RoadSegment[],
): TruckState {
  const line = (segmentId: string) =>
    segments.find((s) => s.id === segmentId)?.geometry?.coordinates ?? []
  const base = {
    shipment_id: plan.shipment_id,
    route_id: plan.route_id,
    rerouted: plan.rerouted,
    held_for: null as string | null,
  }
  const first = plan.legs[0]
  const last = plan.legs[plan.legs.length - 1]

  if (!first || plan.leaves === null || time < plan.leaves) {
    const held = time >= plan.departure
    return {
      ...base,
      status: 'at_port',
      segment_id: null,
      fraction: 0,
      wait_until: held ? plan.leaves : null,
      held_for: held ? plan.held_for : null,
      position: pointAlong(line(plan.first_segment_id), 0),
    }
  }

  for (const leg of plan.legs) {
    const coordinates = line(leg.segment_id)
    // Held at the start of the segment: closed, or reopening unknown.
    if (leg.enter === null || time < leg.enter) {
      return {
        ...base,
        status: 'waiting',
        segment_id: leg.segment_id,
        fraction: 0,
        wait_until: leg.enter,
        position: pointAlong(coordinates, 0),
      }
    }
    if (leg.exit === null || time < leg.exit) {
      const span = leg.exit === null ? 0 : leg.exit - leg.enter
      const fraction = span === 0 ? 0 : (time - leg.enter) / span
      return {
        ...base,
        status: 'moving',
        segment_id: leg.segment_id,
        fraction,
        wait_until: null,
        position: pointAlong(coordinates, fraction),
      }
    }
  }

  return {
    ...base,
    status: 'arrived',
    segment_id: null,
    fraction: 1,
    wait_until: null,
    position: pointAlong(line(last.segment_id), 1),
  }
}

export interface TruckCounts {
  at_port: number
  moving: number
  waiting: number
  arrived: number
}

export function countTrucks(states: readonly TruckState[]): TruckCounts {
  const counts: TruckCounts = { at_port: 0, moving: 0, waiting: 0, arrived: 0 }
  for (const state of states) counts[state.status] += 1
  return counts
}

/**
 * The clock range worth showing: from a little before the first departure to a
 * little after the last known arrival, on quarter hours.
 */
export function simWindow(plans: readonly TruckPlan[], marginMin = 15): { start: number; end: number } {
  if (plans.length === 0) return { start: 8 * 60, end: 14 * 60 }
  const first = Math.min(...plans.map((p) => p.departure))
  const last = Math.max(
    ...plans.map((p) => p.arrival ?? p.legs[p.legs.length - 1]?.arrive ?? p.departure),
  )
  return {
    start: Math.max(0, Math.floor((first - marginMin) / 15) * 15),
    end: Math.min(24 * 60 - 1, Math.ceil((last + marginMin) / 15) * 15),
  }
}

/** One plain sentence for where a truck is, matching its marker on the map. */
export function describeTruck(
  plan: TruckPlan,
  state: TruckState,
  segmentName: (segmentId: string) => string,
): string {
  const route = state.rerouted ? ` (rerouted, ${state.route_id})` : ''
  switch (state.status) {
    case 'at_port':
      if (state.held_for !== null) {
        return state.wait_until === null
          ? `Held at the port: ${state.held_for} is closed, reopening unknown`
          : `Held at the port until ${formatTime(state.wait_until)}: ${state.held_for} is closed`
      }
      return `At the port, leaves ${formatTime(plan.leaves ?? plan.departure)}${route}`
    case 'waiting':
      return state.wait_until === null
        ? `Waiting at ${segmentName(state.segment_id!)}, reopening unknown`
        : `Waiting at ${segmentName(state.segment_id!)} until ${formatTime(state.wait_until)}`
    case 'moving':
      return `On ${segmentName(state.segment_id!)}, ${Math.round(state.fraction * 100)}% along${route}`
    case 'arrived':
      return `Arrived ${plan.arrival === null ? '' : formatTime(plan.arrival)}${route}`.trim()
  }
}
