// Builds each shipment's truck trip for the simulation clock from the data
// module and the dispatcher's committed decisions. Previews never move a truck.

import {
  assumptions,
  getResponseOptions,
  getRoute,
  getActiveIncident,
  segments,
  shipments,
} from '../data/index.ts'
import { planTruck, type TimingCase, type TruckPlan } from '../sim/trucks.ts'
import type { Decision } from '../types.ts'
import type { Scenario } from '../viewModels.ts'

/**
 * One plan per shipment. A truck follows its assigned route unless the
 * dispatcher has selected Reroute, in which case it takes the engine's
 * alternative route. A slot request leaves the truck on its assigned route.
 */
export function buildTruckPlans(
  scenario: Scenario,
  decisions: Record<string, Decision> = {},
  timingCase: TimingCase = 'slow',
): TruckPlan[] {
  const incident = scenario === 'disrupted' ? getActiveIncident() : null
  return shipments.map((shipment) => {
    const decision = decisions[shipment.id]
    const reroute =
      incident && decision?.status === 'selected' && decision.option_kind === 'reroute'
        ? getResponseOptions(shipment.id, scenario).find((o) => o.kind === 'reroute')
        : undefined
    const routeId = reroute?.available && reroute.route_id ? reroute.route_id : shipment.assigned_route_id
    const route = getRoute(routeId)
    if (!route) throw new Error(`Missing route ${routeId} for shipment ${shipment.id}`)
    return planTruck(shipment, route, segments, incident, assumptions, timingCase)
  })
}
