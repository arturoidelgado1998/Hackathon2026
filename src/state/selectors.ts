// Assembles what each dashboard component displays from the data module.
// Engine estimates and raw route facts are passed through, never recalculated here.

import { defaultColumn } from '../components/board/index.ts'
import {
  getBaseline,
  getFacility,
  getResponseOptions,
  getRoute,
  getRoutesForDestination,
  getShipment,
  getShipmentAssessment,
  getShipmentSummary,
  sampleIncident,
  shipments,
} from '../data/index.ts'
import type { MapPanelProps } from '../map/MapPanel.tsx'
import type { Decision, ResponseOptionKind, Route } from '../types.ts'
import type {
  CommunityInfo,
  ResponsePanelView,
  Scenario,
  ShipmentCardView,
} from '../viewModels.ts'

function destinationName(facilityId: string): string {
  return getFacility(facilityId)?.name ?? facilityId
}

function communityOf(route: Route | undefined): CommunityInfo | undefined {
  if (!route) return undefined
  return {
    schools_150m: route.schools_150m,
    dac_tracts: route.dac_tracts,
    max_diesel_pm_pctl: route.max_diesel_pm_pctl,
  }
}

function alternativeRouteFor(destinationId: string): Route | undefined {
  return getRoutesForDestination(destinationId).find((r) => r.kind === 'alternative')
}

function summaryFor(shipmentId: string, scenario: Scenario) {
  const summary = getShipmentSummary(shipmentId, scenario)
  return scenario === 'disrupted' && !summary.affected
    ? getShipmentSummary(shipmentId, 'normal')
    : summary
}

/** Committed decisions change workflow; previews are deliberately not an input. */
export function buildCards(
  scenario: Scenario,
  decisions: Record<string, Decision> = {},
  rejectedShipmentIds: string[] = [],
): ShipmentCardView[] {
  return shipments.map((shipment) => {
    const assessment = getShipmentAssessment(shipment.id, scenario)
    const summary = summaryFor(shipment.id, scenario)
    const decision = decisions[shipment.id]
    if (decision && decision.shipment_id !== shipment.id) {
      throw new Error(`Decision does not match shipment ${shipment.id}`)
    }
    if (decision?.status === 'previewed') {
      throw new Error('Preview decisions must not be stored as committed decisions')
    }
    const selectedOption = decision?.status === 'selected'
      ? getResponseOptions(shipment.id, scenario).find((o) => o.kind === decision.option_kind)
      : undefined
    if (decision?.status === 'selected' && !selectedOption) {
      throw new Error(`No selected option for shipment ${shipment.id} (${scenario})`)
    }
    return {
      shipment,
      destinationName: destinationName(shipment.destination_id),
      summary: selectedOption ? {
        ...summary,
        risk: selectedOption.risk,
        arrival_min: selectedOption.arrival_min,
        arrival_max: selectedOption.arrival_max,
        lateness_min: selectedOption.lateness_min,
        lateness_max: selectedOption.lateness_max,
        reason: selectedOption.status,
      } : summary,
      column: decision
        ? decision.status === 'pending_confirmation' ? 'awaiting_confirmation' : 'decision_recorded'
        : defaultColumn(summary, scenario),
      ...(summary.affected ? {
        incidentSegmentId: sampleIncident.segment_id,
        reopen_needed_by: assessment.reopen_needed_by,
        reroute_decide_by: assessment.reroute_decide_by,
        no_feasible_response: assessment.no_feasible_response,
      } : {}),
      ...(decision ? { decision } : {}),
      ...(!decision && rejectedShipmentIds.includes(shipment.id)
        ? { rejectionNote: 'Dispatcher rejected all options' }
        : {}),
    }
  })
}

/** The response panel's content for the selected shipment, or null. */
export function buildResponseView(
  shipmentId: string | null,
  scenario: Scenario,
): ResponsePanelView | null {
  if (!shipmentId) return null
  const shipment = getShipment(shipmentId)
  if (!shipment) return null

  const community: Partial<Record<ResponseOptionKind, CommunityInfo>> = {}
  const waitCommunity = communityOf(getRoute(shipment.assigned_route_id))
  if (waitCommunity) community.wait = waitCommunity
  const rerouteCommunity = communityOf(alternativeRouteFor(shipment.destination_id))
  if (rerouteCommunity) community.reroute = rerouteCommunity

  return {
    shipment,
    destinationName: destinationName(shipment.destination_id),
    summary: summaryFor(shipmentId, scenario),
    options: getResponseOptions(shipmentId, scenario),
    baseline: getBaseline(shipmentId),
    community,
  }
}

/** Which routes the map panel highlights for the selected shipment. */
export function buildHighlightedRoutes(
  shipmentId: string | null,
  previewDecision: Decision | null = null,
  decisions: Record<string, Decision> = {},
): MapPanelProps['highlightedRouteIds'] {
  if (!shipmentId) return {}
  const shipment = getShipment(shipmentId)
  if (!shipment) return {}
  const alternative = alternativeRouteFor(shipment.destination_id)
  const activeDecision = previewDecision?.shipment_id === shipmentId
    ? previewDecision
    : decisions[shipmentId]
  const chosen = activeDecision
    ? activeDecision.option_kind === 'reroute' ? alternative?.id : shipment.assigned_route_id
    : undefined
  return {
    original: shipment.assigned_route_id,
    ...(alternative ? { alternative: alternative.id } : {}),
    ...(chosen ? { chosen } : {}),
  }
}

/** The confirmed closure shown on the map panel, if the scenario has one. */
export function incidentSegmentFor(scenario: Scenario): string | null {
  return scenario === 'disrupted' ? sampleIncident.segment_id : null
}
