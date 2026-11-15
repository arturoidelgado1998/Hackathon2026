import { afterEach, describe, expect, it, vi } from 'vitest'
import * as data from '../data/index.ts'
import type { Decision } from '../types.ts'
import { initialState, type AppState } from './reducer.ts'
import { getTotals } from './totals.ts'

const timestamp = '2026-11-14T12:00:00.000Z'
const normal: AppState = { ...initialState, scenario: 'normal' }
const disrupted: AppState = { ...normal, scenario: 'disrupted' }

function decision(
  option_kind: Decision['option_kind'],
  shipment_id = 'S-01',
  status: Decision['status'] = 'selected',
): Decision {
  return { shipment_id, option_kind, status, timestamp }
}

function withDecision(value: Decision): AppState {
  return { ...disrupted, decisions: { [value.shipment_id]: value } }
}

function expectTotals(state: AppState, atRisk: number, cost: number, co2Kg: number) {
  const actual = getTotals(state)
  expect(actual.atRisk).toBe(atRisk)
  expect(actual.cost).toBeCloseTo(cost, 6)
  expect(actual.co2Kg).toBeCloseTo(co2Kg, 6)
}

afterEach(() => vi.restoreAllMocks())

describe('getTotals', () => {
  it('sums the normal baseline, with no shipment at risk', () => {
    expectTotals(normal, 0, 817, 522.7)
  })

  it('calculates current wait metrics for affected shipments and normal metrics for the rest', () => {
    expectTotals(disrupted, 4, 976, 522.7)
  })

  it.each([
    ['wait', 'S-01', 4, 976, 522.7],
    ['reroute', 'S-01', 3, 970, 545.2],
    ['reroute', 'S-03', 4, 982, 545.2],
  ] as const)('uses the recorded %s response for %s', (kind, id, atRisk, cost, co2Kg) => {
    expectTotals(withDecision(decision(kind, id)), atRisk, cost, co2Kg)
  })

  it('sums multiple recorded responses together', () => {
    expectTotals({
      ...disrupted,
      decisions: {
        'S-01': decision('reroute'),
        'S-02': decision('reroute', 'S-02'),
      },
    }, 3, 973, 567.7)
  })

  it.each(['S-01', 'S-02'])(
    'keeps wait metrics and risk while %s awaits slot confirmation',
    (shipmentId) => {
      expectTotals(
        withDecision(decision('request_slot', shipmentId, 'pending_confirmation')),
        4, 976, 522.7,
      )
    },
  )

  it('does not count a preview as a recorded decision', () => {
    expectTotals({
      ...disrupted,
      previewDecision: decision('reroute', 'S-01', 'previewed'),
    }, 4, 976, 522.7)
  })

  it.each([
    ['wait', 'S-01'],
    ['reroute', 'S-03'],
  ] as const)('preserves selected totals while previewing %s for %s', (kind, shipmentId) => {
    expectTotals({
      ...withDecision(decision('reroute')),
      previewDecision: decision(kind, shipmentId, 'previewed'),
    }, 3, 970, 545.2)
  })

  it('does not change current metrics when all responses are rejected', () => {
    expectTotals({ ...disrupted, rejectedShipmentIds: ['S-01'] }, 4, 976, 522.7)
  })

  it('counts engine UNKNOWN risk and keeps unknown wait cost null, including pending slots', () => {
    const reopen = data.sampleIncident.reported_reopen_time
    data.sampleIncident.reported_reopen_time = null
    try {
      expect(getTotals(disrupted)).toEqual({ atRisk: 7, cost: null, co2Kg: 522.7 })
      expect(getTotals(withDecision(
        decision('request_slot', 'S-01', 'pending_confirmation'),
      ))).toEqual({ atRisk: 7, cost: null, co2Kg: 522.7 })
    } finally {
      data.sampleIncident.reported_reopen_time = reopen
    }
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'surfaces an invalid raw cost assumption (%s), never a fixture fallback',
    (rate) => {
      const original = data.assumptions.labor_rate_per_hr
      data.assumptions.labor_rate_per_hr = rate
      try {
        expect(() => getTotals(disrupted)).toThrow(/labor_rate_per_hr/)
      } finally {
        data.assumptions.labor_rate_per_hr = original
      }
    },
  )

  it.each([
    decision('request_slot'),
    decision('reroute', 'S-01', 'pending_confirmation'),
    decision('wait', 'S-01', 'previewed'),
    decision('wait', 'S-06'),
    decision('wait', 'missing'),
  ])('surfaces invalid committed decisions rather than using a successful fallback', (value) => {
    expect(() => getTotals(withDecision(value))).toThrow(/Invalid committed decision/)
  })

  it('surfaces a committed decision for an unavailable response', () => {
    const readOptions = data.getResponseOptions
    vi.spyOn(data, 'getResponseOptions').mockImplementation((id, scenario) =>
      readOptions(id, scenario).map((option) =>
        id === 'S-05' && option.kind === 'reroute'
          ? { ...option, arrival_min: null, arrival_max: null, risk: 'UNKNOWN' }
          : option,
      ),
    )
    expect(() => getTotals(withDecision(decision('reroute', 'S-05'))))
      .toThrow(/Invalid committed decision/)
  })

  it('rejects a decision keyed under a different shipment', () => {
    expect(() => getTotals({
      ...disrupted,
      decisions: { 'S-02': decision('reroute') },
    })).toThrow(/Invalid committed decision/)
  })

  it('surfaces missing raw assigned-route data rather than substituting fixture metrics', () => {
    const shipment = data.shipments[0]
    const assigned = shipment.assigned_route_id
    shipment.assigned_route_id = 'missing'
    try {
      expect(() => getTotals(disrupted)).toThrow(/Missing assigned route/)
    } finally {
      shipment.assigned_route_id = assigned
    }
  })
})
