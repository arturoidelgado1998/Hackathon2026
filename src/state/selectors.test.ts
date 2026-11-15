import { describe, expect, it } from 'vitest'
import type { Decision } from '../types.ts'
import { getRoute } from '../data/index.ts'
import { buildCards, buildHighlightedRoutes, buildResponseView, truckNetworkOf } from './selectors.ts'

const decision: Decision = {
  shipment_id: 'S-01',
  option_kind: 'reroute',
  status: 'selected',
  timestamp: '2026-11-14T19:46:36.081Z',
}

describe('decision view selectors', () => {
  it('keeps an unaffected shipment summary identical across the board and response scenarios', () => {
    const normal = buildResponseView('S-06', 'normal')!
    const disrupted = buildResponseView('S-06', 'disrupted')!
    const card = buildCards('disrupted').find((entry) => entry.shipment.id === 'S-06')!

    expect(disrupted.summary).toEqual(normal.summary)
    expect(card.summary).toEqual(normal.summary)
  })

  it('uses the committed estimate and keeps the response lookup API stable', () => {
    const cards = buildCards('disrupted', { 'S-01': decision })
    const card = cards.find((entry) => entry.shipment.id === 'S-01')!
    const view = buildResponseView('S-01', 'disrupted')!
    const reroute = view.options.find((option) => option.kind === 'reroute')!

    expect(card.decision).toBe(decision)
    expect(card.summary).toMatchObject({
      risk: reroute.risk,
      arrival_min: reroute.arrival_min,
      arrival_max: reroute.arrival_max,
      lateness_min: reroute.lateness_min,
      lateness_max: reroute.lateness_max,
    })
    expect(view.summary?.risk).toBe('LATE')
    expect(buildCards('disrupted').find((entry) => entry.shipment.id === 'S-01')?.column)
      .toBe('needs_review')
  })

  it('ignores a preview for another shipment and highlights the selected shipment only', () => {
    const unrelatedPreview: Decision = {
      ...decision,
      shipment_id: 'S-03',
      option_kind: 'wait',
      status: 'previewed',
    }
    expect(buildHighlightedRoutes('S-01', unrelatedPreview, { 'S-01': decision }))
      .toEqual({ original: 'R-A-ORIG', alternative: 'R-A-ALT', chosen: 'R-A-ALT' })
    expect(buildHighlightedRoutes(null, unrelatedPreview, { 'S-01': decision })).toEqual({})
    expect(buildHighlightedRoutes('missing')).toEqual({})
  })

  it('does not imply a new route when requesting a later appointment', () => {
    expect(buildHighlightedRoutes('S-01', { ...decision, option_kind: 'request_slot' }))
      .toMatchObject({ chosen: 'R-A-ORIG' })
  })
})

describe('truck network record (G5)', () => {
  it('groups the highways of a route by the designation Caltrans records', () => {
    const trucks = truckNetworkOf(getRoute('R-B-ALT'))!
    expect(trucks.recorded).toEqual([
      { designation: 'National Network (STAA trucks)', highways: ['I-110', 'I-10'] },
    ])
    expect(trucks.noRecord).toEqual([])
    expect(trucks.notCovered).toEqual([])
  })

  it('reports a highway the layer has no rows for, once, instead of guessing', () => {
    const trucks = truckNetworkOf(getRoute('R-A-ORIG'))!
    expect(trucks.recorded).toEqual([{ designation: 'National Network (STAA trucks)', highways: ['I-710'] }])
    expect(trucks.noRecord).toEqual(['SR-60'])
  })

  it('names surface-street segments as not covered', () => {
    const trucks = truckNetworkOf(getRoute('R-C-ALT'))!
    expect(trucks.recorded).toEqual([])
    expect(trucks.notCovered).toEqual(['Alameda St / local streets to WH-C'])
  })

  it('gives the response view a record for the original and the alternative route', () => {
    const view = buildResponseView('S-01', 'disrupted')!
    expect(view.truckNetwork?.wait).toEqual(truckNetworkOf(getRoute('R-A-ORIG')))
    expect(view.truckNetwork?.reroute).toEqual(truckNetworkOf(getRoute('R-A-ALT')))
    expect(view.truckNetwork?.request_slot).toBeUndefined()
  })

  it('returns nothing for a route that does not exist', () => {
    expect(truckNetworkOf(undefined)).toBeUndefined()
  })
})
