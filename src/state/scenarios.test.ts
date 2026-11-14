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
  state = appReducer(state, { type: 'select_shipment', shipmentId: 'S-01' })
  state = appReducer(state, {
    type: 'select_option', shipmentId: 'S-01', optionKind: 'reroute', timestamp,
  })
  state = appReducer(state, { type: 'select_shipment', shipmentId: 'S-03' })
  state = appReducer(state, { type: 'reject_all', shipmentId: 'S-03' })
  state = appReducer(state, { type: 'select_shipment', shipmentId: 'S-02' })
  return appReducer(state, {
    type: 'preview', shipmentId: 'S-02', optionKind: 'wait', timestamp,
  })
}

describe('scenario and reset totals', () => {
  it('keeps unaffected cards identical when toggling scenarios after workflow actions', () => {
    const freshCards = cardsFor(initialState)
    const disruptedState = activeState()
    const disruptedCards = cardsFor(disruptedState)
    const normalState = appReducer(disruptedState, { type: 'set_scenario', scenario: 'normal' })
    const normalCards = cardsFor(normalState)

    for (const id of ['S-06', 'S-08', 'S-09', 'S-10']) {
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
    })).cost).toBe(1204)
  })

  it('resets decisions, preview, rejection, selection and scenario exactly to a fresh load', () => {
    const active = activeState()
    expect(Object.keys(active.decisions)).toHaveLength(1)
    expect(active.previewDecision).not.toBeNull()
    expect(active.rejectedShipmentIds).toEqual(['S-03'])
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
    expect(getTotals(reset).cost).toBe(1204)
  })
})
