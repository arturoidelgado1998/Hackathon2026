// Assembles what each dashboard component displays from the data module.
// Pure functions with no calculations: they look values up and pass them on.
// D6 will add decisions on top of these (a decision moves a card's column);
// E4 will swap the data module calls for engine calls.

import { defaultColumn } from '../components/board/index.ts'
import {
  getBaseline,
  getFacility,
  getResponseOptions,
  getRoute,
  getRoutesForDestination,
  getShipment,
  getShipmentSummary,
  sampleIncident,
  shipments,
} from '../data/index.ts'
import type { MapPanelProps } from '../map/MapPanel.tsx'
import type { ResponseOptionKind, Route } from '../types.ts'
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

/** One card per shipment, each in its starting column for the scenario. */
export function buildCards(scenario: Scenario): ShipmentCardView[] {
  return shipments.map((shipment) => {
    const summary = getShipmentSummary(shipment.id, scenario)
    return {
      shipment,
      destinationName: destinationName(shipment.destination_id),
      summary,
      column: defaultColumn(summary, scenario),
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
    summary: getShipmentSummary(shipmentId, scenario),
    options: getResponseOptions(shipmentId, scenario),
    baseline: getBaseline(shipmentId),
    community,
  }
}

/** Which routes the map panel highlights for the selected shipment. */
export function buildHighlightedRoutes(
  shipmentId: string | null,
): MapPanelProps['highlightedRouteIds'] {
  if (!shipmentId) return {}
  const shipment = getShipment(shipmentId)
  if (!shipment) return {}
  const alternative = alternativeRouteFor(shipment.destination_id)
  return {
    original: shipment.assigned_route_id,
    ...(alternative ? { alternative: alternative.id } : {}),
  }
}

/** The confirmed closure shown on the map panel, if the scenario has one. */
export function incidentSegmentFor(scenario: Scenario): string | null {
  return scenario === 'disrupted' ? sampleIncident.segment_id : null
}
