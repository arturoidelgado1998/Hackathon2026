import type { ReactNode } from 'react'
import type { Scenario } from '../../viewModels.ts'
import './AppShell.css'

export interface AppShellProps {
  scenario: Scenario
  onScenarioChange: (s: Scenario) => void
  onReset: () => void
  onReportIncident: () => void
  /** Indicators bar content. */
  indicators: ReactNode
  /** Triage board (D4). */
  board: ReactNode
  /** MapPanel. */
  map: ReactNode
  /** Response panel (D5). */
  responses: ReactNode
  /** Assumptions & sources (D8). */
  assumptions?: ReactNode
}

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'disrupted', label: 'Disrupted' },
]

/** Single-screen layout. Every region is a slot filled by the caller. */
export function AppShell({
  scenario,
  onScenarioChange,
  onReset,
  onReportIncident,
  indicators,
  board,
  map,
  responses,
  assumptions,
}: AppShellProps) {
  return (
    <div className="pp-shell">
      <header className="pp-shell__header">
        <div className="pp-shell__topbar">
          <h1 className="pp-shell__title">PortPlan</h1>
          <div className="pp-shell__controls">
            <div className="pp-shell__toggle" role="group" aria-label="Scenario">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="pp-shell__toggle-btn"
                  aria-pressed={scenario === s.id}
                  onClick={() => onScenarioChange(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button type="button" className="pp-shell__btn" onClick={onReset}>
              Reset
            </button>
            <button
              type="button"
              className="pp-shell__btn pp-shell__btn--primary"
              onClick={onReportIncident}
            >
              Report incident
            </button>
          </div>
        </div>
        <section className="pp-shell__indicators" aria-label="Indicators">
          {indicators}
        </section>
      </header>

      <main className="pp-shell__main">
        <section className="pp-shell__region pp-shell__board" aria-label="Triage board">
          {board}
        </section>
        <section className="pp-shell__region pp-shell__map" aria-label="Map panel">
          {map}
        </section>
        <section
          className="pp-shell__region pp-shell__responses"
          aria-label="Response options"
        >
          {responses}
        </section>
        {assumptions != null && (
          <section
            className="pp-shell__region pp-shell__assumptions"
            aria-label="Assumptions and sources"
          >
            {assumptions}
          </section>
        )}
      </main>
    </div>
  )
}
