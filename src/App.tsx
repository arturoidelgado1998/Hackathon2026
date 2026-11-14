import { useState } from 'react'
import { AppShell } from './components/shell/AppShell.tsx'
import { IndicatorsBar } from './components/shell/IndicatorsBar.tsx'
import { MapPanel } from './map/MapPanel.tsx'
import type { Scenario } from './viewModels.ts'

// Slot contents are placeholders until the board (D4), response cards (D5)
// and sample data (D2) are wired in.
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
      board={<p>Triage board</p>}
      map={
        <MapPanel
          facilities={[]}
          segments={[]}
          routes={[]}
          selectedShipmentId={selectedShipmentId}
          highlightedRouteIds={{}}
          incidentSegmentId={null}
          candidateSegmentId={null}
        />
      }
      responses={<p>Response options</p>}
    />
  )
}

export default App
