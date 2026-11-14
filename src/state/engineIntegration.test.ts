import { afterEach, describe, expect, it } from 'vitest'
import {
  assumptions, getBaseline, getResponseOptions, getShipmentAssessment,
  getShipmentSummary, routes, sampleIncident, segments, shipments,
} from '../data/index.ts'
import { assessShipment } from '../engine/responses.ts'
import { initialState } from './reducer.ts'
import { buildCards, buildResponseView } from './selectors.ts'
import { getTotals } from './totals.ts'
import { compareReviewUrgency } from './urgency.ts'

const shipment = shipments.find((item) => item.id === 'S-01')!
const segment = segments.find((item) => item.id === 'WH-A-APPR')!
const original = { shipment: { ...shipment }, segment: { ...segment }, assumptions: { ...assumptions } }

afterEach(() => {
  Object.assign(shipment, original.shipment)
  Object.assign(segment, original.segment)
  Object.assign(assumptions, original.assumptions)
})

describe('fresh engine integration', () => {
  it('recomputes summaries, cards, responses and totals when shipment inputs change', () => {
    expect(getShipmentSummary(shipment.id, 'disrupted').risk).toBe('LATE')
    shipment.appt_end = '13:00'
    const assessment = assessShipment(shipment, sampleIncident, { routes, segments }, assumptions)
    expect(getShipmentAssessment(shipment.id, 'disrupted')).toEqual(assessment)
    expect(getShipmentSummary(shipment.id, 'disrupted').risk).toBe('ON_TRACK')
    expect(buildCards('disrupted').find((card) => card.shipment.id === shipment.id))
      .toMatchObject({
        summary: { risk: 'ON_TRACK' }, reopen_needed_by: '11:58', reroute_decide_by: '11:32',
      })
    expect(buildResponseView(shipment.id, 'disrupted')?.options).toEqual(assessment.options)
    expect(getTotals(initialState).atRisk).toBe(3)
  })

  it('uses current segment distances/times, not stored route totals or response fixtures', () => {
    const before = getResponseOptions(shipment.id, 'disrupted')[1]
    segment.miles += 10
    segment.minutes_max += 5
    const reroute = getResponseOptions(shipment.id, 'disrupted')[1]
    expect(reroute).toMatchObject({ miles: 70, arrival_max: '11:33', risk: 'TIGHT' })
    expect(reroute.co2_kg).toBeGreaterThan(before.co2_kg!)
    expect(reroute.cost).toBeGreaterThan(before.cost!)
    expect(getBaseline(shipment.id).miles).toBe(55)
    expect(buildCards('disrupted').find((card) => card.shipment.id === shipment.id))
      .toMatchObject({ reopen_needed_by: '10:23', reroute_decide_by: '09:57' })
    expect(getTotals(initialState).co2Kg).toBeGreaterThan(546.5)
  })

  it('uses current assumptions in baseline, option and total estimates', () => {
    const before = getTotals(initialState)
    assumptions.mpg = 5
    assumptions.labor_rate_per_hr = 50
    expect(getBaseline(shipment.id)).toMatchObject({ cost: 143, co2_kg: 91.9 })
    expect(getResponseOptions(shipment.id, 'disrupted')[1])
      .toMatchObject({ cost: 181, co2_kg: 122.5 })
    expect(getTotals(initialState).cost).toBeGreaterThan(before.cost!)
    expect(getTotals(initialState).co2Kg).toBeGreaterThan(before.co2Kg!)
  })
})

describe('Needs review urgency', () => {
  it('puts earliest deadlines first, keeps TIGHT S-04 potentially feasible, and S-03 last', () => {
    const review = buildCards('disrupted').filter((card) => card.column === 'needs_review')
      .sort(compareReviewUrgency)
    expect(review.map((card) => card.shipment.id))
      .toEqual(['S-04', 'S-01', 'S-07', 'S-02', 'S-05', 'S-03'])
    expect(review[0].no_feasible_response).toBe(false)
    expect(review.at(-1)?.no_feasible_response).toBe(true)
    expect(review.every((card) => card.decision === undefined)).toBe(true)
    expect(getResponseOptions('S-01', 'disrupted').map((option) => option.kind))
      .toEqual(['wait', 'reroute', 'request_slot'])
  })

  it('handles missing deadlines explicitly, then deterministic shipment-ID ties within feasibility', () => {
    const base = buildCards('disrupted')[0]
    const card = (id: string, deadline: string | null | undefined, unfixable = false) => ({
      ...base, shipment: { ...base.shipment, id }, reroute_decide_by: deadline,
      no_feasible_response: unfixable,
    })
    const cards = [
      card('Z', null), card('B', '10:00'), card('A', '10:00'),
      card('F', '08:00', true), card('Y', undefined), card('G', null, true),
    ]
    expect([...cards].sort(compareReviewUrgency).map((item) => item.shipment.id))
      .toEqual(['A', 'B', 'Y', 'Z', 'F', 'G'])
    expect([...cards].reverse().sort(compareReviewUrgency).map((item) => item.shipment.id))
      .toEqual(['A', 'B', 'Y', 'Z', 'F', 'G'])
  })
})
