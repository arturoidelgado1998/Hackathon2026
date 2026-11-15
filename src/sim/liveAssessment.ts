// What can still be decided for one shipment at the current clock time. SIMULATED.
//
// The engine's assessment describes the day as planned from each truck's ready
// time. On a live day the truck moves, and a choice that was open at 10:00 may
// be gone at 11:30: the truck has turned off, the road has reopened, or the
// load has been delivered. This module holds the engine's assessment against
// where the truck is now and says which responses are still open, and why not.
//
// Nothing here calculates travel, lateness, cost or CO2. A reroute chosen late
// is timed by the engine's routeTiming from where the truck is, and its figures
// come from the engine's calculateMetrics.

import { calculateMetrics, type MetricsResult } from '../engine/metrics.ts'
import type { EngineResponseOption, ShipmentAssessment } from '../engine/responses.ts'
import { formatTime, parseTime } from '../engine/time.ts'
import type {
  Assumptions,
  Decision,
  Incident,
  RiskLabel,
  RoadSegment,
  Route,
  Shipment,
  TimeHHMM,
} from '../types.ts'
import {
  planTruck,
  sameProgress,
  switchRoute,
  truckStateAt,
  type RouteSwitch,
  type TimingCase,
  type TruckPlan,
  type TruckState,
} from './trucks.ts'

/** Where the truck is in its day. */
export type TruckStage = 'scheduled' | 'held_at_port' | 'on_the_way' | 'queued' | 'delivered'

export interface LiveOption extends EngineResponseOption {
  /** Why this response cannot be chosen right now; null when it can. */
  closed_reason: string | null
}

/** What happened, once the truck has reached the warehouse. */
export interface Delivery {
  at: TimeHHMM
  /** ON_TRACK when it met the appointment, LATE when it did not. */
  risk: RiskLabel
  /** Minutes after the appointment window closed; 0 when it was met. */
  lateness: number
  /** One plain sentence for the card and the response panel. */
  text: string
}

export interface LiveInput {
  shipment: Shipment
  /** The engine's assessment for the active incident (or for the normal day). */
  assessment: ShipmentAssessment
  incident: Incident | null
  routes: readonly Route[]
  segments: readonly RoadSegment[]
  assumptions: Assumptions
  /** The committed decision, if any. Previews are never an input. */
  decision?: Decision
  timingCase: TimingCase
  /** Simulated minutes since midnight; null when there is no clock. */
  now: number | null
}

export interface LiveShipment {
  shipment_id: string
  now: number | null
  /** The trip the truck is making, committed decisions included. */
  plan: TruckPlan
  /** Null when there is no clock. */
  state: TruckState | null
  stage: TruckStage | null
  delivery: Delivery | null
  /**
   * The engine's assessment, with a committed late reroute timed from when it
   * was chosen. Totals are evaluated from this.
   */
  assessment: ShipmentAssessment
  /** Wait, Reroute, Request later slot as they stand now; [] when the engine has none. */
  options: LiveOption[]
  /** True while Wait or Reroute can still be chosen. */
  route_choice_open: boolean
  reopen_needed_by: TimeHHMM | null
  /** The road did not reopen in time for waiting to meet the appointment. */
  reopen_deadline_passed: boolean
  /** From where the truck is now; null when a reroute is not open. */
  reroute_decide_by: TimeHHMM | null
  reroute_deadline_passed: boolean
  no_feasible_response: boolean
}

const clock = (minutes: number | null): string | null => (minutes === null ? null : formatTime(minutes))

function reopenTime(incident: Incident | null): number | null {
  const text = incident ? (incident.assumed_reopen_time ?? incident.reported_reopen_time) : null
  return text === null ? null : parseTime(text)
}

function requireRoute(routes: readonly Route[], id: string): Route {
  const route = routes.find((item) => item.id === id)
  if (!route) throw new RangeError(`Missing route: ${id}`)
  return route
}

/** switchRoute, with "the day is too short" as an answer instead of an error. */
function trySwitch(
  base: TruckPlan,
  assigned: Route,
  route: Route,
  segments: readonly RoadSegment[],
  at: number,
  timingCase: TimingCase,
): RouteSwitch | 'day_too_short' | null {
  try {
    return switchRoute(base, assigned, route, segments, at, timingCase)
  } catch (error) {
    // The engine refuses a trip that would run past midnight.
    if (error instanceof RangeError) return 'day_too_short'
    throw error
  }
}

/**
 * The reroute option timed from where the truck is, not from its ready time.
 * Returns the engine's own option untouched when the two agree.
 */
function timedReroute(
  input: LiveInput,
  option: EngineResponseOption,
  route: Route,
  change: RouteSwitch,
  base: TruckPlan,
): EngineResponseOption {
  const { shipment, assessment, segments, assumptions, incident } = input
  if (
    option.metrics !== null &&
    option.metrics.arrival_min === change.arrival_min &&
    option.metrics.arrival_max === change.arrival_max
  ) {
    return option
  }
  const metrics: MetricsResult = calculateMetrics({
    shipment,
    route,
    segments,
    // Duty runs from the ready time, so time spent held is counted, as it is for Wait.
    timing: { departure: base.departure, arrival_min: change.arrival_min, arrival_max: change.arrival_max },
    assumptions,
    normal_timing: assessment.baseline,
  })
  const from = formatTime(change.from)
  const turnOff = change.kept === 0 ? null : change.plan.legs[change.kept - 1].exit
  const situation =
    turnOff === null
      ? `${shipment.id} has been ready since ${formatTime(base.departure)} and is still at the port, so this reroute is timed from ${from}, not from its ready time.`
      : turnOff < change.from
        ? `${shipment.id} has been standing at the turn-off before ${incident?.segment_id ?? 'the closed segment'} since ${formatTime(turnOff)}, so this reroute is timed from ${from}.`
        : `${shipment.id} left the port at ${formatTime(base.leaves ?? base.departure)}, so this reroute is timed from then; it turns off at ${from}.`
  return {
    ...option,
    metrics,
    added_miles: metrics.miles - assessment.baseline.miles,
    arrival_min: clock(metrics.arrival_min),
    arrival_max: clock(metrics.arrival_max),
    lateness_min: metrics.lateness_min,
    lateness_max: metrics.lateness_max,
    risk: metrics.risk,
    miles: metrics.miles,
    cost: metrics.cost,
    co2_kg: metrics.co2_kg,
    driver_duty_min: metrics.driver_duty_min,
    status: `Estimate: alternative route ${route.id} from ${from}${incident ? `, avoiding ${incident.segment_id}` : ''}`,
    explanation_inputs: [
      situation,
      `Route ${route.id}: ${route.segment_ids.join(' → ')}.`,
      `Estimated arrival ${clock(metrics.arrival_min)}–${clock(metrics.arrival_max)}; service starts ${clock(metrics.service_start_min)}–${clock(metrics.service_start_max)} (not before appointment opening ${shipment.appt_start}).`,
      `Original appointment ${shipment.appt_start}–${shipment.appt_end}: lateness ${metrics.lateness_min}–${metrics.lateness_max} min; risk ${metrics.risk}.`,
      `Estimated cost $${metrics.cost} for ${metrics.miles} mi and ${metrics.driver_duty_min} duty min, counted from the ready time ${formatTime(base.departure)} so time spent held is included. Mileage cost already includes fuel.`,
      `Estimated tailpipe CO2 ${metrics.co2_kg} kg; standing time is engine-off.`,
    ],
    stakeholder_notes: option.stakeholder_notes.map((note) =>
      note.startsWith('Driver: estimated duty')
        ? `Driver: estimated duty ${metrics.driver_duty_min} min; no speeding or hours-of-service adjustments are assumed.`
        : note,
    ),
  }
}

/** An option that can no longer happen: no figures, and the reason in their place. */
function ruledOut(option: EngineResponseOption, reason: string): LiveOption {
  return {
    ...option,
    available: false,
    unavailable_reason: reason,
    metrics: null,
    added_miles: null,
    arrival_min: null,
    arrival_max: null,
    lateness_min: null,
    lateness_max: null,
    risk: 'UNKNOWN',
    miles: null,
    cost: null,
    co2_kg: null,
    driver_duty_min: null,
    status: `No longer possible: ${reason}`,
    explanation_inputs: [reason],
    closed_reason: reason,
  }
}

function stageOf(state: TruckState): TruckStage {
  switch (state.status) {
    case 'arrived':
      return 'delivered'
    case 'waiting':
      return 'queued'
    case 'moving':
      return 'on_the_way'
    case 'at_port':
      return state.held_for !== null ? 'held_at_port' : 'scheduled'
  }
}

function deliveryOf(input: LiveInput, plan: TruckPlan, route: Route): Delivery {
  const { shipment, assessment, segments, assumptions } = input
  const arrival = plan.arrival!
  // The engine's own lateness rule, applied to the one arrival that happened.
  const outcome = calculateMetrics({
    shipment,
    route,
    segments,
    timing: { departure: plan.departure, arrival_min: arrival, arrival_max: arrival },
    assumptions,
    normal_timing: assessment.baseline,
  })
  const at = formatTime(arrival)
  const lateness = outcome.lateness_max ?? 0
  const text =
    lateness > 0
      ? `Delivered at ${at}, ${lateness} min after the appointment window closed at ${shipment.appt_end}.`
      : arrival < parseTime(shipment.appt_start)
        ? `Delivered at ${at}, before the appointment window opened at ${shipment.appt_start}.`
        : `Delivered at ${at}, inside the appointment window.`
  return { at, risk: outcome.risk, lateness, text }
}

/** The trip the truck makes under the committed decision, and the reroute it was given. */
function tripFor(input: LiveInput): {
  assigned: Route
  alternative: Route | null
  base: TruckPlan
  plan: TruckPlan
  committed: RouteSwitch | null
} {
  const { shipment, assessment, incident, routes, segments, assumptions, decision, timingCase } = input
  const assigned = requireRoute(routes, shipment.assigned_route_id)
  const base = planTruck(shipment, assigned, segments, incident, assumptions, timingCase)
  const reroute = assessment.options.find((option) => option.kind === 'reroute')
  const alternative = reroute?.available && reroute.route_id ? requireRoute(routes, reroute.route_id) : null
  const chosen =
    incident !== null && alternative !== null &&
    decision?.status === 'selected' && decision.option_kind === 'reroute'
  if (!chosen) return { assigned, alternative, base, plan: base, committed: null }
  // Without a clock the reroute is the engine's: from the truck's ready time.
  if (decision.sim_time === undefined) {
    const plan = planTruck(shipment, alternative, segments, incident, assumptions, timingCase)
    return { assigned, alternative, base, plan, committed: null }
  }
  const change = trySwitch(base, assigned, alternative, segments, decision.sim_time, timingCase)
  if (change === null || change === 'day_too_short') {
    // The choice could not be carried out; the truck stays on its assigned trip.
    return { assigned, alternative, base, plan: base, committed: null }
  }
  return { assigned, alternative, base, plan: change.plan, committed: change }
}

/** The trip only, for the map and the event log. */
export function liveTrip(input: Omit<LiveInput, 'now'>): TruckPlan {
  return tripFor({ ...input, now: null }).plan
}

/**
 * One shipment as it stands at `now`. With `now` null there is no clock and
 * the result is the planned day: every engine option, none closed.
 */
export function assessLive(input: LiveInput): LiveShipment {
  const { shipment, assessment, incident, segments, timingCase, now } = input
  const { assigned, alternative, base, plan, committed } = tripFor(input)
  const staticOptions = assessment.options
  const staticReroute = staticOptions.find((option) => option.kind === 'reroute')

  // What the totals are evaluated from: a committed late reroute keeps the
  // figures it had when it was chosen.
  const committedReroute =
    committed && staticReroute && alternative
      ? timedReroute(input, staticReroute, alternative, committed, base)
      : staticReroute
  const committedAssessment: ShipmentAssessment =
    committedReroute === staticReroute
      ? assessment
      : { ...assessment, options: staticOptions.map((o) => (o.kind === 'reroute' ? committedReroute! : o)) }

  const result: LiveShipment = {
    shipment_id: shipment.id,
    now,
    plan,
    state: null,
    stage: null,
    delivery: null,
    assessment: committedAssessment,
    options: committedAssessment.options.map((option) => ({
      ...option,
      closed_reason: option.available ? null : (option.unavailable_reason ?? 'Unavailable.'),
    })),
    route_choice_open: false,
    reopen_needed_by: assessment.reopen_needed_by,
    reopen_deadline_passed: false,
    reroute_decide_by: assessment.reroute_decide_by,
    reroute_deadline_passed: false,
    no_feasible_response: assessment.no_feasible_response,
  }
  const open = () =>
    result.options.some((option) => option.kind !== 'request_slot' && option.closed_reason === null)
  if (now === null) {
    result.route_choice_open = open()
    return result
  }

  const state = truckStateAt(plan, now, segments)
  result.state = state
  result.stage = stageOf(state)

  if (state.status === 'arrived') {
    const route = plan.rerouted && alternative ? alternative : assigned
    result.delivery = deliveryOf(input, plan, route)
    const reason = `${shipment.id} was delivered at ${result.delivery.at}.`
    result.options = result.options.map((option) => ({ ...option, closed_reason: reason }))
    result.reroute_decide_by = null
    result.no_feasible_response = false
    return result
  }
  if (staticOptions.length === 0 || incident === null) return result

  const segmentId = incident.segment_id
  const reopen = reopenTime(incident)
  const reopened = reopen !== null && now >= reopen
  // Has the truck done something its assigned trip would not have done by now?
  const actedOnReroute = plan.rerouted && !sameProgress(plan, base, now)
  const end = parseTime(shipment.appt_end)

  result.options = committedAssessment.options.map((option): LiveOption => {
    if (!option.available) {
      return { ...option, closed_reason: option.unavailable_reason ?? 'Unavailable.' }
    }
    if (option.kind === 'request_slot') return { ...option, closed_reason: null }

    if (option.kind === 'wait') {
      if (plan.rerouted) {
        return actedOnReroute
          ? ruledOut(option, `${shipment.id} is already on route ${plan.route_id} and cannot go back to wait for ${segmentId}.`)
          : { ...option, closed_reason: null }
      }
      if (reopened) {
        return {
          ...option,
          status: `Under way on the assigned route; ${segmentId} reopened at ${formatTime(reopen)}`,
          closed_reason: `${segmentId} reopened at ${formatTime(reopen)}, so there is nothing left to wait for. ${shipment.id} is continuing on its assigned route.`,
        }
      }
      return { ...option, closed_reason: null }
    }

    // Reroute.
    if (plan.rerouted) {
      return {
        ...option,
        closed_reason: actedOnReroute ? `${shipment.id} is already on route ${plan.route_id}.` : null,
      }
    }
    if (reopened) {
      return ruledOut(option, `${segmentId} reopened at ${formatTime(reopen)}, so there is no closure left to avoid.`)
    }
    if (!alternative) return ruledOut(option, 'No alternative route.')
    const change = trySwitch(base, assigned, alternative, segments, now, timingCase)
    if (change === 'day_too_short') {
      return ruledOut(option, `There is not enough of the day left to drive route ${alternative.id}.`)
    }
    if (change === null) {
      const left = formatTime(base.leaves ?? base.departure)
      const sharesStart = alternative.segment_ids[0] === assigned.segment_ids[0]
      return ruledOut(
        option,
        sharesStart
          ? `${shipment.id} has passed the turn-off for route ${alternative.id}.`
          : `${shipment.id} left the port at ${left} on its assigned route, and route ${alternative.id} leaves the port by a different road.`,
      )
    }
    // Standing still, the truck must start in time to drive the rest of the
    // route by the end of the appointment. Moving, it must be told before the turn-off.
    const moving = state.status === 'moving'
    const latestStart = end - (change.arrival_max - change.from)
    const decideBy = moving ? change.from : latestStart
    result.reroute_decide_by = decideBy >= 0 ? formatTime(decideBy) : null
    result.reroute_deadline_passed = !moving && now > latestStart
    return { ...timedReroute(input, option, alternative, change, base), closed_reason: null }
  })

  if (!result.options.some((o) => o.kind === 'reroute' && o.closed_reason === null) || plan.rerouted) {
    result.reroute_decide_by = null
    result.reroute_deadline_passed = false
  }
  const waiting = !plan.rerouted && !reopened
  result.reopen_needed_by = waiting ? assessment.reopen_needed_by : null
  result.reopen_deadline_passed =
    waiting && assessment.reopen_needed_by !== null && now > parseTime(assessment.reopen_needed_by)
  result.route_choice_open = open()
  result.no_feasible_response = result.options
    .filter((option) => option.kind !== 'request_slot' && option.available)
    .every((option) => option.risk === 'LATE')
  return result
}

/**
 * Whether replacing the committed decision with `other` (or with none) would
 * move the truck from where it is now. A choice the truck has already acted
 * on cannot be taken back; neither can anything about a delivered load.
 * Returns the reason, or null when the swap is harmless.
 */
export function swapBlockedReason(input: LiveInput, other: Decision | undefined): string | null {
  if (input.now === null) return null
  const current = assessLive(input)
  if (current.delivery) return `${input.shipment.id} was delivered at ${current.delivery.at}; the choice can no longer be changed.`
  const swapped = assessLive({ ...input, decision: other })
  if (!sameProgress(current.plan, swapped.plan, input.now)) {
    return `${input.shipment.id} has already acted on this choice: it is on route ${current.plan.route_id}. It can no longer be undone.`
  }
  return null
}
