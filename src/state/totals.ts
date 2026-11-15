import {
  assumptions, getActiveIncident, getResponseOptions, routes, segments, shipments,
} from '../data/index.ts'
import { evaluateAll } from '../engine/evaluation.ts'
import { isResponseOptionAvailable } from './options.ts'
import type { AppState } from './reducer.ts'

export interface Totals {
  atRisk: number
  cost: number | null
  co2Kg: number | null
}

/** Validate committed workflow, then delegate every modeled total to the engine. */
export function getTotals(state: AppState): Totals {
  for (const [shipmentId, decision] of Object.entries(state.decisions)) {
    const option = getResponseOptions(shipmentId, state.scenario)
      .find((item) => item.kind === decision.option_kind)
    const expectedStatus = decision.option_kind === 'request_slot' ? 'pending_confirmation' : 'selected'
    if (
      decision.shipment_id !== shipmentId || !option ||
      !isResponseOptionAvailable(option) || decision.status !== expectedStatus
    ) {
      throw new Error(`Invalid committed decision for ${shipmentId} (${state.scenario})`)
    }
  }
  const { totals } = evaluateAll(
    shipments, state.scenario === 'disrupted' ? getActiveIncident() : null,
    Object.values(state.decisions), { routes, segments }, assumptions,
  )
  return { atRisk: totals.late + totals.tightOrUnknown, cost: totals.cost, co2Kg: totals.co2Kg }
}
