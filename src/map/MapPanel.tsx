import { Component, Suspense, lazy, useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { Decision, Facility, Route, RoadSegment } from '../types.ts'
import { ClosedIcon, QuestionIcon } from '../components/icons.tsx'
import './MapPanel.css'

// The ArcGIS map is loaded on demand. If it cannot load, the route list below
// still shows everything the map does, in text.
const ArcgisMap = lazy(() => import('./ArcgisMap.tsx'))

// G2 put the real map behind these props. Keep them stable.
export interface MapPanelProps {
  facilities: Facility[]
  segments: RoadSegment[]
  routes: Route[]
  selectedShipmentId: string | null
  highlightedRouteIds: { original?: string; alternative?: string; chosen?: string }
  /** Labels the highlighted choice without presenting a preview as committed. */
  highlightedDecision?: Decision | null
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

/** Catches a failed map load so the rest of the panel keeps working. */
class MapBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function LegendLine({ kind }: { kind: 'original' | 'alternative' | 'chosen' | 'closed' | 'network' }) {
  return (
    <svg className={`pp-map__legend-line pp-map__legend-line--${kind}`} width="28" height="8" aria-hidden="true">
      <line x1="2" y1="4" x2="26" y2="4" />
    </svg>
  )
}

/** The map, a legend, and the highlighted routes as ordered segment lists. */
export function MapPanel({
  facilities,
  segments,
  routes,
  selectedShipmentId,
  highlightedRouteIds,
  highlightedDecision = null,
  incidentSegmentId,
  candidateSegmentId,
  onSegmentClick,
}: MapPanelProps) {
  const idPrefix = useId()
  const [mapFailed, setMapFailed] = useState(false)
  const segmentById = new Map(segments.map((s) => [s.id, s]))
  const facilityName = (id: string) => facilities.find((f) => f.id === id)?.name ?? id
  const segmentName = (id: string) => segmentById.get(id)?.name ?? id

  const shown = HIGHLIGHTS.flatMap(({ key, label }) => {
    const routeId = highlightedRouteIds[key]
    const choiceLabel = key === 'chosen' && highlightedDecision?.shipment_id === selectedShipmentId
      ? highlightedDecision.status === 'previewed'
        ? 'Preview route'
        : highlightedDecision.status === 'pending_confirmation'
          ? 'Current route (slot pending confirmation)'
          : label
      : label
    return routeId === undefined ? [] : [{ key, label: choiceLabel, routeId }]
  })

  return (
    <div className="pp-map">
      <div className="pp-map__header">
        <h2 className="pp-map__title">Routes</h2>
        <span className="pp-map__badge">Illustrative</span>
      </div>
      <p className="pp-map__note">
        Lines are schematic and routes are not verified for trucks.
        {' '}Distances are simulated estimates.
      </p>

      {mapFailed ? (
        <p className="pp-map__fallback" role="status">
          The map could not load. The route list below shows the same information.
        </p>
      ) : (
        <>
          <div className="pp-map__canvas">
            <MapBoundary onError={() => setMapFailed(true)}>
              <Suspense fallback={<p className="pp-map__loading">Loading map…</p>}>
                <ArcgisMap
                  facilities={facilities}
                  segments={segments}
                  routes={routes}
                  highlightedRouteIds={highlightedRouteIds}
                  incidentSegmentId={incidentSegmentId}
                  candidateSegmentId={candidateSegmentId}
                  onSegmentClick={onSegmentClick}
                  onError={() => setMapFailed(true)}
                />
              </Suspense>
            </MapBoundary>
          </div>
          <ul className="pp-map__legend" aria-label="Map legend">
            <li>
              <LegendLine kind="original" /> Original route
            </li>
            <li>
              <LegendLine kind="alternative" /> Alternative route
            </li>
            <li>
              <LegendLine kind="chosen" /> Previewed or chosen
            </li>
            <li>
              <LegendLine kind="closed" /> Closed
            </li>
            <li>
              <LegendLine kind="network" /> Other segments
            </li>
          </ul>
        </>
      )}

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
                    const closed = segId === incidentSegmentId
                    const content = (
                      <>
                        <span className="pp-map__segment-name">{seg?.name ?? segId}</span>
                        <span className="pp-map__segment-miles pp-num">
                          {seg ? `Est. ${seg.miles} mi` : 'miles unknown'}
                        </span>
                        {closed && <StatusTag kind="closed" />}
                        {segId === candidateSegmentId && <StatusTag kind="candidate" />}
                      </>
                    )
                    return (
                      <li
                        key={`${segId}-${i}`}
                        className={closed ? 'pp-map__stop pp-map__stop--closed' : 'pp-map__stop'}
                      >
                        {/* A segment is only a control when something listens for it. */}
                        {onSegmentClick ? (
                          <button
                            type="button"
                            className="pp-map__segment pp-map__segment--button"
                            onClick={() => onSegmentClick(segId)}
                          >
                            {content}
                          </button>
                        ) : (
                          <span className="pp-map__segment">{content}</span>
                        )}
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
      <ClosedIcon size={12} /> Closed
    </span>
  ) : (
    <span className="pp-map__tag pp-map__tag--candidate">
      <QuestionIcon size={12} /> Awaiting confirmation
    </span>
  )
}
