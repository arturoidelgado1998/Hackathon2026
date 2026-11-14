import type {
  Assumptions, Incident, ResponseOption, RoadSegment, Route, Shipment,
} from '../types.ts'
import { calculateMetrics } from './metrics.ts'
import type { MetricsResult } from './metrics.ts'
import { formatTime, parseTime } from './time.ts'
import { departure, routeTiming } from './timing.ts'
import type { RouteTimingResult } from './timing.ts'

/** Explicit, read-only model inputs. No fixture, UI or network dependencies. */
export interface EngineData {
  routes: readonly Route[]
  segments: readonly RoadSegment[]
}

export interface EngineResponseOption extends ResponseOption {
  estimated: true
  available: boolean
  unavailable_reason: string | null
  route_id: string | null
  /** Null for an unavailable route or an unconfirmed appointment. */
  metrics: MetricsResult | null
  added_miles: number | null
}

export interface ShipmentAssessment {
  estimated: true
  summary: {
    estimated: true
    risk: MetricsResult['risk']
    arrival_min: string | null
    arrival_max: string | null
    lateness_min: number | null
    lateness_max: number | null
    reason: string
    affected: boolean
  }
  current: MetricsResult
  /** Always the assigned original route without the incident, including for reroutes. */
  baseline: MetricsResult
  options: EngineResponseOption[]
  reopen_needed_by: string | null
  reroute_decide_by: string | null
  reopen_remaining_max_min: number | null
  reroute_travel_max_min: number | null
  /** TIGHT and UNKNOWN do not prove infeasibility; this is not the evaluation rule. */
  no_feasible_response: boolean
}

const clock = (minutes: number | null): string | null =>
  minutes === null ? null : formatTime(minutes)

function assignedRoute(shipment: Shipment, incident: Incident | null, data: EngineData): Route {
  const ids = new Set<string>()
  for (const route of data.routes) {
    if (ids.has(route.id)) throw new RangeError(`Duplicate route id: ${route.id}`)
    ids.add(route.id)
  }
  const route = data.routes.find((item) => item.id === shipment.assigned_route_id)
  if (!route) throw new RangeError(`Missing assigned route: ${shipment.assigned_route_id}`)
  if (route.kind !== 'original' || route.destination !== shipment.destination_id) {
    throw new RangeError(`Assigned route ${route.id} must be an original route to ${shipment.destination_id}`)
  }
  if (incident !== null && !data.segments.some((segment) => segment.id === incident.segment_id)) {
    throw new RangeError(`Missing incident segment: ${incident.segment_id}`)
  }
  return route
}

function deadline(end: number, travel: number, field: string): string {
  const result = end - travel
  if (result < 0) throw new RangeError(`${field} falls before the single demo day`)
  return formatTime(result)
}

function metricSteps(
  shipment: Shipment,
  route: Route,
  timing: RouteTimingResult,
  metrics: MetricsResult,
  assumptions: Assumptions,
): string[] {
  const range = (min: number | null, max: number | null) =>
    `${clock(min) ?? 'unknown'}–${clock(max) ?? 'unknown'}`
  const steps = [
    `Departure: max(cargo ready ${shipment.cargo_ready}, truck available ${shipment.truck_available}) + pickup handling ${assumptions.pickup_handling_min} min = ${clock(timing.departure)}.`,
    `Route ${route.id}: ${route.segment_ids.join(' → ')}.`,
  ]
  for (const segment of timing.segments) {
    steps.push(`${segment.segment_id}: enter ${range(segment.entry_min, segment.entry_max)}, exit ${range(segment.exit_min, segment.exit_max)}; closure wait ${segment.wait_min ?? 'unknown'}–${segment.wait_max ?? 'unknown'} min.`)
  }
  if (timing.closure?.affected) {
    const closure = timing.closure
    steps.push(closure.reopen === null
      ? `${closure.segment_id} reopening is unknown; no arrival estimate is invented.`
      : `${closure.segment_id} reopening ${clock(closure.reopen)} is ${closure.source === 'assumed' ? 'an explicit user assumption overriding the report' : 'a reported estimate'}, not a guarantee.`)
  }
  steps.push(
    `Estimated arrival ${range(metrics.arrival_min, metrics.arrival_max)}; service starts ${range(metrics.service_start_min, metrics.service_start_max)} (not before appointment opening ${shipment.appt_start}).`,
    `Original appointment ${shipment.appt_start}–${shipment.appt_end}: lateness ${metrics.lateness_min ?? 'unknown'}–${metrics.lateness_max ?? 'unknown'} min; risk ${metrics.risk}.`,
    `Estimated cost: ${metrics.miles} mi × $${assumptions.nonlabor_cost_per_mile}/mi + ${metrics.driver_duty_min ?? 'unknown'} duty min / 60 × $${assumptions.labor_rate_per_hr}/hr = ${metrics.cost === null ? 'unknown' : `$${metrics.cost}`} (rounded USD). Mileage cost already includes fuel.`,
    `Estimated tailpipe CO2: ${metrics.miles} mi / ${assumptions.mpg} mpg × ${assumptions.diesel_kgCO2_per_gal} kg/gal = ${metrics.co2_kg} kg; closure waiting is engine-off.`,
    `Estimated driver duty ${metrics.driver_duty_min ?? 'unknown'} min; assigned-route normal baseline ${metrics.normal_driver_duty_min ?? 'unknown'} min; signed increase ${metrics.driver_duty_increase_min ?? 'unknown'} min.`,
  )
  return steps
}

function notes(route: Route, metrics: MetricsResult): string[] {
  return [
    `Driver: estimated duty ${metrics.driver_duty_min ?? 'unknown'} min; no speeding or hours-of-service adjustments are assumed.`,
    'Warehouse: the original appointment deadline applies unless a later slot is confirmed.',
    route.near_sensitive_zone
      ? 'Community: route passes a flagged sensitive zone; this is a screening flag, not a measured exposure estimate.'
      : 'Community: route is not flagged as passing a sensitive zone; this does not establish zero exposure.',
    `Truck suitability: ${route.truck_suitability_note}`,
  ]
}

function drivingOption(
  kind: 'wait' | 'reroute',
  shipment: Shipment,
  route: Route,
  timing: RouteTimingResult,
  metrics: MetricsResult,
  baseline: MetricsResult,
  assumptions: Assumptions,
  status: string,
): EngineResponseOption {
  return {
    kind, estimated: true, available: true, unavailable_reason: null, route_id: route.id,
    metrics, added_miles: metrics.miles - baseline.miles,
    arrival_min: clock(metrics.arrival_min), arrival_max: clock(metrics.arrival_max),
    lateness_min: metrics.lateness_min, lateness_max: metrics.lateness_max,
    risk: metrics.risk, miles: metrics.miles, cost: metrics.cost, co2_kg: metrics.co2_kg,
    driver_duty_min: metrics.driver_duty_min,
    passes_sensitive_zone: metrics.passes_sensitive_zone,
    requires_confirmation: false, status,
    explanation_inputs: metricSteps(shipment, route, timing, metrics, assumptions),
    stakeholder_notes: notes(route, metrics),
  }
}

function emptyOption(
  kind: 'reroute' | 'request_slot',
  risk: ResponseOption['risk'],
  status: string,
): EngineResponseOption {
  return {
    kind, estimated: true, available: kind === 'request_slot',
    unavailable_reason: null, route_id: null, metrics: null, added_miles: null,
    arrival_min: null, arrival_max: null, lateness_min: null, lateness_max: null,
    risk, miles: null, cost: null, co2_kg: null, driver_duty_min: null,
    passes_sensitive_zone: false, requires_confirmation: kind === 'request_slot',
    status, explanation_inputs: [], stakeholder_notes: [],
  }
}

/**
 * Pure assessment in fixed presentation order: Wait, Reroute, Request later slot.
 * Invalid model inputs throw; a missing/closed alternative is explicitly unavailable.
 * An incident is relevant only when E1 determines that it changes this trip's timing.
 * Multiple alternatives use stable route-id order, not a UI recommendation/ranking.
 */
export function assessShipment(
  shipment: Shipment,
  incident: Incident | null,
  data: EngineData,
  assumptions: Assumptions,
): ShipmentAssessment {
  const route = assignedRoute(shipment, incident, data)
  const start = departure(shipment, assumptions)
  const normalTiming = routeTiming(route, data.segments, start, null)
  const timing = routeTiming(route, data.segments, start, incident)
  const metricsFor = (selectedRoute: Route, selectedTiming: RouteTimingResult) =>
    calculateMetrics({
      shipment, route: selectedRoute, segments: data.segments, timing: selectedTiming,
      assumptions, normal_timing: normalTiming,
    })
  const baseline = metricsFor(route, normalTiming)
  const current = metricsFor(route, timing)
  const affected = timing.closure?.affected === true
  const assessment: ShipmentAssessment = {
    estimated: true,
    summary: {
      estimated: true,
      risk: current.risk, arrival_min: clock(current.arrival_min), arrival_max: clock(current.arrival_max),
      lateness_min: current.lateness_min, lateness_max: current.lateness_max,
      reason: affected
        ? `Route uses closed segment ${incident!.segment_id}; reopening ${timing.closure!.source === 'unknown' ? 'unknown' : `${timing.closure!.source} (estimated)`}.`
        : incident === null ? 'Normal assigned-route estimate.' : 'Incident does not change this shipment’s timing.',
      affected,
    },
    current, baseline, options: [],
    reopen_needed_by: null, reroute_decide_by: null,
    reopen_remaining_max_min: null, reroute_travel_max_min: null,
    no_feasible_response: false,
  }
  if (!affected) return assessment

  const end = parseTime(shipment.appt_end, 'appt_end')
  const closedIndex = route.segment_ids.indexOf(incident!.segment_id)
  // E1 computes durations too: a midnight departure gives the travel-only max.
  const remaining = routeTiming(
    { segment_ids: route.segment_ids.slice(closedIndex) }, data.segments, 0, null,
  ).arrival_max!
  assessment.reopen_remaining_max_min = remaining
  assessment.reopen_needed_by = deadline(end, remaining, 'reopen_needed_by')
  const waitStatus = timing.closure!.source === 'unknown'
    ? `Estimate: works only if ${incident!.segment_id} reopens by ${assessment.reopen_needed_by}; reopening is unknown`
    : `Estimate: ${timing.closure!.source === 'assumed' ? 'user-assumed' : 'reported'} reopening ${clock(timing.closure!.reopen)}; not guaranteed`
  const wait = drivingOption('wait', shipment, route, timing, current, baseline, assumptions, waitStatus)
  wait.explanation_inputs.push(
    `Reopen needed by: appointment end ${shipment.appt_end} − ${remaining} max travel min from ${incident!.segment_id} start through destination = ${assessment.reopen_needed_by}.`,
  )
  if (timing.closure!.source === 'unknown') wait.explanation_inputs.push(waitStatus)

  const alternatives = data.routes.filter((item) =>
    item.kind === 'alternative' && item.destination === shipment.destination_id && item.origin === route.origin,
  ).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const alternative = alternatives.find((item) => !item.segment_ids.includes(incident!.segment_id))
    ?? alternatives[0]
  let reroute: EngineResponseOption
  if (!alternative) {
    const reason = `No alternative route from ${route.origin} to ${shipment.destination_id}.`
    reroute = emptyOption('reroute', 'UNKNOWN', 'unavailable')
    reroute.unavailable_reason = reason
    reroute.explanation_inputs = [reason, 'The assigned route is not substituted for a missing alternative.']
    reroute.stakeholder_notes = ['Dispatcher: an alternative route must be supplied and validated before selecting Reroute.']
  } else {
    const alternativeTiming = routeTiming(alternative, data.segments, start, null)
    const alternativeMetrics = metricsFor(alternative, alternativeTiming)
    if (alternative.segment_ids.includes(incident!.segment_id)) {
      const reason = `Alternative route ${alternative.id} contains closed segment ${incident!.segment_id}.`
      reroute = emptyOption('reroute', 'UNKNOWN', 'unavailable')
      reroute.route_id = alternative.id
      reroute.unavailable_reason = reason
      reroute.passes_sensitive_zone = alternative.near_sensitive_zone
      reroute.explanation_inputs = [reason, 'Reroute is unavailable even when an estimated reopening is supplied.']
      reroute.stakeholder_notes = ['Dispatcher: do not use a closed segment as an alternative.']
    } else {
      const travel = routeTiming(alternative, data.segments, 0, null).arrival_max!
      assessment.reroute_travel_max_min = travel
      assessment.reroute_decide_by = deadline(end, travel, 'reroute_decide_by')
      reroute = drivingOption(
        'reroute', shipment, alternative, alternativeTiming, alternativeMetrics, baseline, assumptions,
        `Estimate: alternative route ${alternative.id} avoids ${incident!.segment_id}`,
      )
      reroute.explanation_inputs.push(
        `Reroute decide by: appointment end ${shipment.appt_end} − ${travel} max alternative travel min = ${assessment.reroute_decide_by}.`,
      )
    }
  }
  const request = emptyOption('request_slot', current.risk, 'pending_confirmation')
  request.explanation_inputs = [
    'A later appointment is a request, not a confirmed or modeled new appointment.',
    `Until confirmation, original deadline ${shipment.appt_end} still applies; current risk remains ${current.risk}.`,
    'Unconfirmed arrival, lateness, distance, cost, CO2 and duty are null; totals retain the current Wait plan.',
  ]
  request.stakeholder_notes = [
    'Warehouse: confirm a specific later appointment before treating the shipment as saved.',
    'Driver: keep the current plan until confirmation; no duty reduction is assumed.',
    'Community: no new route is confirmed by an appointment request.',
  ]
  assessment.options = [wait, reroute, request]
  assessment.no_feasible_response = [wait, reroute].filter((option) => option.available)
    .every((option) => option.risk === 'LATE')
  return assessment
}

/** [] for normal/unaffected shipments; never selects or ranks a UI response. */
export function buildResponseOptions(
  shipment: Shipment,
  incident: Incident | null,
  data: EngineData,
  assumptions: Assumptions,
): EngineResponseOption[] {
  return assessShipment(shipment, incident, data, assumptions).options
}
