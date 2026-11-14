import type { ShipmentCardView } from '../viewModels.ts'

/** Queue urgency only, never response ranking. Fixed-day HH:MM sorts lexically. */
export function compareReviewUrgency(a: ShipmentCardView, b: ShipmentCardView): number {
  const aUnfixable = a.no_feasible_response === true
  const bUnfixable = b.no_feasible_response === true
  if (aUnfixable !== bUnfixable) return aUnfixable ? 1 : -1
  const aDeadline = a.reroute_decide_by ?? null
  const bDeadline = b.reroute_decide_by ?? null
  if (aDeadline !== bDeadline) {
    if (aDeadline === null) return 1
    if (bDeadline === null) return -1
    return aDeadline < bDeadline ? -1 : 1
  }
  return a.shipment.id < b.shipment.id ? -1 : a.shipment.id > b.shipment.id ? 1 : 0
}
