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
    expectTotals(normal, 0, 1027, 546.5)
  })

  it('uses supplied wait metrics for affected shipments and baselines for the rest', () => {
    expectTotals(disrupted, 4, 1204, 546.5)
  })

  it.each([
    ['wait', 'S-01', 4, 1204, 546.5],
    ['reroute', 'S-01', 3, 1202, 570],
    ['reroute', 'S-03', 4, 1215, 570],
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
    }, 3, 1210, 593.5)
  })

  it.each(['S-01', 'S-02'])(
    'keeps wait metrics and risk while %s awaits slot confirmation',
    (shipmentId) => {
      expectTotals(
        withDecision(decision('request_slot', shipmentId, 'pending_confirmation')),
        4, 1204, 546.5,
      )
    },
  )

  it('does not count a preview as a recorded decision', () => {
    expectTotals({
      ...disrupted,
      previewDecision: decision('reroute', 'S-01', 'previewed'),
    }, 4, 1204, 546.5)
  })

  it.each([
    ['wait', 'S-01'],
    ['reroute', 'S-03'],
  ] as const)('preserves selected totals while previewing %s for %s', (kind, shipmentId) => {
    expectTotals({
      ...withDecision(decision('reroute')),
      previewDecision: decision(kind, shipmentId, 'previewed'),
    }, 3, 1202, 570)
  })

  it('does not change current metrics when all responses are rejected', () => {
    expectTotals({ ...disrupted, rejectedShipmentIds: ['S-01'] }, 4, 1204, 546.5)
  })

  it('counts an UNKNOWN current response as at risk', () => {
    const readOptions = data.getResponseOptions
    vi.spyOn(data, 'getResponseOptions').mockImplementation((id, scenario) =>
      readOptions(id, scenario).map((option) =>
        id === 'S-02' && option.kind === 'wait' ? { ...option, risk: 'UNKNOWN' } : option,
      ),
    )
    expectTotals(disrupted, 5, 1204, 546.5)
  })

  it('keeps a missing selected cost unknown without dropping its known CO2', () => {
    const readOptions = data.getResponseOptions
    vi.spyOn(data, 'getResponseOptions').mockImplementation((id, scenario) =>
      readOptions(id, scenario).map((option) =>
        id === 'S-01' && option.kind === 'reroute' ? { ...option, cost: null } : option,
      ),
    )
    const actual = getTotals(withDecision(decision('reroute')))
    expect(actual.atRisk).toBe(3)
    expect(actual.cost).toBeNull()
    expect(actual.co2Kg).toBeCloseTo(570, 6)
  })

  it('keeps missing wait CO2 unknown while a slot request remains pending', () => {
    const readOptions = data.getResponseOptions
    vi.spyOn(data, 'getResponseOptions').mockImplementation((id, scenario) =>
      readOptions(id, scenario).map((option) =>
        id === 'S-01' && option.kind === 'wait' ? { ...option, co2_kg: null } : option,
      ),
    )
    expect(getTotals(withDecision(
      decision('request_slot', 'S-01', 'pending_confirmation'),
    ))).toEqual({ atRisk: 4, cost: 1204, co2Kg: null })
  })

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not silently omit an unknown baseline cost (%s)',
    (cost) => {
      const readBaseline = data.getBaseline
      vi.spyOn(data, 'getBaseline').mockImplementation((id) =>
        id === 'S-06'
          ? { ...readBaseline(id), cost } as unknown as Baseline
          : readBaseline(id),
      )
      const actual = getTotals(disrupted)
      expect(actual.cost).toBeNull()
      expect(actual.co2Kg).toBeCloseTo(546.5, 6)
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

  it('surfaces a missing wait response rather than substituting the baseline', () => {
    const readOptions = data.getResponseOptions
    vi.spyOn(data, 'getResponseOptions').mockImplementation((id, scenario) =>
      readOptions(id, scenario).filter((option) => id !== 'S-01' || option.kind !== 'wait'),
    )
    expect(() => getTotals(disrupted)).toThrow(/No current response metrics for S-01/)
  })
})
