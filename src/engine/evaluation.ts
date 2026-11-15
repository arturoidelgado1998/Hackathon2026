import type { Assumptions, Decision, Incident, ResponseOptionKind, Shipment } from '../types.ts'
import type { MetricsResult } from './metrics.ts'
import { assessShipment } from './responses.ts'
import type { EngineData, ShipmentAssessment } from './responses.ts'

export interface EvaluationTotals {
  late: number
  tightOrUnknown: number
  latenessMax: number | null
  cost: number | null
  addedMiles: number | null
  co2Kg: number | null
  pending: number
  addedDriverDuty: number | null
  /** Per-shipment route uses, NOT the number of unique route ids. */
  flaggedRoutes: number
}

export interface EvaluatedShipment {
  shipment_id: string
  plan_kind: 'wait' | 'reroute'
  route_id: string
  pending: boolean
  metrics: MetricsResult
  baseline: MetricsResult
}

export interface EvaluationResult {
  estimated: true
  label: 'SIMULATED'
  totals: EvaluationTotals
  shipments: EvaluatedShipment[]
}

export type EvaluationSelection = Pick<Decision, 'shipment_id' | 'option_kind' | 'status'>

export const EVALUATION_SELECTION_RULE =
  'Evaluation only: choose an available ON_TRACK Wait or Reroute whose full service range meets the original appointment, with the fewest added miles versus the assigned normal route; ties use Wait before Reroute. If neither is ON_TRACK, request a later slot and retain the current Wait metrics until confirmation. Unaffected shipments keep their assigned route. This rule does not select or rank UI responses.'

function assessments(
  shipments: readonly Shipment[], incident: Incident | null, data: EngineData, assumptions: Assumptions,
): Map<string, ShipmentAssessment> {
  const result = new Map<string, ShipmentAssessment>()
  for (const shipment of shipments) {
    if (result.has(shipment.id)) throw new RangeError(`Duplicate shipment id: ${shipment.id}`)
    result.set(shipment.id, assessShipment(shipment, incident, data, assumptions))
  }
  return result
}

function sumKnown(values: readonly (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null
  // Sum E2's displayed per-shipment estimates, removing only floating-point noise.
  return Number(values.reduce<number>((total, value) => total + value!, 0).toFixed(10))
}

/** Totals for assessments the caller already has (a live day re-times a late reroute). */
export function evaluateAssessments(
  shipments: readonly Shipment[],
  assessed: ReadonlyMap<string, ShipmentAssessment>,
  decisions: readonly EvaluationSelection[],
): EvaluationResult {
  const committed = new Map<string, EvaluationSelection>()
  const seen = new Set<string>()
  for (const decision of decisions) {
    const assessment = assessed.get(decision.shipment_id)
    if (!assessment) throw new RangeError(`Unknown decision shipment: ${decision.shipment_id}`)
    if (seen.has(decision.shipment_id)) throw new RangeError(`Duplicate decision for ${decision.shipment_id}`)
    seen.add(decision.shipment_id)
    if (!['previewed', 'selected', 'pending_confirmation'].includes(decision.status)) {
      throw new RangeError(`Invalid decision status: ${decision.status}`)
    }
    const option = assessment.options.find((item) => item.kind === decision.option_kind)
    if (!option) throw new RangeError(`No response ${decision.option_kind} for ${decision.shipment_id}`)
    if (!option.available) throw new RangeError(`Response ${decision.option_kind} is unavailable for ${decision.shipment_id}`)
    if (decision.status === 'previewed') continue
    if ((decision.status === 'pending_confirmation') !== (decision.option_kind === 'request_slot')) {
      throw new RangeError('Request later slot must be pending_confirmation; driving responses must be selected')
    }
    committed.set(decision.shipment_id, decision)
  }
  const evaluated: EvaluatedShipment[] = shipments.map((shipment) => {
    const assessment = assessed.get(shipment.id)!
    const decision = committed.get(shipment.id)
    const reroute = decision?.option_kind === 'reroute'
      ? assessment.options.find((option) => option.kind === 'reroute')!
      : null
    return {
      shipment_id: shipment.id,
      plan_kind: reroute ? 'reroute' : 'wait',
      route_id: reroute ? reroute.route_id! : shipment.assigned_route_id,
      pending: decision?.status === 'pending_confirmation',
      metrics: reroute ? reroute.metrics! : assessment.current,
      baseline: assessment.baseline,
    }
  })
  return {
    estimated: true, label: 'SIMULATED', shipments: evaluated,
    totals: {
      late: evaluated.filter((item) => item.metrics.risk === 'LATE').length,
      tightOrUnknown: evaluated.filter((item) => ['TIGHT', 'UNKNOWN'].includes(item.metrics.risk)).length,
      latenessMax: sumKnown(evaluated.map((item) => item.metrics.lateness_max)),
      cost: sumKnown(evaluated.map((item) => item.metrics.cost)),
      addedMiles: sumKnown(evaluated.map((item) => item.metrics.miles - item.baseline.miles)),
      co2Kg: sumKnown(evaluated.map((item) => item.metrics.co2_kg)),
      pending: evaluated.filter((item) => item.pending).length,
      addedDriverDuty: sumKnown(evaluated.map((item) => item.metrics.driver_duty_increase_min)),
      flaggedRoutes: evaluated.filter((item) => item.metrics.passes_sensitive_zone).length,
    },
  }
}

/** Previews do not commit a plan. Pending appointments retain the original Wait risk and all metrics. */
export function evaluateAll(
  shipments: readonly Shipment[],
  incident: Incident | null,
  decisions: readonly Decision[],
  data: EngineData,
  assumptions: Assumptions,
): EvaluationResult {
  return evaluateAssessments(shipments, assessments(shipments, incident, data, assumptions), decisions)
}

function evaluationSelections(assessed: ReadonlyMap<string, ShipmentAssessment>): EvaluationSelection[] {
  const result: EvaluationSelection[] = []
  for (const [shipmentId, assessment] of assessed) {
    if (!assessment.summary.affected) continue
    let best: { kind: ResponseOptionKind; addedMiles: number } | null = null
    // The presentation order already provides the deterministic Wait-before-Reroute tie break.
    for (const option of assessment.options) {
      if (option.kind === 'request_slot' || !option.available || option.metrics?.risk !== 'ON_TRACK') continue
      if (best === null || option.added_miles! < best.addedMiles) {
        best = { kind: option.kind, addedMiles: option.added_miles! }
      }
    }
    result.push({
      shipment_id: shipmentId,
      option_kind: best?.kind ?? 'request_slot',
      status: best ? 'selected' : 'pending_confirmation',
    })
  }
  return result
}

export type ComparisonScenario = 'normal' | 'disrupted_no_action' | 'disrupted_selected_responses'

export interface ScenarioComparisonRow {
  id: keyof EvaluationTotals
  label: string
  unit: 'shipments' | 'minutes' | 'USD' | 'miles' | 'kg' | 'shipment-route uses'
  rule: string
  estimated: true
  data_label: 'SIMULATED'
  values: Record<ComparisonScenario, number | null>
  simulation: {
    selection_rule: string
    scenario_labels: Record<ComparisonScenario, string>
    selected_responses: EvaluationSelection[]
    unknown_totals: 'null, never zero'
    aggregation: 'sum displayed rounded per-shipment estimates'
  }
}

const ROWS: Pick<ScenarioComparisonRow, 'id' | 'label' | 'unit' | 'rule'>[] = [
  { id: 'late', label: 'Shipments LATE', unit: 'shipments', rule: 'Count shipments with E2 risk LATE, including pending requests.' },
  { id: 'tightOrUnknown', label: 'Shipments TIGHT or UNKNOWN', unit: 'shipments', rule: 'Count shipments with E2 risk TIGHT or UNKNOWN; neither is counted as saved.' },
  { id: 'latenessMax', label: 'Total lateness (max case)', unit: 'minutes', rule: 'Sum E2 maximum lateness under the original appointments; null if any value is unknown.' },
  { id: 'cost', label: 'Estimated operating cost', unit: 'USD', rule: 'Sum E2 rounded whole-dollar per-shipment mileage-plus-labor costs; null if any cost is unknown.' },
  { id: 'addedMiles', label: 'Added miles versus normal', unit: 'miles', rule: 'Sum per-shipment route miles minus assigned-route normal miles; signed differences.' },
  { id: 'co2Kg', label: 'Estimated tailpipe CO2', unit: 'kg', rule: 'Sum E2 per-shipment tailpipe CO2 rounded to 0.1 kg; excludes engine-off closure waiting.' },
  { id: 'pending', label: 'Pending later-slot requests', unit: 'shipments', rule: 'Count pending_confirmation requests; retain their current Wait metrics, not hypothetical savings.' },
  { id: 'addedDriverDuty', label: 'Added driver duty versus normal', unit: 'minutes', rule: 'Sum E2 signed duty increases against each assigned original-route normal baseline; null if any increase is unknown.' },
  { id: 'flaggedRoutes', label: 'Routes passing flagged zones', unit: 'shipment-route uses', rule: 'Count per-shipment route uses flagged near_sensitive_zone, NOT unique route ids or measured exposure.' },
]

/** Exactly nine SIMULATED rows. The conservative selection rule is evaluation-only. */
export function compareScenarios(
  shipments: readonly Shipment[],
  incident: Incident | null,
  data: EngineData,
  assumptions: Assumptions,
): ScenarioComparisonRow[] {
  const normal = evaluateAll(shipments, null, [], data, assumptions)
  const disruptedAssessments = assessments(shipments, incident, data, assumptions)
  const noAction = evaluateAssessments(shipments, disruptedAssessments, [])
  const selections = evaluationSelections(disruptedAssessments)
  const selected = evaluateAssessments(shipments, disruptedAssessments, selections)
  return ROWS.map((row) => ({
    ...row, estimated: true, data_label: 'SIMULATED',
    values: {
      normal: normal.totals[row.id],
      disrupted_no_action: noAction.totals[row.id],
      disrupted_selected_responses: selected.totals[row.id],
    },
    simulation: {
      selection_rule: EVALUATION_SELECTION_RULE,
      scenario_labels: {
        normal: 'Normal',
        disrupted_no_action: 'Disrupted — no action',
        disrupted_selected_responses: 'Disrupted — selected responses (evaluation rule)',
      },
      selected_responses: selections.map((selection) => ({ ...selection })),
      unknown_totals: 'null, never zero',
      aggregation: 'sum displayed rounded per-shipment estimates',
    },
  }))
}
