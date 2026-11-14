// Builds the words a driver reads from a decision the dispatcher recorded.
// Pure, and no calculation: every figure is copied from the response option
// (sample data today, the engine after E4). The one difference shown, added
// duty minutes, comes from components/responses/deltas.ts like the dashboard.
//
// Wording rules (tracker #1): a pending slot request is never a new plan
// (rule 5); nothing tells the driver they are late or to go faster (rule 7);
// the shipment id is the only identifier (rule 8).

import { delta } from '../components/responses/deltas.ts'
import { NA, formatArrival, formatDutyDelta } from '../components/responses/format.ts'
import type { Decision, Incident, ResponseOption, Shipment } from '../types.ts'
import type { Baseline } from '../viewModels.ts'
import type { DriverNoticeBody } from './types.ts'

export const TRUCK_CAUTION =
  'Route suitability for trucks is not verified. Check current truck restrictions.'
export const PENDING_INSTRUCTION =
  'Keep to the original plan. A later slot has been requested and is NOT confirmed.'

export interface DriverNoticeInput {
  shipment: Shipment
  destinationName: string
  decision: Decision
  /** The option the decision chose, as shown in the response panel. */
  option: ResponseOption
  /** Normal-scenario metrics for the same shipment. */
  baseline: Baseline
  /** A confirmed incident. An unconfirmed one must never reach a notice. */
  incident: Incident
  incidentSegmentName: string
  /** The alternative route's id and segment names, in travel order. */
  alternativeRoute: { id: string; segmentNames: string[] } | null
}

/** A committed decision has the status its option kind requires. */
function isCommitted(decision: Decision): boolean {
  return decision.option_kind === 'request_slot'
    ? decision.status === 'pending_confirmation'
    : decision.status === 'selected'
}

function whatChanged(incident: Incident, segmentName: string): string {
  const closure = `${incident.segment_id} (${segmentName}) is closed from ${incident.start_time}.`
  if (incident.reported_reopen_time) {
    return `${closure} Reported reopening ${incident.reported_reopen_time} (estimate, not a guarantee).`
  }
  if (incident.assumed_reopen_time) {
    return `${closure} No reopening time was reported. Dispatch assumes ${incident.assumed_reopen_time} (assumption).`
  }
  return `${closure} No reopening time has been reported.`
}

function driverImpact(option: ResponseOption, baseline: Baseline): string {
  if (option.driver_duty_min === null) {
    return 'Duty time is not available until a new slot is confirmed.'
  }
  const change = formatDutyDelta(delta(option.driver_duty_min, baseline.driver_duty_min))
  return `${option.driver_duty_min} min on duty: ${change}.`
}

/**
 * The notice text for one committed decision, or null when nothing may be
 * sent: a preview, a decision for another shipment or option, an
 * unconfirmed incident, or a reroute with no alternative route.
 */
export function buildDriverNotice(input: DriverNoticeInput): DriverNoticeBody | null {
  const { shipment, decision, option, incident, alternativeRoute } = input
  if (decision.shipment_id !== shipment.id) return null
  if (decision.option_kind !== option.kind) return null
  if (!isCommitted(decision)) return null
  if (!incident.confirmed_by_user) return null
  if (option.kind === 'reroute' && !alternativeRoute) return null

  const segment = incident.segment_id
  const arrival = option.kind === 'request_slot' ? NA : formatArrival(option)
  const base = {
    shipment_id: shipment.id,
    destination_name: input.destinationName,
    appt_start: shipment.appt_start,
    appt_end: shipment.appt_end,
    option_kind: option.kind,
    what_changed: whatChanged(incident, input.incidentSegmentName),
    estimated_arrival: arrival === NA ? null : arrival,
    driver_impact: driverImpact(option, input.baseline),
  }

  switch (option.kind) {
    case 'wait':
      return {
        ...base,
        instruction: `Keep the original route. Expect to wait at ${segment} until it reopens.`,
        route_steps: [],
        caution: null,
        reason: `Dispatch chose to wait for ${segment} to reopen.`,
      }
    case 'reroute':
      return {
        ...base,
        instruction: `Use the alternative route ${alternativeRoute!.id}.`,
        route_steps: alternativeRoute!.segmentNames,
        caution: TRUCK_CAUTION,
        reason: `Dispatch chose the alternative route to avoid the closed segment ${segment}.`,
      }
    case 'request_slot':
      return {
        ...base,
        instruction: PENDING_INSTRUCTION,
        route_steps: [],
        caution: null,
        reason:
          'Dispatch has asked the warehouse for a later slot. Until the warehouse confirms it, the original appointment still applies.',
      }
  }
}
