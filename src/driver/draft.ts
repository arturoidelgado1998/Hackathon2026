// Gathers what buildDriverNotice needs from the response panel's own view,
// so the driver reads the same option the dispatcher compared. Lookups only.

import { getRoutesForDestination, getSegment } from '../data/index.ts'
import type { Decision, Incident } from '../types.ts'
import type { ResponsePanelView } from '../viewModels.ts'
import { buildDriverNotice } from './notice.ts'
import type { DriverNoticeBody } from './types.ts'

/** The notice text for the shipment's committed decision, or null. */
export function buildDraft(
  view: ResponsePanelView,
  decision: Decision,
  incident: Incident,
): DriverNoticeBody | null {
  const option = view.options.find((o) => o.kind === decision.option_kind)
  if (!option) return null
  const alternative = getRoutesForDestination(view.shipment.destination_id).find(
    (route) => route.kind === 'alternative',
  )
  return buildDriverNotice({
    shipment: view.shipment,
    destinationName: view.destinationName,
    decision,
    option,
    baseline: view.baseline,
    incident,
    incidentSegmentName: getSegment(incident.segment_id)?.name ?? incident.segment_id,
    alternativeRoute: alternative
      ? {
          id: alternative.id,
          segmentNames: alternative.segment_ids.map((id) => getSegment(id)?.name ?? id),
        }
      : null,
  })
}
