import type { ReactNode } from 'react'
import type { Scenario } from '../../viewModels.ts'
import './AppShell.css'

export interface AppShellProps {
  scenario: Scenario
  onScenarioChange: (s: Scenario) => void
  onReset: () => void
  /** Omit until the incident flow exists; the button is then disabled. */
  onReportIncident?: () => void
  /** What changed: the current incident, or normal operations. */
  status?: ReactNode
  /** Indicators bar content. */
  indicators: ReactNode
  /** Shipment queue (D4). */
  board: ReactNode
  /** MapPanel. */
  map: ReactNode
  /** Response comparison (D5). */
  responses: ReactNode
  /** Assumptions & sources (D8). */
  assumptions?: ReactNode
}

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'disrupted', label: 'Disrupted' },
]

/**
 * Single-screen layout, read left to right in the order a dispatcher works:
 * which shipment, what are the options, where does it go.
 * Every region is a slot filled by the caller.
 */
export function AppShell({
  scenario,
  onScenarioChange,
  onReset,
  onReportIncident,
  status,
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
            <div className="pp-shell__scenario">
              <span className="pp-shell__scenario-label" id="pp-scenario-label">
                Scenario
              </span>
              <div className="pp-shell__toggle" role="group" aria-labelledby="pp-scenario-label">
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
            </div>
            <button type="button" className="pp-button" onClick={onReset}>
              Reset
            </button>
            <button
              type="button"
              className="pp-button pp-button--primary"
              onClick={onReportIncident}
              disabled={!onReportIncident}
              title={onReportIncident ? undefined : 'Incident reporting is not available yet'}
            >
              Report incident
            </button>
          </div>
        </div>
        <div className="pp-shell__statusbar">
          {status != null && (
            <section className="pp-shell__status" aria-label="Current situation">
              {status}
            </section>
          )}
          <section className="pp-shell__indicators" aria-label="Indicators">
            {indicators}
          </section>
        </div>
      </header>

      <main className="pp-shell__main">
        <section className="pp-shell__region pp-shell__board" aria-label="Triage board">
          {board}
        </section>
        <section
          className="pp-shell__region pp-shell__responses"
          aria-label="Response options"
        >
          {responses}
        </section>
        <section className="pp-shell__region pp-shell__map" aria-label="Map panel">
          {map}
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
