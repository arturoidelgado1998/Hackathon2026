import { describe, expect, it } from 'vitest'
import { appReducer, initialState } from './reducer.ts'
import type { AppState } from './reducer.ts'
import { buildCards } from './selectors.ts'
import { getTotals } from './totals.ts'

const timestamp = '2026-11-14T12:00:00.000Z'
const cardsFor = (state: AppState) =>
  buildCards(state.scenario, state.decisions, state.rejectedShipmentIds)

function activeState(): AppState {
  let state = appReducer(initialState, { type: 'set_scenario', scenario: 'disrupted' })
  state = appReducer(state, { type: 'select_shipment', shipmentId: 'SHP-001' })
  state = appReducer(state, {
    type: 'select_option', shipmentId: 'SHP-001', optionKind: 'reroute', timestamp,
  })
  state = appReducer(state, { type: 'select_shipment', shipmentId: 'SHP-004' })
  state = appReducer(state, { type: 'reject_all', shipmentId: 'SHP-004' })
  state = appReducer(state, { type: 'select_shipment', shipmentId: 'SHP-003' })
  return appReducer(state, {
    type: 'preview', shipmentId: 'SHP-003', optionKind: 'wait', timestamp,
  })
}

describe('scenario and reset totals', () => {
  it('keeps unaffected cards identical when toggling scenarios after workflow actions', () => {
    const freshCards = cardsFor(initialState)
    const disruptedState = activeState()
    const disruptedCards = cardsFor(disruptedState)
    const normalState = appReducer(disruptedState, { type: 'set_scenario', scenario: 'normal' })
    const normalCards = cardsFor(normalState)

    for (const id of ['SHP-002', 'SHP-005', 'SHP-009', 'SHP-010']) {
      const fresh = freshCards.find((card) => card.shipment.id === id)
      expect(disruptedCards.find((card) => card.shipment.id === id)).toEqual(fresh)
      expect(normalCards.find((card) => card.shipment.id === id)).toEqual(fresh)
    }
    expect(normalState.decisions).toEqual({})
    expect(normalState.previewDecision).toBeNull()
    expect(normalState.rejectedShipmentIds).toEqual([])
    expect(getTotals(normalState)).toEqual(getTotals({ ...initialState, scenario: 'normal' }))
    expect(getTotals(appReducer(normalState, {
      type: 'set_scenario', scenario: 'disrupted',
    })).cost).toBe(1348)
  })

  it('resets decisions, preview, rejection, selection and scenario exactly to a fresh load', () => {
    const active = activeState()
    expect(Object.keys(active.decisions)).toHaveLength(1)
    expect(active.previewDecision).not.toBeNull()
    expect(active.rejectedShipmentIds).toEqual(['SHP-004'])
    expect(active.selectedShipmentId).not.toBeNull()

    const reset = appReducer(active, { type: 'reset' })
    expect(reset).toEqual(initialState)
    expect(reset).toEqual({
      scenario: 'disrupted',
      selectedShipmentId: null,
      decisions: {},
      previewDecision: null,
      rejectedShipmentIds: [],
      lastDecisionChange: null,
      showEmptyGroups: false,
    })
    expect(cardsFor(reset)).toEqual(cardsFor(initialState))
    expect(getTotals(reset)).toEqual(getTotals(initialState))
    expect(getTotals(reset).cost).toBe(1348)
  })
})
