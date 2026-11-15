// The dashboard on a live day: each shipment as it stands at the current clock
// time, from the data module and the dispatcher's committed decisions.
// Every figure is the engine's; see src/sim/liveAssessment.ts for the rules.

import {
  assumptions,
  getActiveIncident,
  getShipment,
  getShipmentAssessment,
  routes,
  segments,
  shipments,
} from '../data/index.ts'
import { evaluateAssessments } from '../engine/evaluation.ts'
import { liveNote } from '../sim/events.ts'
import {
  assessLive,
  swapBlockedReason,
  type LiveInput,
  type LiveShipment,
} from '../sim/liveAssessment.ts'
import type { TimingCase } from '../sim/trucks.ts'
import type { Decision } from '../types.ts'
import type { ResponsePanelView, Scenario, ShipmentCardView } from '../viewModels.ts'
import { isResponseOptionAvailable } from './options.ts'
import type { AppState } from './reducer.ts'
import type { Totals } from './totals.ts'

function inputFor(
  shipmentId: string,
  scenario: Scenario,
  decision: Decision | undefined,
  timingCase: TimingCase,
  now: number | null,
): LiveInput {
  const shipment = getShipment(shipmentId)
  if (!shipment) throw new Error(`Unknown shipment: ${shipmentId}`)
  return {
    shipment,
    assessment: getShipmentAssessment(shipmentId, scenario),
    incident: scenario === 'disrupted' ? getActiveIncident() : null,
    routes,
    segments,
    assumptions,
    decision,
    timingCase,
    now,
  }
}

/** One entry per shipment, in the data module's order. `now` null: no clock. */
export function buildLiveShipments(
  scenario: Scenario,
  decisions: Record<string, Decision> = {},
  timingCase: TimingCase = 'slow',
  now: number | null = null,
): LiveShipment[] {
  return shipments.map((shipment) =>
    assessLive(inputFor(shipment.id, scenario, decisions[shipment.id], timingCase, now)),
  )
}

/**
 * Puts the clock into the board's cards: where each truck is, which deadlines
 * still stand, the figures of a reroute chosen late, and Delivered once the
 * truck has arrived. Without a clock the cards are returned unchanged.
 */
export function applyLiveToCards(
  cards: readonly ShipmentCardView[],
  live: readonly LiveShipment[],
  segmentName: (segmentId: string) => string,
): ShipmentCardView[] {
  const byId = new Map(live.map((item) => [item.shipment_id, item]))
  return cards.map((card) => {
    const item = byId.get(card.shipment.id)
    if (!item || item.now === null || item.state === null) return card
    const note = liveNote(item.plan, item.state, segmentName)

    if (item.delivery) {
      const { at, risk, lateness, text } = item.delivery
      return {
        ...card,
        column: 'delivered',
        summary: {
          ...card.summary,
          risk,
          arrival_min: at,
          arrival_max: at,
          lateness_min: lateness,
          lateness_max: lateness,
          reason: text,
        },
        delivered_at: at,
        liveNote: undefined,
        liveDeadlines: [],
        reroute_decide_by: null,
        no_feasible_response: false,
        rejectionNote: undefined,
      }
    }
    if (!card.summary.affected) return { ...card, liveNote: note }

    const segmentId = card.incidentSegmentId
    const deadlines: string[] = []
    if (item.reopen_needed_by && segmentId) {
      deadlines.push(
        item.reopen_deadline_passed
          ? `${segmentId} did not reopen by ${item.reopen_needed_by}: waiting no longer meets the appointment`
          : `Wait works only if ${segmentId} reopens by ${item.reopen_needed_by}`,
      )
    }
    const wait = item.options.find((option) => option.kind === 'wait')
    const reroute = item.options.find((option) => option.kind === 'reroute')
    const reopened = !item.plan.rerouted && wait?.available === true && wait.closed_reason !== null
    if (reopened) {
      // The road has reopened: the route is settled and no deadline is left.
      deadlines.push(wait.status)
    } else if (!item.plan.rerouted && reroute) {
      if (reroute.closed_reason !== null) deadlines.push('Reroute is no longer possible')
      else if (item.reroute_decide_by) {
        deadlines.push(
          item.reroute_deadline_passed
            ? `Reroute deadline ${item.reroute_decide_by} has passed: rerouting now may miss the appointment`
            : `Reroute must be chosen by ${item.reroute_decide_by}`,
        )
      }
    }

    // A reroute chosen late shows the figures it had when it was chosen.
    const chosen =
      card.decision?.status === 'selected'
        ? item.options.find((option) => option.kind === card.decision!.option_kind)
        : undefined
    const summary =
      chosen && chosen.metrics !== null
        ? {
            ...card.summary,
            risk: chosen.risk,
            arrival_min: chosen.arrival_min,
            arrival_max: chosen.arrival_max,
            lateness_min: chosen.lateness_min,
            lateness_max: chosen.lateness_max,
            reason: chosen.status,
          }
        : reopened && segmentId
          ? { ...card.summary, reason: `Delayed by the ${segmentId} closure, which has ended.` }
          : card.summary
    // Nothing left to review once events have settled the route and the load is on track.
    const settled =
      card.column === 'needs_review' && !item.route_choice_open && summary.risk === 'ON_TRACK'
    return {
      ...card,
      summary,
      column: settled ? 'monitoring' : card.column,
      liveNote: note,
      liveDeadlines: deadlines,
      reroute_decide_by: item.reroute_decide_by,
      no_feasible_response: item.no_feasible_response,
    }
  })
}

/** The response panel for the selected shipment as it stands now. */
export function applyLiveToView(
  view: ResponsePanelView | null,
  live: readonly LiveShipment[],
): ResponsePanelView | null {
  if (!view) return null
  const item = live.find((entry) => entry.shipment_id === view.shipment.id)
  if (!item || item.now === null) return view
  if (item.delivery) {
    return { ...view, options: [], closedNote: `${item.delivery.text} Nothing is left to decide for ${view.shipment.id}.` }
  }
  return view.options.length === 0 ? view : { ...view, options: item.options }
}

/**
 * Totals for the plan as committed, with a late reroute at the figures it had
 * when chosen. Every total is the engine's. A delivered load is no longer at risk.
 */
export function getLiveTotals(state: AppState, live: readonly LiveShipment[]): Totals {
  for (const [shipmentId, decision] of Object.entries(state.decisions)) {
    const item = live.find((entry) => entry.shipment_id === shipmentId)
    const option = item?.assessment.options.find((entry) => entry.kind === decision.option_kind)
    const expectedStatus = decision.option_kind === 'request_slot' ? 'pending_confirmation' : 'selected'
    if (
      decision.shipment_id !== shipmentId || !option ||
      !isResponseOptionAvailable(option) || decision.status !== expectedStatus
    ) {
      throw new Error(`Invalid committed decision for ${shipmentId} (${state.scenario})`)
    }
  }
  const result = evaluateAssessments(
    shipments,
    new Map(live.map((item) => [item.shipment_id, item.assessment])),
    Object.values(state.decisions),
  )
  const delivered = new Set(live.filter((item) => item.delivery).map((item) => item.shipment_id))
  return {
    atRisk: result.shipments.filter(
      (item) => !delivered.has(item.shipment_id) && item.metrics.risk !== 'ON_TRACK',
    ).length,
    cost: result.totals.cost,
    co2Kg: result.totals.co2Kg,
  }
}

/**
 * Why the last choice can no longer be undone on a live day, or null when it
 * can: undoing must not move a truck that has already acted on the choice.
 */
export function undoBlockedReason(
  state: AppState,
  timingCase: TimingCase,
  now: number | null,
): string | null {
  const change = state.lastDecisionChange
  if (!change || now === null) return null
  return swapBlockedReason(
    inputFor(change.shipmentId, state.scenario, state.decisions[change.shipmentId], timingCase, now),
    change.previousDecision ?? undefined,
  )
}
