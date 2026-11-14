import {
  getBaseline,
  getResponseOptions,
  getShipmentSummary,
  shipments,
} from '../data/index.ts'
import type { ResponseOption } from '../types.ts'
import { isResponseOptionAvailable } from './options.ts'
import type { AppState } from './reducer.ts'

export interface Totals {
  atRisk: number
  cost: number | null
  co2Kg: number | null
}

function sumMetric(total: number | null, value: number | null | undefined): number | null {
  return total !== null && typeof value === 'number' && Number.isFinite(value)
    ? total + value
    : null
}

/** Sums supplied sample metrics; E4 replaces this lookup with engine output. */
export function getTotals(state: AppState): Totals {
  for (const [shipmentId, decision] of Object.entries(state.decisions)) {
    if (decision.shipment_id !== shipmentId || !shipments.some((s) => s.id === shipmentId)) {
      throw new Error(`Invalid committed decision for ${shipmentId}`)
    }
  }

  const totals: Totals = { atRisk: 0, cost: 0, co2Kg: 0 }

  for (const shipment of shipments) {
    const summary = getShipmentSummary(shipment.id, state.scenario)
    const decision = state.decisions[shipment.id]
    const options = summary.affected || decision
      ? getResponseOptions(shipment.id, state.scenario)
      : []
    const selected = decision
      ? options.find((option) => option.kind === decision.option_kind)
      : undefined

    if (decision) {
      const expectedStatus = decision.option_kind === 'request_slot'
        ? 'pending_confirmation'
        : 'selected'
      if (!selected || !isResponseOptionAvailable(selected) || decision.status !== expectedStatus) {
        throw new Error(`Invalid committed decision for ${shipment.id} (${state.scenario})`)
      }
    }

    let metrics: Pick<ResponseOption, 'cost' | 'co2_kg'>
    let risk = summary.risk
    if (state.scenario === 'disrupted' && summary.affected) {
      // A pending slot request has not changed the route or original deadline.
      const current = decision?.status === 'selected'
        ? selected
        : options.find((option) => option.kind === 'wait')
      if (!current) {
        throw new Error(`No current response metrics for ${shipment.id} (${state.scenario})`)
      }
      metrics = current
      risk = current.risk
    } else {
      metrics = getBaseline(shipment.id)
    }

    if (risk === 'LATE' || risk === 'TIGHT' || risk === 'UNKNOWN') totals.atRisk += 1
    totals.cost = sumMetric(totals.cost, metrics.cost)
    totals.co2Kg = sumMetric(totals.co2Kg, metrics.co2_kg)
  }

  return totals
}
