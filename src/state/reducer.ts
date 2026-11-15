import { defaultColumn } from '../components/board/columns.ts'
import { getResponseOptions, getShipment, getShipmentSummary } from '../data/index.ts'
import type { Decision, ResponseOptionKind } from '../types.ts'
import type { Scenario } from '../viewModels.ts'
import { isResponseOptionAvailable } from './options.ts'

export interface AppState {
  scenario: Scenario
  selectedShipmentId: string | null
  decisions: Record<string, Decision>
  previewDecision: Decision | null
  rejectedShipmentIds: string[]
  lastDecisionChange: {
    shipmentId: string
    previousDecision: Decision | null
    wasRejected: boolean
  } | null
  showEmptyGroups: boolean
}

export type AppAction =
  | { type: 'select_shipment'; shipmentId: string }
  | { type: 'preview'; shipmentId: string; optionKind: ResponseOptionKind; timestamp: string }
  | { type: 'cancel_preview' }
  | {
      type: 'select_option'
      shipmentId: string
      optionKind: ResponseOptionKind
      timestamp: string
      /** Simulated minutes since midnight on a live day; omitted on the prefilled sample. */
      simTime?: number
    }
  /** The live clock was moved back: choices made after `time` have not happened yet. */
  | { type: 'clock_rewound'; time: number }
  | { type: 'undo_decision' }
  | { type: 'reject_all'; shipmentId: string }
  | { type: 'toggle_empty_groups' }
  | { type: 'set_scenario'; scenario: Scenario }
  | { type: 'reset' }

export const initialState: AppState = {
  scenario: 'disrupted',
  selectedShipmentId: null,
  decisions: {},
  previewDecision: null,
  rejectedShipmentIds: [],
  lastDecisionChange: null,
  showEmptyGroups: false,
}

function requireShipment(shipmentId: string): void {
  if (!getShipment(shipmentId)) throw new Error(`Unknown shipment: ${shipmentId}`)
}

function requireOption(
  shipmentId: string,
  optionKind: ResponseOptionKind,
  scenario: Scenario,
): void {
  requireShipment(shipmentId)
  const option = getResponseOptions(shipmentId, scenario).find((o) => o.kind === optionKind)
  if (!option) throw new Error(`No ${optionKind} option for shipment ${shipmentId} (${scenario})`)
  if (!isResponseOptionAvailable(option)) {
    throw new Error(`Unavailable ${optionKind} option for shipment ${shipmentId}`)
  }
}

function requireTimestamp(timestamp: string): void {
  const isoTimestamp = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
  if (typeof timestamp !== 'string' || !isoTimestamp.test(timestamp)) {
    throw new Error('Decision timestamp must be ISO 8601 with a time zone')
  }
}

function requireSimTime(time: number): number {
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time >= 24 * 60) {
    throw new Error('Simulated time must be minutes since midnight on the demo day')
  }
  return time
}

/** Dispatcher workflow only. Estimates are supplied by the data module. */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'select_shipment':
      requireShipment(action.shipmentId)
      return { ...state, selectedShipmentId: action.shipmentId, previewDecision: null }
    case 'preview':
      requireOption(action.shipmentId, action.optionKind, state.scenario)
      requireTimestamp(action.timestamp)
      return {
        ...state,
        previewDecision: {
          shipment_id: action.shipmentId,
          option_kind: action.optionKind,
          status: 'previewed',
          timestamp: action.timestamp,
        },
      }
    case 'cancel_preview':
      return { ...state, previewDecision: null }
    case 'select_option': {
      requireOption(action.shipmentId, action.optionKind, state.scenario)
      requireTimestamp(action.timestamp)
      const decision: Decision = {
        shipment_id: action.shipmentId,
        option_kind: action.optionKind,
        status: action.optionKind === 'request_slot' ? 'pending_confirmation' : 'selected',
        timestamp: action.timestamp,
        ...(action.simTime === undefined ? {} : { sim_time: requireSimTime(action.simTime) }),
      }
      return {
        ...state,
        decisions: { ...state.decisions, [action.shipmentId]: decision },
        previewDecision: null,
        rejectedShipmentIds: state.rejectedShipmentIds.filter((id) => id !== action.shipmentId),
        lastDecisionChange: {
          shipmentId: action.shipmentId,
          previousDecision: state.decisions[action.shipmentId] ?? null,
          wasRejected: state.rejectedShipmentIds.includes(action.shipmentId),
        },
      }
    }
    case 'undo_decision': {
      if (!state.lastDecisionChange) throw new Error('No decision available to undo')
      const { shipmentId, previousDecision, wasRejected } = state.lastDecisionChange
      const decisions = { ...state.decisions }
      if (previousDecision) decisions[shipmentId] = previousDecision
      else delete decisions[shipmentId]
      return {
        ...state,
        decisions,
        previewDecision: null,
        rejectedShipmentIds: wasRejected
          ? [...state.rejectedShipmentIds, shipmentId]
          : state.rejectedShipmentIds,
        lastDecisionChange: null,
      }
    }
    case 'reject_all': {
      requireShipment(action.shipmentId)
      const summary = getShipmentSummary(action.shipmentId, state.scenario)
      if (
        defaultColumn(summary, state.scenario) !== 'needs_review' ||
        state.decisions[action.shipmentId]
      ) {
        throw new Error(`Shipment ${action.shipmentId} is not in Needs review`)
      }
      return {
        ...state,
        previewDecision: null,
        rejectedShipmentIds: state.rejectedShipmentIds.includes(action.shipmentId)
          ? state.rejectedShipmentIds
          : [...state.rejectedShipmentIds, action.shipmentId],
      }
    }
    case 'clock_rewound': {
      requireSimTime(action.time)
      const isLater = (decision: Decision | null) =>
        decision?.sim_time !== undefined && decision.sim_time > action.time
      const later = Object.values(state.decisions).filter(isLater)
      if (later.length === 0) return state
      const decisions = { ...state.decisions }
      for (const decision of later) delete decisions[decision.shipment_id]
      const change = state.lastDecisionChange
      return {
        ...state,
        decisions,
        previewDecision: null,
        // An undo must not bring back a choice that has not happened yet either.
        lastDecisionChange:
          change && (later.some((d) => d.shipment_id === change.shipmentId) || isLater(change.previousDecision))
            ? null
            : change,
      }
    }
    case 'toggle_empty_groups':
      return { ...state, showEmptyGroups: !state.showEmptyGroups }
    case 'set_scenario':
      if (action.scenario !== 'normal' && action.scenario !== 'disrupted') {
        throw new Error(`Unknown scenario: ${action.scenario}`)
      }
      return {
        ...initialState,
        scenario: action.scenario,
        selectedShipmentId:
          state.selectedShipmentId && getShipment(state.selectedShipmentId)
            ? state.selectedShipmentId
            : null,
      }
    case 'reset':
      return initialState
    default:
      throw new Error('Unknown app action')
  }
}
