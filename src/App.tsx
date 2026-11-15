import { useMemo, useReducer } from 'react'
import { AssumptionsPanel } from './components/assumptions/AssumptionsPanel.tsx'
import { TriageBoard } from './components/board/index.ts'
import { ResponsePanel } from './components/responses/index.ts'
import { OPTION_ACTION_LABELS, OPTION_TITLES } from './components/responses/format.ts'
import { AppShell } from './components/shell/AppShell.tsx'
import { IncidentBanner } from './components/shell/IncidentBanner.tsx'
import {
  IncidentInterpretationFeedback,
  type IncidentInterpretationStatus,
} from './components/shell/IncidentInterpretationFeedback.tsx'
import { IndicatorsBar } from './components/shell/IndicatorsBar.tsx'
import { facilities, getSegment, routes, sampleIncident, segments } from './data/index.ts'
import { clearDriverNotices } from './driver/desk.ts'
import { DriverNoticeDesk } from './driver/DriverNoticeDesk.tsx'
import { MapPanel } from './map/MapPanel.tsx'
import { SimClock } from './sim/SimClock.tsx'
import { simWindow, truckStateAt } from './sim/trucks.ts'
import { useSimClock } from './sim/useSimClock.ts'
import { isResponseOptionAvailable } from './state/options.ts'
import { appReducer, initialState } from './state/reducer.ts'
import {
  buildCards,
  buildHighlightedRoutes,
  buildResponseView,
  incidentSegmentFor,
} from './state/selectors.ts'
import { getTotals } from './state/totals.ts'
import { buildTruckPlans } from './state/trucks.ts'

export interface AppProps {
  /** Sample/integration entry point only; this does not enable incident reporting. */
  incidentInterpretationStatus?: IncidentInterpretationStatus
}

function App({ incidentInterpretationStatus = 'idle' }: AppProps) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const { scenario, selectedShipmentId, decisions, previewDecision, rejectedShipmentIds } = state
  const incident = scenario === 'disrupted' ? sampleIncident : null
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

  // Truck simulation: trips come from the engine; the clock only picks a moment.
  const truckPlans = useMemo(() => buildTruckPlans(scenario, decisions), [scenario, decisions])
  const simRange = useMemo(() => simWindow(truckPlans), [truckPlans])
  const simClock = useSimClock(simRange.start, simRange.end)
  const truckStates = useMemo(
    () => truckPlans.map((plan) => truckStateAt(plan, simClock.time, segments)),
    [truckPlans, simClock.time],
  )

  return (
    <AppShell
      scenario={scenario}
      onScenarioChange={(next) => dispatch({ type: 'set_scenario', scenario: next })}
      onReset={() => {
        clearDriverNotices()
        simClock.restart()
        dispatch({ type: 'reset' })
      }}
      status={
        <>
          <IncidentBanner
            incident={incident}
            segmentName={incident ? getSegment(incident.segment_id)?.name : undefined}
          />
          <IncidentInterpretationFeedback status={incidentInterpretationStatus} />
        </>
      }
      indicators={<IndicatorsBar {...totals} />}
      board={
        <TriageBoard
          cards={cards}
          selectedShipmentId={selectedShipmentId}
          onSelectShipment={(shipmentId) => dispatch({ type: 'select_shipment', shipmentId })}
          onRejectAll={(shipmentId) => dispatch({ type: 'reject_all', shipmentId })}
          showEmptyGroups={state.showEmptyGroups}
          onToggleEmptyGroups={() => dispatch({ type: 'toggle_empty_groups' })}
        />
      }
      map={
        <MapPanel
          facilities={facilities}
          segments={segments}
          routes={routes}
          selectedShipmentId={selectedShipmentId}
          highlightedRouteIds={highlightedRouteIds}
          highlightedDecision={highlightedDecision}
          incidentSegmentId={incidentSegmentFor(scenario)}
          candidateSegmentId={null}
          trucks={truckStates}
          simClock={
            <SimClock
              clock={simClock}
              start={simRange.start}
              end={simRange.end}
              plans={truckPlans}
              states={truckStates}
              segmentName={(id) => getSegment(id)?.name ?? id}
              pageHref={`simulation.html?closure=${scenario === 'disrupted' ? 1 : 0}`}
            />
          }
        />
      }
      responses={
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
      }
      assumptions={<AssumptionsPanel />}
    />
  )
}

export default App
