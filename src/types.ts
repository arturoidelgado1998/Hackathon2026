// Shared PortPlan entities. Every later issue imports from here.
// Field names are fixed by issue #2 (D1); do not rename them.

/** 24-hour "HH:MM" clock time on the single demo day, e.g. "07:45". */
export type TimeHHMM = string

/** Delivery risk label for a shipment or response option. */
export type RiskLabel = 'ON_TRACK' | 'TIGHT' | 'LATE' | 'UNKNOWN'

/** [longitude, latitude] (GeoJSON coordinate order). */
export type LonLat = [number, number]

/** Minimal GeoJSON LineString geometry. */
export interface LineStringGeometry {
  type: 'LineString'
  coordinates: LonLat[]
}

export type FacilityType = 'port' | 'warehouse'

export interface Facility {
  id: string
  name: string
  type: FacilityType
  lat: number
  lon: number
}

export interface RoadSegment {
  id: string
  name: string
  geometry: LineStringGeometry | null
  miles: number
  minutes_min: number
  minutes_max: number
  near_sensitive_zone: boolean
  sensitive_zone_note: string
}

export type RouteKind = 'original' | 'alternative'

export interface Route {
  id: string
  /** Facility id. */
  origin: string
  /** Facility id. */
  destination: string
  /** RoadSegment ids, in travel order. */
  segment_ids: string[]
  kind: RouteKind
  truck_suitability_note: string
  near_sensitive_zone: boolean
  sensitive_zone_note?: string
  schools_150m: number | null
  dac_tracts: string[] | null
  max_diesel_pm_pctl: number | null
}

export interface Shipment {
  id: string
  /** Facility id of the destination warehouse. */
  destination_id: string
  cargo_ready: TimeHHMM
  truck_available: TimeHHMM
  appt_start: TimeHHMM
  appt_end: TimeHHMM
  /** Route id. */
  assigned_route_id: string
}

export type IncidentType = 'closure'

export interface Incident {
  /** RoadSegment id. */
  segment_id: string
  type: IncidentType
  start_time: TimeHHMM
  reported_reopen_time: TimeHHMM | null
  assumed_reopen_time: TimeHHMM | null
  evidence_text: string
  confirmed_by_user: boolean
}

export interface Assumptions {
  pickup_handling_min: number
  mpg: number
  nonlabor_cost_per_mile: number
  labor_rate_per_hr: number
  diesel_kgCO2_per_gal: number
  /** Assumption field name -> citation string. */
  sources: Record<string, string>
}

export type ResponseOptionKind = 'wait' | 'reroute' | 'request_slot'

export interface ResponseOption {
  kind: ResponseOptionKind
  arrival_min: TimeHHMM | null
  arrival_max: TimeHHMM | null
  /** Minutes late against appt_end. */
  lateness_min: number | null
  /** Minutes late against appt_end. */
  lateness_max: number | null
  risk: RiskLabel
  miles: number | null
  cost: number | null
  co2_kg: number | null
  requires_confirmation: boolean
  status: string
  explanation_inputs: string[]
  driver_duty_min: number | null
  passes_sensitive_zone: boolean
  stakeholder_notes: string[]
}

export type DecisionStatus = 'previewed' | 'selected' | 'pending_confirmation'

export interface Decision {
  shipment_id: string
  option_kind: ResponseOptionKind
  status: DecisionStatus
  /** ISO 8601 timestamp of when the decision was recorded. */
  timestamp: string
}
