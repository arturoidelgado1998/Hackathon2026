import { afterEach, describe, expect, it, vi } from 'vitest'
import * as data from '../data/index.ts'
import { getShipmentSummary, shipments } from '../data/index.ts'
import type { ResponseOptionKind } from '../types.ts'
import { appReducer, initialState, type AppAction, type AppState } from './reducer.ts'
import { buildCards, buildHighlightedRoutes } from './selectors.ts'
import { getTotals } from './totals.ts'

const TIMESTAMP = '2026-11-14T19:46:36.081Z'
const NEXT_TIMESTAMP = '2026-11-14T19:47:01.000Z'

function disruptedState(): AppState {
  return appReducer(initialState, { type: 'set_scenario', scenario: 'disrupted' })
}

function choose(state: AppState, optionKind: ResponseOptionKind, shipmentId = 'S-01') {
  return appReducer(state, {
    type: 'select_option',
    shipmentId,
    optionKind,
    timestamp: TIMESTAMP,
  })
}

function findCard(state: AppState, shipmentId = 'S-01') {
  return buildCards(state.scenario, state.decisions, state.rejectedShipmentIds)
    .find((card) => card.shipment.id === shipmentId)!
}

afterEach(() => vi.restoreAllMocks())

describe('dispatcher reducer', () => {
  it('records a timestamped preview without changing committed decisions or board cards', () => {
    const state = appReducer(disruptedState(), {
      type: 'select_shipment',
      shipmentId: 'S-01',
    })
    const next = appReducer(state, {
      type: 'preview',
      shipmentId: 'S-01',
      optionKind: 'reroute',
      timestamp: TIMESTAMP,
    })

    expect(next.previewDecision).toEqual({
      shipment_id: 'S-01',
      option_kind: 'reroute',
      status: 'previewed',
      timestamp: TIMESTAMP,
    })
    expect(next.decisions).toBe(state.decisions)
    expect(findCard(next)).toEqual(findCard(state))
    expect(state.previewDecision).toBeNull()
    expect(buildHighlightedRoutes(next.selectedShipmentId, next.previewDecision, next.decisions))
      .toMatchObject({ chosen: 'R-A-ALT' })
  })

  it.each(['wait', 'reroute'] as const)('commits %s as selected and moves to Decision recorded', (kind) => {
    const state = disruptedState()
    const next = choose(state, kind)

    expect(next.decisions['S-01']).toEqual({
      shipment_id: 'S-01',
      option_kind: kind,
      status: 'selected',
      timestamp: TIMESTAMP,
    })
    expect(findCard(next).column).toBe('decision_recorded')
    expect(findCard(next).summary.risk).toBe(kind === 'reroute' ? 'ON_TRACK' : 'LATE')
    expect(state.decisions).toEqual({})
  })

  it('requests a slot as pending and retains the original risk and arrival', () => {
    const next = choose(disruptedState(), 'request_slot')

    expect(next.decisions['S-01']).toEqual({
      shipment_id: 'S-01',
      option_kind: 'request_slot',
      status: 'pending_confirmation',
      timestamp: TIMESTAMP,
    })
    expect(findCard(next).column).toBe('awaiting_confirmation')
    expect(findCard(next).summary).toEqual(getShipmentSummary('S-01', 'disrupted'))
    expect(findCard(next).summary.risk).toBe('LATE')
  })

  it.each(['reroute', 'request_slot'] as const)(
    'preview after committed %s leaves the existing decision and board unchanged',
    (kind) => {
      const state = choose(disruptedState(), kind)
      const next = appReducer(state, {
        type: 'preview',
        shipmentId: 'S-01',
        optionKind: 'wait',
        timestamp: NEXT_TIMESTAMP,
      })

      expect(next.decisions).toBe(state.decisions)
      expect(findCard(next)).toEqual(findCard(state))
      expect(next.previewDecision?.timestamp).toBe(NEXT_TIMESTAMP)
      expect(buildHighlightedRoutes('S-01', next.previewDecision, next.decisions))
        .toMatchObject({ chosen: 'R-A-ORIG' })
    },
  )

  it('clears the current preview when selecting a shipment without altering decisions', () => {
    const state = choose(disruptedState(), 'reroute')
    const previewed = appReducer(state, {
      type: 'preview',
      shipmentId: 'S-01',
      optionKind: 'wait',
      timestamp: NEXT_TIMESTAMP,
    })
    const next = appReducer(previewed, { type: 'select_shipment', shipmentId: 'S-02' })

    expect(next.selectedShipmentId).toBe('S-02')
    expect(next.previewDecision).toBeNull()
    expect(next.decisions).toBe(state.decisions)
    expect(buildHighlightedRoutes('S-01', next.previewDecision, next.decisions))
      .toMatchObject({ chosen: 'R-A-ALT' })
  })

  it('rejects all for every Needs review shipment, including originally ON_TRACK shipments', () => {
    const state = disruptedState()
    const reviewIds = shipments
      .filter((shipment) => getShipmentSummary(shipment.id, state.scenario).affected)
      .map((shipment) => shipment.id)
    const next = reviewIds.reduce(
      (current, shipmentId) => appReducer(current, { type: 'reject_all', shipmentId }),
      state,
    )

    expect(next.decisions).toEqual({})
    expect(next.rejectedShipmentIds).toEqual(reviewIds)
    for (const id of reviewIds) {
      expect(findCard(next, id)).toMatchObject({
        column: 'needs_review',
        rejectionNote: 'Dispatcher rejected all options',
        summary: getShipmentSummary(id, 'disrupted'),
      })
    }
    const repeated = appReducer(next, { type: 'reject_all', shipmentId: 'S-01' })
    expect(repeated.rejectedShipmentIds).toEqual(reviewIds)
    expect(state.rejectedShipmentIds).toEqual([])
  })

  it('keeps a rejection during preview, then clears it when a decision is committed', () => {
    const rejected = appReducer(disruptedState(), { type: 'reject_all', shipmentId: 'S-01' })
    const previewed = appReducer(rejected, {
      type: 'preview',
      shipmentId: 'S-01',
      optionKind: 'reroute',
      timestamp: TIMESTAMP,
    })
    expect(findCard(previewed).rejectionNote).toBe('Dispatcher rejected all options')

    const selected = choose(previewed, 'reroute')
    expect(selected.rejectedShipmentIds).toEqual([])
    expect(selected.previewDecision).toBeNull()
    expect(findCard(selected).rejectionNote).toBeUndefined()
  })

  it('preserves other shipments when replacing a committed decision', () => {
    const state = choose(choose(disruptedState(), 'reroute'), 'wait', 'S-02')
    const next = choose(state, 'request_slot')

    expect(next.decisions['S-02']).toBe(state.decisions['S-02'])
    expect(next.decisions['S-01'].status).toBe('pending_confirmation')
  })

  it.each(['wait', 'reroute', 'request_slot'] as const)(
    'undoes the first %s choice without retaining decision history',
    (kind) => {
      const state = disruptedState()
      const selected = choose(state, kind)
      const undone = appReducer(selected, { type: 'undo_decision' })

      expect(undone).toEqual(state)
      expect(getTotals(undone)).toEqual(getTotals(state))
      expect(findCard(undone)).toEqual(findCard(state))
      expect(() => appReducer(undone, { type: 'undo_decision' }))
        .toThrow('No decision available to undo')
    },
  )

  it('undoes a replacement back to the original decision and clears a later preview', () => {
    const state = choose(choose(disruptedState(), 'reroute'), 'wait', 'S-02')
    const replacement = choose(state, 'request_slot')
    const previewed = appReducer(replacement, {
      type: 'preview', shipmentId: 'S-01', optionKind: 'wait', timestamp: NEXT_TIMESTAMP,
    })
    const undone = appReducer(previewed, { type: 'undo_decision' })

    expect(undone.decisions).toEqual(state.decisions)
    expect(undone.previewDecision).toBeNull()
    expect(getTotals(undone)).toEqual(getTotals(state))
    expect(buildHighlightedRoutes('S-01', undone.previewDecision, undone.decisions))
      .toMatchObject({ chosen: 'R-A-ALT' })
  })

  it('restores a prior rejection note without discarding later unrelated rejections', () => {
    const rejected = appReducer(disruptedState(), { type: 'reject_all', shipmentId: 'S-01' })
    const selected = choose(rejected, 'reroute')
    const unrelated = appReducer(selected, { type: 'reject_all', shipmentId: 'S-03' })
    const undone = appReducer(unrelated, { type: 'undo_decision' })

    expect(findCard(undone).rejectionNote).toBe('Dispatcher rejected all options')
    expect(findCard(undone, 'S-03').rejectionNote).toBe('Dispatcher rejected all options')
    expect(undone.decisions).toEqual({})
  })

  it('cancels a preview without changing the recorded plan or its undo snapshot', () => {
    const selected = choose(disruptedState(), 'reroute')
    const previewed = appReducer(selected, {
      type: 'preview', shipmentId: 'S-01', optionKind: 'wait', timestamp: NEXT_TIMESTAMP,
    })
    const cancelled = appReducer(previewed, { type: 'cancel_preview' })

    expect(cancelled).toEqual(selected)
    expect(buildHighlightedRoutes('S-01', cancelled.previewDecision, cancelled.decisions))
      .toMatchObject({ chosen: 'R-A-ALT' })
  })

  it('clears undo when switching scenarios or resetting the dashboard', () => {
    const selected = choose(disruptedState(), 'reroute')
    const cleared = [
      appReducer(selected, { type: 'set_scenario', scenario: 'normal' }),
      appReducer(selected, { type: 'reset' }),
    ]
    for (const state of cleared) {
      expect(() => appReducer(state, { type: 'undo_decision' }))
        .toThrow('No decision available to undo')
    }
  })

  it('throws explicit errors for invalid shipments, options, workflow actions, and timestamps', () => {
    const state = disruptedState()
    expect(() => appReducer(state, { type: 'select_shipment', shipmentId: 'missing' }))
      .toThrow('Unknown shipment')
    expect(() => choose({ ...initialState, scenario: 'normal' }, 'wait')).toThrow('No wait option')
    // No reroute is unavailable in the feature-service data, so simulate one.
    const readOptions = data.getResponseOptions
    vi.spyOn(data, 'getResponseOptions').mockImplementation((id, scenario) =>
      readOptions(id, scenario).map((option) =>
        id === 'S-05' && option.kind === 'reroute'
          ? { ...option, arrival_min: null, arrival_max: null, risk: 'UNKNOWN' }
          : option,
      ),
    )
    expect(() => choose(state, 'reroute', 'S-05')).toThrow('Unavailable reroute option')
    expect(() => appReducer(state, {
      type: 'preview',
      shipmentId: 'S-05',
      optionKind: 'reroute',
      timestamp: TIMESTAMP,
    })).toThrow('Unavailable reroute option')
    expect(() => appReducer(state, { type: 'reject_all', shipmentId: 'S-06' }))
      .toThrow('not in Needs review')
    expect(() => appReducer(choose(state, 'wait'), { type: 'reject_all', shipmentId: 'S-01' }))
      .toThrow('not in Needs review')
    expect(() => appReducer(state, {
      type: 'select_option',
      shipmentId: 'S-01',
      optionKind: 'wait',
      timestamp: 'not-a-timestamp',
    })).toThrow('ISO 8601')
    expect(() => appReducer(state, { type: 'unknown' } as unknown as AppAction))
      .toThrow('Unknown app action')
  })
})
