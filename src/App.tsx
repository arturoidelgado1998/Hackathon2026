import { useMemo, useReducer, useRef } from 'react'
import { AssumptionsPanel } from './components/assumptions/AssumptionsPanel.tsx'
import { ScheduleBoard, TriageBoard } from './components/board/index.ts'
import { ResponsePanel } from './components/responses/index.ts'
import { OPTION_ACTION_LABELS, OPTION_TITLES } from './components/responses/format.ts'
import { AppShell } from './components/shell/AppShell.tsx'
import { IncidentBanner } from './components/shell/IncidentBanner.tsx'
import {
  IncidentInterpretationFeedback,
  type IncidentInterpretationStatus,
} from './components/shell/IncidentInterpretationFeedback.tsx'
import { IndicatorsBar } from './components/shell/IndicatorsBar.tsx'
import {
  facilities,
  getActiveIncident,
  getFacility,
  getSegment,
  getShipment,
  routes,
  segments,
  setActiveIncident,
  shipments,
} from './data/index.ts'
import { clearDriverNotices } from './driver/desk.ts'
import { DriverNoticeDesk } from './driver/DriverNoticeDesk.tsx'
import { MapPanel } from './map/MapPanel.tsx'
import { parseTime } from './engine/time.ts'
import { liveEvents, liveNote } from './sim/events.ts'
import { LiveUpdates } from './sim/LiveUpdates.tsx'
import { incidentOf, type SimSettings } from './sim/settings.ts'
import { truckStateAt } from './sim/trucks.ts'
import { useLiveSim } from './sim/useLiveSim.ts'
import { isResponseOptionAvailable } from './state/options.ts'
import { appReducer, initialState, type AppState } from './state/reducer.ts'
import {
  buildCards,
  buildHighlightedRoutes,
  buildResponseView,
  incidentSegmentFor,
} from './state/selectors.ts'
import { getTotals } from './state/totals.ts'
import { buildTruckPlans } from './state/trucks.ts'

const SEGMENT_IDS = segments.map((segment) => segment.id)
const NO_ROUTES = {}

const segmentName = (id: string) => getSegment(id)?.name ?? id
const destinationOf = (shipmentId: string) => {
  const shipment = getShipment(shipmentId)
  return shipment ? (getFacility(shipment.destination_id)?.name ?? shipment.destination_id) : shipmentId
}
const SCHEDULE = shipments.map((shipment) => ({
  shipment,
  destinationName: getFacility(shipment.destination_id)?.name ?? shipment.destination_id,
}))

export interface AppProps {
  /** Sample/integration entry point only; this does not enable incident reporting. */
  incidentInterpretationStatus?: IncidentInterpretationStatus
  /**
   * The product: nothing is prefilled. The page shows the day's schedule until
   * live updates start, then fills in as they arrive. Without it the page is
   * the prefilled sample, with its Normal/Disrupted switch.
   */
  live?: boolean
}

/** A live day starts quiet: no incident has been reported yet. */
const liveInitialState: AppState = { ...initialState, scenario: 'normal' }

function App({ incidentInterpretationStatus = 'idle', live: liveMode = false }: AppProps) {
  const [state, dispatch] = useReducer(appReducer, liveMode ? liveInitialState : initialState)
  const { scenario, selectedShipmentId, decisions, previewDecision, rejectedShipmentIds } = state
  const incident = scenario === 'disrupted' ? getActiveIncident() : null
  const cards = buildCards(scenario, decisions, rejectedShipmentIds)
  const responseView = buildResponseView(selectedShipmentId, scenario)
  const selectedCard = cards.find((card) => card.shipment.id === selectedShipmentId)
  const selectedDecision = selectedShipmentId ? decisions[selectedShipmentId] : undefined
  const highlightedDecision = previewDecision ?? selectedDecision ?? null
  const totals = getTotals(state)

  // Memoised so the clock's ticks do not redraw the routes or re-frame the map.
  const highlightedRouteIds = useMemo(
    () => buildHighlightedRoutes(selectedShipmentId, previewDecision, decisions),
    [selectedShipmentId, previewDecision, decisions],
  )

  // Truck positions and the closure arrive from the simulation page, which
  // stands in for a live feed. This page has no simulation controls and does
  // not mention it. A closure is only known here once its start time has
  // passed; when it is reported (or withdrawn), the incident changes and the
  // decisions made before it are cleared.
  const setupKey = useRef<string>('normal')
  const live = useLiveSim(liveMode, SEGMENT_IDS, (settings: SimSettings, time: number, started: boolean) => {
    const reported = started && settings.closure && time >= parseTime(settings.start)
    const key = reported ? `${settings.segmentId}|${settings.start}|${settings.reopen}` : 'normal'
    if (key === setupKey.current) return
    setupKey.current = key
    setActiveIncident(reported ? incidentOf(settings) : null)
    clearDriverNotices()
    dispatch({ type: 'set_scenario', scenario: reported ? 'disrupted' : 'normal' })
  })
  /** Live mode before any update: only the schedule is known. */
  const scheduleOnly = liveMode && !live?.started
  const timingCase = live?.settings.timingCase ?? 'slow'
  const truckPlans = useMemo(
    () => buildTruckPlans(scenario, decisions, timingCase),
    // `incident` is listed because a new closure changes the trips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenario, decisions, timingCase, incident],
  )
  const liveTime = live?.started ? live.time : null
  const truckStates = useMemo(
    () => (liveTime === null ? undefined : truckPlans.map((plan) => truckStateAt(plan, liveTime, segments))),
    [truckPlans, liveTime],
  )

  // Once the reported reopening time has passed, the road is drawn open again.
  const reopenAt = incident ? (incident.assumed_reopen_time ?? incident.reported_reopen_time) : null
  const reopened = liveTime !== null && reopenAt !== null && liveTime >= parseTime(reopenAt)

  const liveCards =
    truckStates === undefined
      ? cards
      : cards.map((card, i) => ({ ...card, liveNote: liveNote(truckPlans[i], truckStates[i], segmentName) }))
  // The log is rebuilt once a simulated minute, not on every tick.
  const liveMinute = liveTime === null ? null : Math.floor(liveTime)
  const events = useMemo(
    () =>
      liveMinute === null
        ? []
        : liveEvents(truckPlans, incident, liveMinute, { segmentName, destinationName: destinationOf }),
    [truckPlans, incident, liveMinute],
  )

  return (
    <AppShell
      liveMode={liveMode}
      scenario={scenario}
      onScenarioChange={(next) => dispatch({ type: 'set_scenario', scenario: next })}
      onReset={() => {
        clearDriverNotices()
        // A live day keeps whatever has been reported; only the choices are cleared.
        dispatch(liveMode ? { type: 'set_scenario', scenario } : { type: 'reset' })
      }}
      status={
        <>
          {scheduleOnly ? (
            <p className="pp-incident pp-incident--clear">
              <span>
                <strong>Waiting for live updates.</strong> Today’s schedule is shown; estimates
                appear as updates arrive.
              </span>
            </p>
          ) : (
            <IncidentBanner
              incident={incident}
              segmentName={incident ? getSegment(incident.segment_id)?.name : undefined}
              reopened={reopened}
            />
          )}
          <IncidentInterpretationFeedback status={incidentInterpretationStatus} />
        </>
      }
      indicators={
        scheduleOnly ? <IndicatorsBar atRisk={null} cost={null} co2Kg={null} /> : <IndicatorsBar {...totals} />
      }
      board={
        scheduleOnly ? (
          <ScheduleBoard shipments={SCHEDULE} />
        ) : (
          <TriageBoard
            cards={liveCards}
            selectedShipmentId={selectedShipmentId}
            onSelectShipment={(shipmentId) => dispatch({ type: 'select_shipment', shipmentId })}
            onRejectAll={(shipmentId) => dispatch({ type: 'reject_all', shipmentId })}
            showEmptyGroups={state.showEmptyGroups}
            onToggleEmptyGroups={() => dispatch({ type: 'toggle_empty_groups' })}
          />
        )
      }
      map={
        <MapPanel
          facilities={facilities}
          segments={segments}
          routes={routes}
          selectedShipmentId={scheduleOnly ? null : selectedShipmentId}
          highlightedRouteIds={scheduleOnly ? NO_ROUTES : highlightedRouteIds}
          highlightedDecision={highlightedDecision}
          incidentSegmentId={scheduleOnly || reopened ? null : incidentSegmentFor(scenario)}
          candidateSegmentId={null}
          trucks={truckStates}
          footer={liveTime === null ? undefined : <LiveUpdates now={liveTime} events={events} />}
        />
      }
      responses={
        scheduleOnly ? (
          <section className="responses-panel" aria-label="Compare responses">
            <h2 className="responses-title">Compare responses</h2>
            <p className="responses-empty">
              Nothing to compare yet. Responses appear when live updates arrive and a shipment
              needs review.
            </p>
          </section>
        ) : (
          <>
            <DriverNoticeDesk
              view={responseView}
              scenario={scenario}
              decisions={decisions}
              incident={incident}
            />
            <ResponsePanel
              key={`${scenario}:${selectedShipmentId ?? 'none'}`}
              decision={selectedDecision}
              previewDecision={previewDecision}
              onCancelPreview={() => dispatch({ type: 'cancel_preview' })}
              onUndo={
                state.lastDecisionChange?.shipmentId === selectedShipmentId
                  ? () => dispatch({ type: 'undo_decision' })
                  : undefined
              }
              view={
                responseView && selectedCard
                  ? { ...responseView, summary: selectedCard.summary }
                  : responseView
              }
              renderActions={(option) => {
                if (!selectedShipmentId) return null
                const unavailable = !isResponseOptionAvailable(option)
                const title = OPTION_TITLES[option.kind]
                return (
                  <>
                    <button
                      type="button"
                      className="pp-button"
                      aria-label={`Preview ${title}`}
                      aria-pressed={previewDecision?.option_kind === option.kind}
                      disabled={unavailable}
                      title={unavailable ? option.status : undefined}
                      onClick={() =>
                        dispatch({
                          type: 'preview',
                          shipmentId: selectedShipmentId,
                          optionKind: option.kind,
                          timestamp: new Date().toISOString(),
                        })
                      }
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      className="pp-button pp-button--primary"
                      aria-pressed={selectedDecision?.option_kind === option.kind}
                      disabled={unavailable}
                      title={unavailable ? option.status : undefined}
                      onClick={() =>
                        dispatch({
                          type: 'select_option',
                          shipmentId: selectedShipmentId,
                          optionKind: option.kind,
                          timestamp: new Date().toISOString(),
                        })
                      }
                    >
                      {OPTION_ACTION_LABELS[option.kind]}
                    </button>
                  </>
                )
              }}
            />
          </>
        )
      }
      assumptions={<AssumptionsPanel />}
    />
  )
}

export default App
