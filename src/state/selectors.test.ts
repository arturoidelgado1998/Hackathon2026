import { describe, expect, it } from 'vitest'
import type { Decision } from '../types.ts'
import { buildCards, buildHighlightedRoutes, buildResponseView } from './selectors.ts'

const decision: Decision = {
  shipment_id: 'SHP-001',
  option_kind: 'reroute',
  status: 'selected',
  timestamp: '2026-11-14T19:46:36.081Z',
}

describe('decision view selectors', () => {
  it('keeps an unaffected shipment summary identical across the board and response scenarios', () => {
    const normal = buildResponseView('SHP-002', 'normal')!
    const disrupted = buildResponseView('SHP-002', 'disrupted')!
    const card = buildCards('disrupted').find((entry) => entry.shipment.id === 'SHP-002')!

    expect(disrupted.summary).toEqual(normal.summary)
    expect(card.summary).toEqual(normal.summary)
  })

  it('uses the committed estimate and keeps the response lookup API stable', () => {
    const cards = buildCards('disrupted', { 'SHP-001': decision })
    const card = cards.find((entry) => entry.shipment.id === 'SHP-001')!
    const view = buildResponseView('SHP-001', 'disrupted')!
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
    expect(buildCards('disrupted').find((entry) => entry.shipment.id === 'SHP-001')?.column)
      .toBe('needs_review')
  })

  it('ignores a preview for another shipment and highlights the selected shipment only', () => {
    const unrelatedPreview: Decision = {
      ...decision,
      shipment_id: 'SHP-004',
      option_kind: 'wait',
      status: 'previewed',
    }
    expect(buildHighlightedRoutes('SHP-001', unrelatedPreview, { 'SHP-001': decision }))
      .toEqual({ original: 'R-A-ORIG', alternative: 'R-A-ALT', chosen: 'R-A-ALT' })
    expect(buildHighlightedRoutes(null, unrelatedPreview, { 'SHP-001': decision })).toEqual({})
    expect(buildHighlightedRoutes('missing')).toEqual({})
  })

  it('does not imply a new route when requesting a later appointment', () => {
    expect(buildHighlightedRoutes('SHP-001', { ...decision, option_kind: 'request_slot' }))
      .toMatchObject({ chosen: 'R-A-ORIG' })
  })
})
