import { afterEach, describe, expect, it, vi } from 'vitest'
import * as data from '../data/index.ts'
import type { Baseline } from '../viewModels.ts'
import type { Decision } from '../types.ts'
import { initialState, type AppState } from './reducer.ts'
import { getTotals } from './totals.ts'

const timestamp = '2026-11-14T12:00:00.000Z'
const normal: AppState = { ...initialState, scenario: 'normal' }
const disrupted: AppState = { ...normal, scenario: 'disrupted' }

function decision(
  option_kind: Decision['option_kind'],
  shipment_id = 'SHP-001',
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
  it('sums the normal baseline, including the unaffected TIGHT shipment', () => {
    expectTotals(normal, 1, 1175, 648.8)
  })

  it('uses supplied wait metrics for affected shipments and baselines for the rest', () => {
    expectTotals(disrupted, 5, 1348, 648.8)
  })

  it.each([
    ['wait', 'SHP-001', 5, 1348, 648.8],
    ['reroute', 'SHP-001', 4, 1345, 672.3],
    ['reroute', 'SHP-004', 5, 1355, 672.3],
  ] as const)('uses the recorded %s response for %s', (kind, id, atRisk, cost, co2Kg) => {
    expectTotals(withDecision(decision(kind, id)), atRisk, cost, co2Kg)
  })

  it('sums multiple recorded responses together', () => {
    expectTotals({
      ...disrupted,
      decisions: {
        'SHP-001': decision('reroute'),
        'SHP-003': decision('reroute', 'SHP-003'),
      },
    }, 4, 1362, 695.8)
  })

  it.each(['SHP-001', 'SHP-003'])(
    'keeps wait metrics and risk while %s awaits slot confirmation',
    (shipmentId) => {
      expectTotals(
        withDecision(decision('request_slot', shipmentId, 'pending_confirmation')),
        5, 1348, 648.8,
      )
    },
  )

  it('does not count a preview as a recorded decision', () => {
    expectTotals({
      ...disrupted,
      previewDecision: decision('reroute', 'SHP-001', 'previewed'),
    }, 5, 1348, 648.8)
  })

  it.each([
    ['wait', 'SHP-001'],
    ['reroute', 'SHP-004'],
  ] as const)('preserves selected totals while previewing %s for %s', (kind, shipmentId) => {
    expectTotals({
      ...withDecision(decision('reroute')),
      previewDecision: decision(kind, shipmentId, 'previewed'),
    }, 4, 1345, 672.3)
  })

  it('does not change current metrics when all responses are rejected', () => {
    expectTotals({ ...disrupted, rejectedShipmentIds: ['SHP-001'] }, 5, 1348, 648.8)
  })

  it('counts an UNKNOWN current response as at risk', () => {
    const readOptions = data.getResponseOptions
    vi.spyOn(data, 'getResponseOptions').mockImplementation((id, scenario) =>
      readOptions(id, scenario).map((option) =>
        id === 'SHP-003' && option.kind === 'wait' ? { ...option, risk: 'UNKNOWN' } : option,
      ),
    )
    expectTotals(disrupted, 6, 1348, 648.8)
  })

  it('keeps a missing selected cost unknown without dropping its known CO2', () => {
    const readOptions = data.getResponseOptions
    vi.spyOn(data, 'getResponseOptions').mockImplementation((id, scenario) =>
      readOptions(id, scenario).map((option) =>
        id === 'SHP-001' && option.kind === 'reroute' ? { ...option, cost: null } : option,
      ),
    )
    const actual = getTotals(withDecision(decision('reroute')))
    expect(actual.atRisk).toBe(4)
    expect(actual.cost).toBeNull()
    expect(actual.co2Kg).toBeCloseTo(672.3, 6)
  })

  it('keeps missing wait CO2 unknown while a slot request remains pending', () => {
    const readOptions = data.getResponseOptions
    vi.spyOn(data, 'getResponseOptions').mockImplementation((id, scenario) =>
      readOptions(id, scenario).map((option) =>
        id === 'SHP-001' && option.kind === 'wait' ? { ...option, co2_kg: null } : option,
      ),
    )
    expect(getTotals(withDecision(
      decision('request_slot', 'SHP-001', 'pending_confirmation'),
    ))).toEqual({ atRisk: 5, cost: 1348, co2Kg: null })
  })

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not silently omit an unknown baseline cost (%s)',
    (cost) => {
      const readBaseline = data.getBaseline
      vi.spyOn(data, 'getBaseline').mockImplementation((id) =>
        id === 'SHP-002'
          ? { ...readBaseline(id), cost } as unknown as Baseline
          : readBaseline(id),
      )
      const actual = getTotals(disrupted)
      expect(actual.cost).toBeNull()
      expect(actual.co2Kg).toBeCloseTo(648.8, 6)
    },
  )

  it.each([
    decision('request_slot'),
    decision('reroute', 'SHP-001', 'pending_confirmation'),
    decision('wait', 'SHP-001', 'previewed'),
    decision('reroute', 'SHP-006'),
    decision('wait', 'SHP-002'),
    decision('wait', 'missing'),
  ])('surfaces invalid committed decisions rather than using a successful fallback', (value) => {
    expect(() => getTotals(withDecision(value))).toThrow(/Invalid committed decision/)
  })

  it('rejects a decision keyed under a different shipment', () => {
    expect(() => getTotals({
      ...disrupted,
      decisions: { 'SHP-003': decision('reroute') },
    })).toThrow(/Invalid committed decision/)
  })

  it('surfaces a missing wait response rather than substituting the baseline', () => {
    const readOptions = data.getResponseOptions
    vi.spyOn(data, 'getResponseOptions').mockImplementation((id, scenario) =>
      readOptions(id, scenario).filter((option) => id !== 'SHP-001' || option.kind !== 'wait'),
    )
    expect(() => getTotals(disrupted)).toThrow(/No current response metrics for SHP-001/)
  })
})
