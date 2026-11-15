// Runs the simulation page's settings through the engine: one truck trip and
// one outcome row per shipment. Nothing is calculated here; arrivals, lateness
// and risk are the engine's, for whichever closure the settings describe.

import { assumptions, getFacility, getRoute, routes, segments, shipments } from '../data/index.ts'
import { assessShipment } from '../engine/responses.ts'
import { incidentOf, settingsError, type SimSettings } from '../sim/settings.ts'
import { planTruck, type TruckPlan } from '../sim/trucks.ts'
import type { Incident, RiskLabel, Shipment } from '../types.ts'

export interface SimRow {
  shipment: Shipment
  destinationName: string
  route_id: string
  rerouted: boolean
  /** The closure delays this shipment on its assigned route. */
  affected: boolean
  /** A reroute was asked for but no alternative avoids the closure. */
  rerouteUnavailable: boolean
  arrival_min: string | null
  arrival_max: string | null
  lateness_min: number | null
  lateness_max: number | null
  risk: RiskLabel
}

export interface SimRun {
  incident: Incident | null
  plans: TruckPlan[]
  rows: SimRow[]
  /** Set when the settings cannot run; plans and rows are then empty. */
  error: string | null
}

export function runSimulation(settings: SimSettings): SimRun {
  const problem = settingsError(settings)
  if (problem) return { incident: null, plans: [], rows: [], error: problem }
  const incident = incidentOf(settings)
  try {
    const plans: TruckPlan[] = []
    const rows: SimRow[] = []
    for (const shipment of shipments) {
      const assessment = assessShipment(shipment, incident, { routes, segments }, assumptions)
      const affected = assessment.summary.affected
      const reroute = assessment.options.find((option) => option.kind === 'reroute')
      const wantsReroute = incident !== null && settings.response === 'reroute' && affected
      const takesReroute = wantsReroute && reroute?.available === true && reroute.route_id !== null
      const routeId = takesReroute ? reroute.route_id! : shipment.assigned_route_id
      const route = getRoute(routeId)
      if (!route) throw new Error(`Missing route ${routeId} for shipment ${shipment.id}`)
      const outcome = takesReroute ? reroute : assessment.summary
      plans.push(planTruck(shipment, route, segments, incident, assumptions, settings.timingCase))
      rows.push({
        shipment,
        destinationName: getFacility(shipment.destination_id)?.name ?? shipment.destination_id,
        route_id: routeId,
        rerouted: takesReroute,
        affected,
        rerouteUnavailable: wantsReroute && !takesReroute,
        arrival_min: outcome.arrival_min,
        arrival_max: outcome.arrival_max,
        lateness_min: outcome.lateness_min,
        lateness_max: outcome.lateness_max,
        risk: outcome.risk,
      })
    }
    return { incident, plans, rows, error: null }
  } catch (error) {
    // The engine refuses times that run past midnight or other invalid inputs.
    const detail = error instanceof Error ? error.message : 'unknown problem'
    return { incident: null, plans: [], rows: [], error: `These settings cannot be simulated: ${detail}.` }
  }
}
