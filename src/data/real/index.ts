// Typed access to the REAL reference data.
// Generated from public Caltrans sources by scripts/import_reference_data.py;
// see README.md in src/data. Do not edit the JSON files by hand.
//
// Reference only. Nothing here feeds a calculation, and nothing here says a
// route is legal or suitable for trucks. The segments these records are
// matched to are SIMULATED and illustrative.

import laneClosuresJson from './lane-closures.json'
import truckNetworkJson from './truck-network.json'

/** Every file in this folder carries this label, never SIMULATED. */
export const REAL_DATA_LABEL = 'REAL' as const

/** "YYYY-MM-DDTHH:MM" in Pacific local time. */
export type LocalDateTime = string

export type LaneClosureStatus = 'planned' | 'in_place' | 'completed' | 'cancelled'

/** One Caltrans lane closure matched to a project segment. */
export interface LaneClosure {
  id: string
  /** RoadSegment id the closure was matched to (approximate). */
  segment_id: string
  /** For example "I-710". */
  route: string
  direction: string
  facility: string
  closure_type: string
  work_type: string
  /** For example "1, 2" or "All". */
  lanes_closed: string
  total_lanes: string
  from: string
  to: string
  lat: number
  lon: number
  planned_start: LocalDateTime | null
  /** Null when the closure has no end date. */
  planned_end: LocalDateTime | null
  actual_start: LocalDateTime | null
  actual_end: LocalDateTime | null
  /** As last seen in the feed. */
  status: LaneClosureStatus
  /** Minutes past the planned end; negative when it ended early; null until completed. */
  ran_over_min: number | null
  /** The record in one sentence. */
  summary: string
  first_seen: string
  last_seen: string
}

export interface ReferenceFileMeta {
  label: typeof REAL_DATA_LABEL
  source_name: string
  source: string
  /** When the import ran, UTC. */
  retrieved: string
  note: string
  matching: string
}

/** Truck designation Caltrans records for one highway along a segment. */
export interface TruckNetworkStretch {
  highway: string
  /** Caltrans code: NN, TA, CL or A; null when none is recorded. */
  designation: string | null
  designation_meaning: string | null
  special_restriction: boolean
  restriction_note: string
  kpra_advisory_ft: string | null
  /** Approximate share of the segment's drawn line, 0 to 1. */
  share_of_segment: number
  recorded_stretches: string[]
}

export interface TruckNetworkEntry {
  segment_id: string
  highways: string[]
  stretches: TruckNetworkStretch[]
  /** Highways the segment follows that the layer has no rows for. */
  no_record_for: string[]
  /** Approximate share of the segment with any record, 0 to 1. */
  share_with_record: number
  note: string
}

const closuresFile = laneClosuresJson as unknown as ReferenceFileMeta & { items: LaneClosure[] }
const truckFile = truckNetworkJson as unknown as ReferenceFileMeta & { items: TruckNetworkEntry[] }

export const laneClosuresMeta: ReferenceFileMeta = closuresFile
export const laneClosures: LaneClosure[] = closuresFile.items

export const truckNetworkMeta: ReferenceFileMeta = truckFile
export const truckNetwork: TruckNetworkEntry[] = truckFile.items

/** Real closures matched to a segment, earliest planned start first. */
export function getLaneClosuresForSegment(segmentId: string): LaneClosure[] {
  return laneClosures.filter((c) => c.segment_id === segmentId)
}

/** The recorded truck designation along a segment, if the segment is known. */
export function getTruckNetworkForSegment(segmentId: string): TruckNetworkEntry | undefined {
  return truckNetwork.find((t) => t.segment_id === segmentId)
}
