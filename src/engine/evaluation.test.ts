import { describe, expect, it } from 'vitest'
import { assumptions, routes, sampleIncident, segments, shipments } from '../data'
import type { Decision } from '../types'
import { compareScenarios, evaluateAll } from './evaluation'
import type { ComparisonScenario, EvaluationTotals } from './evaluation'
import { assessShipment } from './responses'
import type { EngineData } from './responses'

const data: EngineData = { routes, segments }
const reference = shipments.find((shipment) => shipment.id === 'S-01')!
const timestamp = '2026-11-14T18:00:00.000Z'
const decision = (shipment_id: string, option_kind: Decision['option_kind'], status: Decision['status']): Decision =>
  ({ shipment_id, option_kind, status, timestamp })

// Independently calculated from the ArcGIS inputs, the sourced cost and CO2 inputs in
// assumptions.json and the stored corridor analysis: per shipment, normal is $103 (WH-A),
// $93 (WH-B) and $42 (WH-C); waiting at the closure is $138, $129, $126, $122, $104 and $128
// for S-01, S-02, S-03, S-04, S-05 and S-07; a reroute is $132 (WH-A) and $109 (WH-B).
const EXPECTED: Record<ComparisonScenario, EvaluationTotals> = {
  normal: {
    late: 0, tightOrUnknown: 0, latenessMax: 0, cost: 817, addedMiles: 0,
    co2Kg: 522.7, pending: 0, addedDriverDuty: 0, flaggedRoutes: 10,
  },
  disrupted_no_action: {
    late: 3, tightOrUnknown: 1, latenessMax: 132, cost: 976, addedMiles: 0,
    co2Kg: 522.7, pending: 0, addedDriverDuty: 263, flaggedRoutes: 10,
  },
  disrupted_selected_responses: {
    late: 2, tightOrUnknown: 0, latenessMax: 84, cost: 951, addedMiles: 20,
    co2Kg: 552.7, pending: 2, addedDriverDuty: 176, flaggedRoutes: 10,
  },
}

describe('committed evaluation', () => {
  it('matches normal and disrupted no-action totals using rounded per-shipment estimates', () => {
    expect(evaluateAll(shipments, null, [], data, assumptions)).toMatchObject({
      estimated: true, label: 'SIMULATED', totals: EXPECTED.normal,
    })
    expect(evaluateAll(shipments, sampleIncident, [], data, assumptions).totals)
      .toEqual(EXPECTED.disrupted_no_action)
  })

  it('retains the current wait plan for pending requests, with no savings in any indicator', () => {
    const unchanged = evaluateAll(shipments, sampleIncident, [], data, assumptions)
    const pending = evaluateAll(shipments, sampleIncident, [
      decision('S-01', 'request_slot', 'pending_confirmation'),
      decision('S-04', 'request_slot', 'pending_confirmation'),
    ], data, assumptions)
    expect(pending.totals).toEqual({ ...unchanged.totals, pending: 2 })
    expect(pending.shipments.find((item) => item.shipment_id === 'S-01')).toMatchObject({
      pending: true, plan_kind: 'wait', route_id: 'R-A-ORIG',
      metrics: { risk: 'LATE', lateness_max: 42, cost: 138, driver_duty_min: 132 },
    })
    expect(pending.shipments.map((item) => item.metrics)).toEqual(unchanged.shipments.map((item) => item.metrics))
  })

  it('ignores a valid preview, but applies an explicitly selected reroute', () => {
    const noAction = evaluateAll([reference], sampleIncident, [], data, assumptions)
    expect(evaluateAll([reference], sampleIncident, [
      decision('S-01', 'reroute', 'previewed'),
    ], data, assumptions)).toEqual(noAction)
    expect(evaluateAll([reference], sampleIncident, [
      decision('S-01', 'request_slot', 'previewed'),
    ], data, assumptions)).toEqual(noAction)
    expect(evaluateAll([reference], sampleIncident, [
      decision('S-01', 'reroute', 'selected'),
    ], data, assumptions)).toMatchObject({
      totals: {
        late: 0, tightOrUnknown: 0, latenessMax: 0, cost: 132, addedMiles: 15,
        co2Kg: 90.1, pending: 0, addedDriverDuty: 14, flaggedRoutes: 1,
      },
      shipments: [{ plan_kind: 'reroute', route_id: 'R-A-ALT', pending: false, metrics: { risk: 'ON_TRACK' } }],
    })
  })

  it('keeps unknown aggregate lateness, cost and added duty null rather than converting to zero', () => {
    const unknown = { ...sampleIncident, reported_reopen_time: null, assumed_reopen_time: null }
    const result = evaluateAll([reference], unknown, [
      decision('S-01', 'request_slot', 'pending_confirmation'),
    ], data, assumptions)
    expect(result.totals).toEqual({
      late: 0, tightOrUnknown: 1, latenessMax: null, cost: null, addedMiles: 0,
      co2Kg: 67.6, pending: 1, addedDriverDuty: null, flaggedRoutes: 1,
    })
    const mixed = evaluateAll(shipments, unknown, [], data, assumptions)
    expect(mixed.totals).toMatchObject({
      tightOrUnknown: 7, latenessMax: null, cost: null, addedDriverDuty: null,
    })
    expect(mixed.shipments).toHaveLength(10)
  })

  it('counts sensitive-route uses per shipment rather than unique route ids', () => {
    const repeatedRoute = shipments.filter((shipment) => shipment.id === 'S-01' || shipment.id === 'S-02')
    const result = evaluateAll(repeatedRoute, sampleIncident, [
      decision('S-01', 'reroute', 'selected'), decision('S-02', 'reroute', 'selected'),
    ], data, assumptions)
    expect(result.shipments.filter((item) => item.route_id === 'R-A-ALT')).toHaveLength(2)
    expect(result.totals.flaggedRoutes).toBe(2)
  })
})

describe('decision validation', () => {
  it('rejects unknown shipment ids, missing response kinds and invalid statuses', () => {
    expect(() => evaluateAll(shipments, sampleIncident, [decision('missing', 'wait', 'selected')], data, assumptions))
      .toThrow(/Unknown decision shipment/)
    expect(() => evaluateAll(shipments, sampleIncident, [
      { ...decision('S-01', 'wait', 'selected'), option_kind: 'fly' } as unknown as Decision,
    ], data, assumptions)).toThrow(/No response fly/)
    expect(() => evaluateAll(shipments, sampleIncident, [
      { ...decision('S-01', 'wait', 'selected'), status: 'confirmed' } as unknown as Decision,
    ], data, assumptions)).toThrow(/Invalid decision status/)
  })

  it('rejects invalid confirmation combinations and duplicate/ambiguous decisions', () => {
    for (const invalid of [
      decision('S-01', 'request_slot', 'selected'), decision('S-01', 'wait', 'pending_confirmation'),
      decision('S-01', 'reroute', 'pending_confirmation'),
    ]) {
      expect(() => evaluateAll(shipments, sampleIncident, [invalid], data, assumptions))
        .toThrow(/Request later slot must be pending_confirmation/)
    }
    expect(() => evaluateAll(shipments, sampleIncident, [
      decision('S-01', 'wait', 'selected'), decision('S-01', 'reroute', 'selected'),
    ], data, assumptions)).toThrow(/Duplicate decision/)
  })

  it('rejects unavailable reroutes even for previews and refuses responses on unaffected shipments', () => {
    const noAlternative = { ...data, routes: routes.filter((route) => route.id !== 'R-A-ALT') }
    for (const status of ['selected', 'previewed'] as const) {
      expect(() => evaluateAll(shipments, sampleIncident, [
        decision('S-01', 'reroute', status),
      ], noAlternative, assumptions)).toThrow(/is unavailable/)
    }
    expect(() => evaluateAll(shipments, null, [decision('S-01', 'wait', 'selected')], data, assumptions))
      .toThrow(/No response wait/)
    expect(() => evaluateAll(shipments, sampleIncident, [decision('S-08', 'wait', 'selected')], data, assumptions))
      .toThrow(/No response wait/)
    expect(() => evaluateAll([...shipments, reference], sampleIncident, [], data, assumptions))
      .toThrow(/Duplicate shipment id/)
  })
})

describe('reproducible nine-row scenario comparison', () => {
  it('matches all three independently calculated columns and exports units, rules and simulation labels', () => {
    const rows = compareScenarios(shipments, sampleIncident, data, assumptions)
    expect(rows).toHaveLength(9)
    expect(new Set(rows.map((row) => row.id)).size).toBe(9)
    expect(rows.map((row) => row.id)).toEqual([
      'late', 'tightOrUnknown', 'latenessMax', 'cost', 'addedMiles',
      'co2Kg', 'pending', 'addedDriverDuty', 'flaggedRoutes',
    ])
    for (const row of rows) {
      expect(row).toMatchObject({
        estimated: true, data_label: 'SIMULATED',
        simulation: { unknown_totals: 'null, never zero', aggregation: 'sum displayed rounded per-shipment estimates' },
      })
      expect(row.label.length).toBeGreaterThan(0)
      expect(row.unit.length).toBeGreaterThan(0)
      expect(row.rule.length).toBeGreaterThan(0)
      for (const scenario of Object.keys(EXPECTED) as ComparisonScenario[]) {
        expect(row.values[scenario], `${row.id}: ${scenario}`).toBe(EXPECTED[scenario][row.id])
        expect(row.simulation.scenario_labels[scenario].length).toBeGreaterThan(0)
      }
    }
    expect(rows[8].unit).toBe('shipment-route uses')
    expect(rows[8].rule).toContain('NOT unique route ids')
  })

  it('selects only the evaluation rule: S-01/S-07 reroute, S-02/S-05 wait, S-03/S-04 pending', () => {
    const rows = compareScenarios(shipments, sampleIncident, data, assumptions)
    expect(rows[0].simulation.selected_responses).toEqual([
      { shipment_id: 'S-01', option_kind: 'reroute', status: 'selected' },
      { shipment_id: 'S-02', option_kind: 'wait', status: 'selected' },
      { shipment_id: 'S-03', option_kind: 'request_slot', status: 'pending_confirmation' },
      { shipment_id: 'S-04', option_kind: 'request_slot', status: 'pending_confirmation' },
      { shipment_id: 'S-05', option_kind: 'wait', status: 'selected' },
      { shipment_id: 'S-07', option_kind: 'reroute', status: 'selected' },
    ])
    expect(rows[0].simulation.selection_rule).toContain('Evaluation only')
    expect(rows[0].simulation.selection_rule).toContain('does not select or rank UI responses')
    const s04 = assessShipment(shipments.find((shipment) => shipment.id === 'S-04')!, sampleIncident, data, assumptions)
    expect(s04.no_feasible_response).toBe(false)
    expect(s04.options[1].risk).toBe('TIGHT')
  })

  it('breaks equal-mile ON_TRACK ties with Wait first, without changing presentation order', () => {
    const equalMiles: EngineData = {
      ...data,
      segments: segments.map((segment) => segment.id === 'EB-405' ? { ...segment, miles: 25 } : segment),
    }
    const tolerant = { ...reference, appt_start: '11:00', appt_end: '14:00' }
    const assessment = assessShipment(tolerant, sampleIncident, equalMiles, assumptions)
    expect(assessment.options.slice(0, 2).map((option) => [option.kind, option.risk, option.added_miles]))
      .toEqual([['wait', 'ON_TRACK', 0], ['reroute', 'ON_TRACK', 0]])
    expect(compareScenarios([tolerant], sampleIncident, equalMiles, assumptions)[0].simulation.selected_responses)
      .toEqual([{ shipment_id: 'S-01', option_kind: 'wait', status: 'selected' }])
    expect(assessment.options.map((option) => option.kind)).toEqual(['wait', 'reroute', 'request_slot'])
  })

  it('chooses fewer added miles even if the reroute would otherwise be later in presentation order', () => {
    const shorter: EngineData = {
      ...data, segments: segments.map((segment) => segment.id === 'EB-405' ? { ...segment, miles: 20 } : segment),
    }
    const tolerant = { ...reference, appt_end: '14:00' }
    expect(compareScenarios([tolerant], sampleIncident, shorter, assumptions)[0].simulation.selected_responses)
      .toEqual([{ shipment_id: 'S-01', option_kind: 'reroute', status: 'selected' }])
  })

  it('preserves unknown totals in comparison rows and requests a slot when neither plan is known ON_TRACK', () => {
    const unknown = { ...sampleIncident, reported_reopen_time: null, assumed_reopen_time: null }
    const rows = compareScenarios([
      shipments.find((shipment) => shipment.id === 'S-03')!,
    ], unknown, data, assumptions)
    expect(rows.find((row) => row.id === 'cost')!.values).toMatchObject({
      disrupted_no_action: null, disrupted_selected_responses: null,
    })
    expect(rows[0].simulation.selected_responses).toEqual([
      { shipment_id: 'S-03', option_kind: 'request_slot', status: 'pending_confirmation' },
    ])
    expect(rows.find((row) => row.id === 'pending')!.values.disrupted_selected_responses).toBe(1)
  })

  it('is deterministic, does not mutate explicit inputs and yields identical columns for no incident', () => {
    const input = structuredClone({ shipments, incident: sampleIncident, data, assumptions })
    const before = JSON.stringify(input)
    const rows = compareScenarios(input.shipments, input.incident, input.data, input.assumptions)
    expect(compareScenarios(input.shipments, input.incident, input.data, input.assumptions)).toEqual(rows)
    expect(JSON.stringify(input)).toBe(before)
    for (const row of compareScenarios(shipments, null, data, assumptions)) {
      expect(row.values).toEqual({
        normal: EXPECTED.normal[row.id], disrupted_no_action: EXPECTED.normal[row.id],
        disrupted_selected_responses: EXPECTED.normal[row.id],
      })
      expect(row.simulation.selected_responses).toEqual([])
    }
  })
})
