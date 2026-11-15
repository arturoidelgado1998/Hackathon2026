// Builds each shipment's truck trip for the simulation clock from the data
// module and the dispatcher's committed decisions. Previews never move a truck.

import type { TimingCase, TruckPlan } from '../sim/trucks.ts'
import type { Decision } from '../types.ts'
import type { Scenario } from '../viewModels.ts'
import { buildLiveShipments } from './live.ts'

/**
 * One plan per shipment. A truck follows its assigned route unless the
 * dispatcher has selected Reroute, in which case it takes the engine's
 * alternative route: from its ready time on the prefilled sample, and from
 * where it was when the choice was made on a live day. A slot request leaves
 * the truck on its assigned route.
 */
export function buildTruckPlans(
  scenario: Scenario,
  decisions: Record<string, Decision> = {},
  timingCase: TimingCase = 'slow',
): TruckPlan[] {
  return buildLiveShipments(scenario, decisions, timingCase, null).map((item) => item.plan)
}
