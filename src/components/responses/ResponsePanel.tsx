import type { ReactNode } from 'react'
import type { ResponseOption, ResponseOptionKind, RiskLabel } from '../../types'
import type { ResponsePanelView } from '../../viewModels'
import { ResponseCard } from './ResponseCard'
import './responses.css'

export interface ResponsePanelProps {
  view: ResponsePanelView | null
  /** "Why?" button; wired in a later issue. */
  onWhy?: (kind: ResponseOptionKind) => void
  /** Slot for Preview/Select buttons, added later. */
  renderActions?: (option: ResponseOption) => ReactNode
}

const FEASIBLE: RiskLabel[] = ['ON_TRACK', 'TIGHT']

function hasFeasibleOption(options: ResponseOption[]): boolean {
  return options.some(
    (o) => (o.kind === 'wait' || o.kind === 'reroute') && FEASIBLE.includes(o.risk),
  )
}

export function ResponsePanel({ view, onWhy, renderActions }: ResponsePanelProps) {
  if (view === null) {
    return (
      <div className="responses-panel">
        <p className="responses-empty">Select a shipment to compare responses.</p>
      </div>
    )
  }

  const heading = `Responses for ${view.shipment.id} to ${view.destinationName}`

  if (view.options.length === 0) {
    return (
      <div className="responses-panel">
        <h2 id="responses-heading" className="responses-heading">
          {heading}
        </h2>
        <p className="responses-empty">
          No response needed: this shipment is not affected by the current incident.
        </p>
      </div>
    )
  }

  return (
    <div className="responses-panel">
      <h2 id="responses-heading" className="responses-heading">
        {heading}
      </h2>
      <p className="responses-note">
        All values are estimates. Options are shown in a fixed order and are not ranked.
      </p>
      {!hasFeasibleOption(view.options) && (
        <p className="responses-banner" role="alert">
          <span className="responses-warning-icon" role="img" aria-label="Warning">
            ⚠
          </span>{' '}
          No currently feasible response: review with warehouse or customer.
        </p>
      )}
      <div className="responses-cards">
        {view.options.map((option) => (
          <ResponseCard
            key={option.kind}
            option={option}
            baseline={view.baseline}
            community={view.community[option.kind]}
            onWhy={onWhy}
            renderActions={renderActions}
          />
        ))}
      </div>
    </div>
  )
}
