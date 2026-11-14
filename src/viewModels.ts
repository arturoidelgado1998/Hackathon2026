// Shared view-model types for the dashboard (Phase 1).
// The data module (src/data), the board, the response panel and the app
// shell all import these, so the pieces can be built in parallel.
// These types describe what is displayed. They contain no calculations.

import type {
  Decision,
  ResponseOption,
  ResponseOptionKind,
  RiskLabel,
  Shipment,
  TimeHHMM,
} from './types'

/** Which scenario the dashboard is showing. */
export type Scenario = 'normal' | 'disrupted'

/** Workflow column on the triage board. Independent of calculated risk. */
export type BoardColumn =
  | 'monitoring'
  | 'needs_review'
  | 'awaiting_confirmation'
  | 'decision_recorded'

/** Listed in the order a dispatcher works them: what needs attention first. */
export const BOARD_COLUMNS: { id: BoardColumn; title: string }[] = [
  { id: 'needs_review', title: 'Needs review' },
  { id: 'awaiting_confirmation', title: 'Awaiting confirmation' },
  { id: 'decision_recorded', title: 'Decision recorded' },
  { id: 'monitoring', title: 'Monitoring' },
]

/** One shipment's current status in one scenario. All values are estimates. */
export interface ShipmentSummary {
  risk: RiskLabel
  arrival_min: TimeHHMM | null
  arrival_max: TimeHHMM | null
  /** Minutes late against appt_end, min-arrival case. */
  lateness_min: number | null
  /** Minutes late against appt_end, max-arrival case. */
  lateness_max: number | null
  /** One line, e.g. "Route uses closed segment NB-03". */
  reason: string
  /** True when the current incident changes this shipment's timing. */
  affected: boolean
}

/** A shipment's metrics in the normal scenario, used to show increases. */
export interface Baseline {
  miles: number
  cost: number
  co2_kg: number
  driver_duty_min: number
}

/** Everything a board card displays. */
export interface ShipmentCardView {
  shipment: Shipment
  destinationName: string
  summary: ShipmentSummary
  column: BoardColumn
  /** E3 estimates; only affected shipments carry incident decision deadlines. */
  incidentSegmentId?: string
  reopen_needed_by?: TimeHHMM | null
  reroute_decide_by?: TimeHHMM | null
  no_feasible_response?: boolean
  /** Committed choice only; previews never change the queue. */
  decision?: Decision
  rejectionNote?: string
}

/** Sensitive-zone facts for the route an option would use. Null until G3. */
export interface CommunityInfo {
  schools_150m: number | null
  dac_tracts: string[] | null
  max_diesel_pm_pctl: number | null
}

/** Everything the response panel displays for the selected shipment. */
export interface ResponsePanelView {
  shipment: Shipment
  destinationName: string
  /** The shipment's current status, shown above the comparison. */
  summary?: ShipmentSummary
  /** Wait, Reroute, Request later slot. Empty when the shipment has none. */
  options: ResponseOption[]
  baseline: Baseline
  /** Community facts per option kind; missing kinds have no route. */
  community: Partial<Record<ResponseOptionKind, CommunityInfo>>
}
