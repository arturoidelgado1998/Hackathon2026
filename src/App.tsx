import { useReducer } from 'react'
import { AssumptionsPanel } from './components/assumptions/AssumptionsPanel.tsx'
import { TriageBoard } from './components/board/index.ts'
import { ResponsePanel } from './components/responses/index.ts'
import { SuggestionPanel } from './components/suggestion/SuggestionPanel.tsx'
import { OPTION_ACTION_LABELS, OPTION_TITLES } from './components/responses/format.ts'
import { AppShell } from './components/shell/AppShell.tsx'
import { IncidentBanner } from './components/shell/IncidentBanner.tsx'
import { IndicatorsBar } from './components/shell/IndicatorsBar.tsx'
import { facilities, getSegment, routes, sampleIncident, segments } from './data/index.ts'
import { MapPanel } from './map/MapPanel.tsx'
import { isResponseOptionAvailable } from './state/options.ts'
import { appReducer, initialState } from './state/reducer.ts'
import {
  buildCards,
  buildHighlightedRoutes,
  buildResponseView,
  incidentSegmentFor,
} from './state/selectors.ts'
import { getTotals } from './state/totals.ts'

function App() {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const { scenario, selectedShipmentId, decisions, previewDecision, rejectedShipmentIds } = state
  const incident = scenario === 'disrupted' ? sampleIncident : null
  const cards = buildCards(scenario, decisions, rejectedShipmentIds)
  const responseView = buildResponseView(selectedShipmentId, scenario)
  const selectedCard = cards.find((card) => card.shipment.id === selectedShipmentId)
  const selectedDecision = selectedShipmentId ? decisions[selectedShipmentId] : undefined
  const highlightedDecision = previewDecision ?? selectedDecision ?? null
  const totals = getTotals(state)

  return (
    <AppShell
      scenario={scenario}
      onScenarioChange={(next) => dispatch({ type: 'set_scenario', scenario: next })}
      onReset={() => dispatch({ type: 'reset' })}
      status={
        <IncidentBanner
          incident={incident}
          segmentName={incident ? getSegment(incident.segment_id)?.name : undefined}
        />
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
          highlightedRouteIds={buildHighlightedRoutes(
            selectedShipmentId,
            previewDecision,
            decisions,
          )}
          highlightedDecision={highlightedDecision}
          incidentSegmentId={incidentSegmentFor(scenario)}
          candidateSegmentId={null}
        />
      }
      responses={
        <>
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
        {/* Asked for, never shown unasked; it selects nothing and feeds no total. */}
        <SuggestionPanel
          key={`suggestion:${scenario}:${selectedShipmentId ?? 'none'}`}
          view={responseView}
        />
        </>
      }
      assumptions={<AssumptionsPanel />}
    />
  )
}

export default App
