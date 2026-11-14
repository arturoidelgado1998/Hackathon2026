// Typed access to the SIMULATED sample data.
// Import from here instead of touching the JSON files directly.
// The JSON files are generated from the team's ArcGIS feature service by
// scripts/import_map_data.py; see README.md in this folder. Do not edit them by hand.

import type {
  Assumptions,
  Facility,
  Incident,
  ResponseOption,
  RoadSegment,
  Route,
  Shipment,
} from '../types'
import type { Baseline, Scenario, ShipmentSummary } from '../viewModels'
import assumptionsJson from './assumptions.json'
import facilitiesJson from './facilities.json'
import routesJson from './routes.json'
import sampleResponsesJson from './sample-responses.json'
import segmentsJson from './segments.json'
import shipmentsJson from './shipments.json'

export type { Baseline, Scenario, ShipmentSummary }

/** Every sample data file carries this label. */
export const DATA_LABEL = 'SIMULATED' as const

/**
 * A route as stored in routes.json: the D1 `Route` plus stored totals
 * (sums of its segments) and the sensitive-zone note, which `Route` lacks.
 */
export type RouteRecord = Route & {
  sensitive_zone_note: string
  total_miles: number
  total_minutes_min: number
  total_minutes_max: number
}

/** One shipment in one scenario, as stored in sample-responses.json. */
export interface ScenarioEntry {
  summary: ShipmentSummary
  /** wait, reroute, request_slot; empty when the shipment is unaffected. */
  options: ResponseOption[]
}

/** Shape of sample-responses.json. */
export interface SampleResponsesFile {
  label: typeof DATA_LABEL
  note: string
  reference_shipment_id: string
  incident: Incident
  baselines: Record<string, Baseline>
  scenarios: Record<Scenario, Record<string, ScenarioEntry>>
}

const responses = sampleResponsesJson as unknown as SampleResponsesFile

export const facilities: Facility[] = facilitiesJson.items as Facility[]
export const segments: RoadSegment[] = segmentsJson.items as unknown as RoadSegment[]
export const routes: RouteRecord[] = routesJson.items as RouteRecord[]
export const shipments: Shipment[] = shipmentsJson.items as Shipment[]

export const assumptions: Assumptions = {
  pickup_handling_min: assumptionsJson.pickup_handling_min,
  mpg: assumptionsJson.mpg,
  nonlabor_cost_per_mile: assumptionsJson.nonlabor_cost_per_mile,
  labor_rate_per_hr: assumptionsJson.labor_rate_per_hr,
  diesel_kgCO2_per_gal: assumptionsJson.diesel_kgCO2_per_gal,
  sources: assumptionsJson.sources,
}

/** Assumption field name -> true when the value is a placeholder (all are). */
export const assumptionPlaceholders: Record<string, boolean> = assumptionsJson.placeholders

/** The sample incident: NB-03 closed from 10:00, reported reopening 11:10. */
export const sampleIncident: Incident = responses.incident

/** S-01 to WH-A: the team plan's reference shipment (45 mi original, 60 mi alternative). */
export const REFERENCE_SHIPMENT_ID = 'S-01'

const ORDER: ResponseOption['kind'][] = ['wait', 'reroute', 'request_slot']

function entry(shipmentId: string, scenario: Scenario): ScenarioEntry {
  const found = responses.scenarios[scenario][shipmentId]
  if (!found) throw new Error(`No sample data for shipment ${shipmentId} (${scenario})`)
  return found
}

/** Current status of a shipment in a scenario. Throws for an unknown id. */
export function getShipmentSummary(shipmentId: string, scenario: Scenario): ShipmentSummary {
  return entry(shipmentId, scenario).summary
}

/** Response options in the order wait, reroute, request_slot; [] when none. */
export function getResponseOptions(shipmentId: string, scenario: Scenario): ResponseOption[] {
  const options = responses.scenarios[scenario][shipmentId]?.options ?? []
  return [...options].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
}

/** Normal-scenario metrics on the assigned route. Throws for an unknown id. */
export function getBaseline(shipmentId: string): Baseline {
  const found = responses.baselines[shipmentId]
  if (!found) throw new Error(`No baseline for shipment ${shipmentId}`)
  return found
}

export function getFacility(id: string): Facility | undefined {
  return facilities.find((f) => f.id === id)
}

export function getRoute(id: string): RouteRecord | undefined {
  return routes.find((r) => r.id === id)
}

export function getSegment(id: string): RoadSegment | undefined {
  return segments.find((s) => s.id === id)
}

export function getShipment(id: string): Shipment | undefined {
  return shipments.find((s) => s.id === id)
}

/** Routes ending at a facility, original first. */
export function getRoutesForDestination(facilityId: string): RouteRecord[] {
  return routes
    .filter((r) => r.destination === facilityId)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'original' ? -1 : 1))
}
