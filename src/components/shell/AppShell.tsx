import { useId, useRef, useState, type ReactNode } from 'react'
import type { Scenario } from '../../viewModels.ts'
import { QuestionIcon } from '../icons.tsx'
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
  /** Fed by live data: the scenario is not switched by hand. */
  liveMode?: boolean
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
  liveMode = false,
}: AppShellProps) {
  const [assumptionsExpanded, setAssumptionsExpanded] = useState(false)
  const assumptionsId = useId()
  const assumptionsToggle = useRef<HTMLButtonElement>(null)

  return (
    <div className="pp-shell">
      <header className="pp-shell__header">
        <div className="pp-shell__topbar">
          <h1 className="pp-shell__title">PortPlan</h1>
          <div className="pp-shell__controls">
            {!liveMode && (
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
            )}
            <button
              type="button"
              className="pp-button"
              onClick={() => {
                setAssumptionsExpanded(false)
                onReset()
              }}
            >
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
        {scenario === 'normal' && !liveMode && (
          <p className="pp-shell__guidance">
            <strong>Explore the sample disruption:</strong> switch to <strong>Disrupted</strong>,
            {' '}then select a shipment under <strong>Needs review</strong> to compare responses.
          </p>
        )}
      </header>

      <main className="pp-shell__main">
        <section
          className="pp-shell__region pp-shell__board"
          id="shipment-queue"
          tabIndex={-1}
          aria-label="Triage board"
        >
          {board}
        </section>
        <section
          className="pp-shell__region pp-shell__responses"
          id="response-options"
          tabIndex={-1}
          aria-label="Response options"
        >
          <a className="pp-shell__back-link" href="#shipment-queue">
            Back to shipments
          </a>
          {responses}
        </section>
        <section className="pp-shell__region pp-shell__map" aria-label="Map panel" tabIndex={0}>
          {map}
        </section>
        {assumptions != null && (
          <section
            className="pp-shell__region pp-shell__assumptions"
            aria-label="Assumptions and sources"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && assumptionsExpanded) {
                setAssumptionsExpanded(false)
                assumptionsToggle.current?.focus()
              }
            }}
          >
            <button
              ref={assumptionsToggle}
              type="button"
              className="pp-shell__assumptions-toggle"
              aria-expanded={assumptionsExpanded}
              aria-controls={assumptionsId}
              onClick={() => setAssumptionsExpanded((expanded) => !expanded)}
            >
              <span className="pp-shell__assumptions-title">
                <QuestionIcon size={20} />
                <span>
                  <strong>Assumptions & sources</strong>
                  <span className="pp-shell__assumptions-hint">
                    Model inputs, value types and prototype limitations
                  </span>
                </span>
              </span>
              <span className="pp-shell__assumptions-action">
                {assumptionsExpanded ? 'Collapse panel' : 'Expand panel'}
                <span className="pp-shell__drawer-chevron" aria-hidden="true" />
              </span>
            </button>
            <div
              id={assumptionsId}
              className="pp-shell__assumptions-content"
              hidden={!assumptionsExpanded}
              tabIndex={0}
              role="region"
              aria-label="Assumptions details"
            >
              {assumptions}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
