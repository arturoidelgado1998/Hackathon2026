import { useId } from 'react'
import type { Facility, Route, RoadSegment } from '../types.ts'
import './MapPanel.css'

// Phase 5 (G2) replaces this placeholder with a real map. Keep these props.
export interface MapPanelProps {
  facilities: Facility[]
  segments: RoadSegment[]
  routes: Route[]
  selectedShipmentId: string | null
  highlightedRouteIds: { original?: string; alternative?: string; chosen?: string }
  /** Confirmed closure. */
  incidentSegmentId: string | null
  /** AI match awaiting confirmation. */
  candidateSegmentId: string | null
  onSegmentClick?: (segmentId: string) => void
}

type Highlight = keyof MapPanelProps['highlightedRouteIds']

const HIGHLIGHTS: { key: Highlight; label: string }[] = [
  { key: 'original', label: 'Original route' },
  { key: 'alternative', label: 'Alternative route' },
  { key: 'chosen', label: 'Chosen route' },
]

/** Schematic placeholder: highlighted routes as ordered segment lists. */
export function MapPanel({
  facilities,
  segments,
  routes,
  selectedShipmentId,
  highlightedRouteIds,
  incidentSegmentId,
  candidateSegmentId,
  onSegmentClick,
}: MapPanelProps) {
  const idPrefix = useId()
  const segmentById = new Map(segments.map((s) => [s.id, s]))
  const facilityName = (id: string) => facilities.find((f) => f.id === id)?.name ?? id
  const segmentName = (id: string) => segmentById.get(id)?.name ?? id

  const shown = HIGHLIGHTS.flatMap(({ key, label }) => {
    const routeId = highlightedRouteIds[key]
    return routeId === undefined ? [] : [{ key, label, routeId }]
  })

  return (
    <div className="pp-map">
      <div className="pp-map__header">
        <h2 className="pp-map__title">Routes</h2>
        <span className="pp-map__badge">Map arrives in Phase 5</span>
      </div>
      <p className="pp-map__note">
        Illustrative routes: a schematic of segments in travel order, not a map.
      </p>

      {(incidentSegmentId !== null || candidateSegmentId !== null) && (
        <ul className="pp-map__incidents" aria-label="Incident segments">
          {incidentSegmentId !== null && (
            <li>
              <StatusTag kind="closed" /> {segmentName(incidentSegmentId)}
            </li>
          )}
          {candidateSegmentId !== null && (
            <li>
              <StatusTag kind="candidate" /> {segmentName(candidateSegmentId)}
            </li>
          )}
        </ul>
      )}

      {selectedShipmentId !== null && (
        <p className="pp-map__selection">
          Shipment <strong>{selectedShipmentId}</strong>
        </p>
      )}

      {shown.length === 0 ? (
        <p className="pp-map__empty">Select a shipment to see its routes</p>
      ) : (
        shown.map(({ key, label, routeId }) => {
          const route = routes.find((r) => r.id === routeId)
          const headingId = `${idPrefix}-route-${key}`
          return (
            <section key={key} className={`pp-map__route pp-map__route--${key}`}>
              <h3 id={headingId} className="pp-map__route-title">
                {label}: {routeId}
                {route && (
                  <span className="pp-map__route-ends">
                    {' '}
                    ({facilityName(route.origin)} to {facilityName(route.destination)})
                  </span>
                )}
              </h3>
              {route ? (
                <ol className="pp-map__segments" aria-labelledby={headingId}>
                  {route.segment_ids.map((segId, i) => {
                    const seg = segmentById.get(segId)
                    return (
                      <li key={`${segId}-${i}`}>
                        <button
                          type="button"
                          className="pp-map__segment"
                          onClick={() => onSegmentClick?.(segId)}
                        >
                          <span className="pp-map__segment-name">{seg?.name ?? segId}</span>
                          <span className="pp-map__segment-miles">
                            {seg ? `${seg.miles} mi` : 'miles unknown'}
                          </span>
                          {segId === incidentSegmentId && <StatusTag kind="closed" />}
                          {segId === candidateSegmentId && <StatusTag kind="candidate" />}
                        </button>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="pp-map__missing">Route not found in the sample data.</p>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}

function StatusTag({ kind }: { kind: 'closed' | 'candidate' }) {
  return kind === 'closed' ? (
    <span className="pp-map__tag pp-map__tag--closed">
      <span aria-hidden="true">{'⛔'} </span>Closed
    </span>
  ) : (
    <span className="pp-map__tag pp-map__tag--candidate">
      <span aria-hidden="true">? </span>Awaiting confirmation
    </span>
  )
}
