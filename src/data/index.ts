// Typed access to the SIMULATED sample data.
// Import from here instead of touching the JSON files directly.
// The JSON files are generated from the team's ArcGIS feature service by
// scripts/import_map_data.py; see README.md in this folder. Do not edit them by hand.

import type {
  Assumptions,
  Facility,
  RoadSegment,
  Route,
  Shipment,
} from '../types'
import type { Baseline, Scenario, ShipmentSummary } from '../viewModels'
import { assessShipment } from '../engine/responses.ts'
import type { EngineResponseOption, ShipmentAssessment } from '../engine/responses.ts'
import { getActiveIncident, sampleIncident, setActiveIncident } from './demoIncident.ts'
import assumptionsJson from './assumptions.json'
import corridorJson from './corridor.json'
import facilitiesJson from './facilities.json'
import routesJson from './routes.json'
import segmentsJson from './segments.json'
import shipmentsJson from './shipments.json'

export type { Baseline, Scenario, ShipmentSummary }
export { getActiveIncident, sampleIncident, setActiveIncident }

/** One real public layer used by the corridor analysis. */
export interface CorridorSource {
  id: 'schools' | 'dac_tracts'
  name: string
  publisher: string
  /** School year or release, as published. */
  edition: string
  url: string
  /** Date the layer was downloaded, YYYY-MM-DD. */
  retrieved: string
  features_in_study_box: number
}

/** What the corridor analysis found beside one route. */
export interface RouteCorridor {
  schools_150m: number
  /** NCES school ids. */
  schools: string[]
  /** Census tract ids. */
  dac_tracts: string[]
  max_diesel_pm_pctl: number | null
  near_sensitive_zone: boolean
  note: string
}

/**
 * The corridor analysis (G3): REAL schools and disadvantaged tracts within
 * 150 m of each ILLUSTRATIVE route. Written by scripts/corridor_analysis.py.
 * A proximity measure, not measured exposure.
 */
export interface CorridorFile {
  label: string
  buffer_m: number
  method: string
  meaning: string
  basis: string
  sources: CorridorSource[]
  routes: Record<string, RouteCorridor>
  segments: Record<string, { schools: string[]; dac_tracts: string[]; near_sensitive_zone: boolean }>
}

export const corridor = corridorJson as unknown as CorridorFile

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

/**
 * The generated files carry labels such as "(fictional)" and "ILLUSTRATIVE".
 * They stay in the files, which are not edited by hand, and are dropped here
 * so the app shows plain names and notes.
 */
function plain(text: string): string {
  return text
    .replace(/\s*\((?:fictional|synthetic|real locations, illustrative route)\)/gi, '')
    .replace(/^ILLUSTRATIVE - not verified for trucks$/i, 'Not verified for trucks')
    .replace(/\bSYNTHETIC\s+/g, '')
}

export const facilities: Facility[] = (facilitiesJson.items as Facility[]).map((facility) => ({
  ...facility,
  name: plain(facility.name),
}))
export const segments: RoadSegment[] = (segmentsJson.items as unknown as RoadSegment[]).map((segment) => ({
  ...segment,
  sensitive_zone_note: plain(segment.sensitive_zone_note),
}))
export const routes: RouteRecord[] = (routesJson.items as RouteRecord[]).map((route) => ({
  ...route,
  sensitive_zone_note: plain(route.sensitive_zone_note),
  truck_suitability_note: plain(route.truck_suitability_note),
}))
export const shipments: Shipment[] = shipmentsJson.items as Shipment[]

export const assumptions: Assumptions = {
  pickup_handling_min: assumptionsJson.pickup_handling_min,
  mpg: assumptionsJson.mpg,
  nonlabor_cost_per_mile: assumptionsJson.nonlabor_cost_per_mile,
  labor_rate_per_hr: assumptionsJson.labor_rate_per_hr,
  diesel_kgCO2_per_gal: assumptionsJson.diesel_kgCO2_per_gal,
  sources: assumptionsJson.sources,
}

/** Assumption field name -> true when the value is still a team placeholder, false when it cites a published source. */
export const assumptionPlaceholders: Record<string, boolean> = assumptionsJson.placeholders

/** S-01 to WH-A: the team plan's reference shipment (45 mi original, 60 mi alternative). */
export const REFERENCE_SHIPMENT_ID = 'S-01'

/** Reassess raw inputs on every call; never cache generated response values. */
export function getShipmentAssessment(shipmentId: string, scenario: Scenario): ShipmentAssessment {
  const shipment = getShipment(shipmentId)
  if (!shipment) throw new Error(`Unknown shipment: ${shipmentId}`)
  return assessShipment(
    shipment, scenario === 'disrupted' ? getActiveIncident() : null, { routes, segments }, assumptions,
  )
}

/** Current status of a shipment in a scenario. Throws for an unknown id. */
export function getShipmentSummary(shipmentId: string, scenario: Scenario): ShipmentSummary {
  const { risk, arrival_min, arrival_max, lateness_min, lateness_max, reason, affected } =
    getShipmentAssessment(shipmentId, scenario).summary
  return { risk, arrival_min, arrival_max, lateness_min, lateness_max, reason, affected }
}

/** Response options in the order wait, reroute, request_slot; [] when none. */
export function getResponseOptions(shipmentId: string, scenario: Scenario): EngineResponseOption[] {
  return getShipment(shipmentId) ? getShipmentAssessment(shipmentId, scenario).options : []
}

/** Normal-scenario metrics on the assigned route. Throws for an unknown id. */
export function getBaseline(shipmentId: string): Baseline {
  const baseline = getShipmentAssessment(shipmentId, 'normal').baseline
  return {
    miles: baseline.miles,
    cost: baseline.cost!,
    co2_kg: baseline.co2_kg,
    driver_duty_min: baseline.driver_duty_min!,
  }
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
