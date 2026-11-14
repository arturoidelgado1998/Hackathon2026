import { useState } from 'react'
import { TriageBoard } from './components/board/index.ts'
import { ResponsePanel } from './components/responses/index.ts'
import { AppShell } from './components/shell/AppShell.tsx'
import { IndicatorsBar } from './components/shell/IndicatorsBar.tsx'
import { facilities, routes, segments } from './data/index.ts'
import { MapPanel } from './map/MapPanel.tsx'
import {
  buildCards,
  buildHighlightedRoutes,
  buildResponseView,
  incidentSegmentFor,
} from './state/selectors.ts'
import type { Scenario } from './viewModels.ts'

// Scenario and selection live in local state for now. D6 replaces this with
// the app store (decisions, preview, select); D7 binds the indicators and
// Reset; A2 wires Report incident.
function App() {
  const [scenario, setScenario] = useState<Scenario>('normal')
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null)

  return (
    <AppShell
      scenario={scenario}
      onScenarioChange={setScenario}
      onReset={() => {
        setScenario('normal')
        setSelectedShipmentId(null)
      }}
      onReportIncident={() => {}}
      indicators={<IndicatorsBar atRisk={null} cost={null} co2Kg={null} />}
      board={
        <TriageBoard
          cards={buildCards(scenario)}
          selectedShipmentId={selectedShipmentId}
          onSelectShipment={setSelectedShipmentId}
        />
      }
      map={
        <MapPanel
          facilities={facilities}
          segments={segments}
          routes={routes}
          selectedShipmentId={selectedShipmentId}
          highlightedRouteIds={buildHighlightedRoutes(selectedShipmentId)}
          incidentSegmentId={incidentSegmentFor(scenario)}
          candidateSegmentId={null}
        />
      }
      responses={<ResponsePanel view={buildResponseView(selectedShipmentId, scenario)} />}
    />
  )
}

export default App
