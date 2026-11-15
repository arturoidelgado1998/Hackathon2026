// Turns what the response panel already shows into the facts the AI is given.
// Lookups only: every value is copied from the view, nothing is calculated.
// On a live day a response the clock has closed is passed as unavailable, so
// the AI cannot suggest it.

import { isResponseOptionOpen } from '../state/options.ts'
import type { ResponsePanelView } from '../viewModels.ts'
import type { ShipmentFacts } from './suggestion.ts'

export function buildShipmentFacts(view: ResponsePanelView): ShipmentFacts {
  return {
    shipment_id: view.shipment.id,
    appt_start: view.shipment.appt_start,
    appt_end: view.shipment.appt_end,
    options: view.options.map((option) => {
      const community = view.community[option.kind]
      return {
        kind: option.kind,
        available: isResponseOptionOpen(option),
        arrival_min: option.arrival_min,
        arrival_max: option.arrival_max,
        lateness_min: option.lateness_min,
        lateness_max: option.lateness_max,
        risk: option.risk,
        miles: option.miles,
        cost: option.cost,
        co2_kg: option.co2_kg,
        driver_duty_min: option.driver_duty_min,
        schools_150m: community?.schools_150m ?? null,
        dac_tracts: community?.dac_tracts?.length ?? null,
        status: option.status,
      }
    }),
  }
}
