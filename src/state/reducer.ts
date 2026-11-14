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
}

export type AppAction =
  | { type: 'select_shipment'; shipmentId: string }
  | { type: 'preview'; shipmentId: string; optionKind: ResponseOptionKind; timestamp: string }
  | { type: 'select_option'; shipmentId: string; optionKind: ResponseOptionKind; timestamp: string }
  | { type: 'reject_all'; shipmentId: string }
  | { type: 'set_scenario'; scenario: Scenario }
  | { type: 'reset' }

export const initialState: AppState = {
  scenario: 'normal',
  selectedShipmentId: null,
  decisions: {},
  previewDecision: null,
  rejectedShipmentIds: [],
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
    case 'select_option': {
      requireOption(action.shipmentId, action.optionKind, state.scenario)
      requireTimestamp(action.timestamp)
      const decision: Decision = {
        shipment_id: action.shipmentId,
        option_kind: action.optionKind,
        status: action.optionKind === 'request_slot' ? 'pending_confirmation' : 'selected',
        timestamp: action.timestamp,
      }
      return {
        ...state,
        decisions: { ...state.decisions, [action.shipmentId]: decision },
        previewDecision: null,
        rejectedShipmentIds: state.rejectedShipmentIds.filter((id) => id !== action.shipmentId),
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
