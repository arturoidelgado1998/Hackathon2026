import type { ReactNode } from 'react'
import type { ResponseOption, ResponseOptionKind } from '../../types'
import type { Baseline, CommunityInfo } from '../../viewModels'
import { delta, deltaOneDecimal } from './deltas'
import {
  OPTION_TITLES,
  PENDING_SLOT_TEXT,
  RISK_TEXT,
  formatAppointment,
  formatArrival,
  formatCo2,
  formatCo2Delta,
  formatCost,
  formatMiles,
  formatMilesDelta,
} from './format'
import { StakeholderStrip } from './StakeholderStrip'

export interface ResponseCardProps {
  option: ResponseOption
  baseline: Baseline
  community?: CommunityInfo
  onWhy?: (kind: ResponseOptionKind) => void
  renderActions?: (option: ResponseOption) => ReactNode
}

export function ResponseCard({ option, baseline, community, onWhy, renderActions }: ResponseCardProps) {
  const title = OPTION_TITLES[option.kind]
  const titleId = `response-card-${option.kind}`
  const pending = option.kind === 'request_slot'
  const milesDelta = formatMilesDelta(delta(option.miles, baseline.miles))
  const co2Delta = formatCo2Delta(deltaOneDecimal(option.co2_kg, baseline.co2_kg))
  const actions = renderActions?.(option)

  return (
    <article
      className={`responses-card${pending ? ' responses-card--pending' : ''}`}
      aria-labelledby={titleId}
      data-kind={option.kind}
    >
      <h3 id={titleId} className="responses-card-title">
        {title}
      </h3>

      {pending && (
        <p className="responses-pending" role="note">
          <span aria-hidden="true">⏳</span> {PENDING_SLOT_TEXT}
        </p>
      )}

      <dl className="responses-metrics">
        <dt>Est. arrival</dt>
        <dd>{formatArrival(option)}</dd>

        <dt>Appointment</dt>
        <dd>{formatAppointment(option)}</dd>

        <dt>Risk</dt>
        <dd>
          <span className={`responses-risk responses-risk--${option.risk.toLowerCase()}`}>
            {RISK_TEXT[option.risk]}
          </span>
        </dd>

        <dt>Est. miles</dt>
        <dd>
          {formatMiles(option.miles)}
          {option.miles !== null && (
            <span className="responses-delta"> ({milesDelta} vs. normal)</span>
          )}
        </dd>

        <dt>Est. cost</dt>
        <dd>{formatCost(option.cost)}</dd>

        <dt>Est. tailpipe CO2</dt>
        <dd>
          {formatCo2(option.co2_kg)}
          {option.co2_kg !== null && (
            <span className="responses-delta"> ({co2Delta} vs. normal)</span>
          )}
        </dd>

        {!(pending && option.status === PENDING_SLOT_TEXT) && (
          <>
            <dt>Status</dt>
            <dd>{option.status || 'n/a'}</dd>
          </>
        )}
      </dl>

      <StakeholderStrip option={option} baseline={baseline} community={community} />

      <div className="responses-card-actions">
        <button
          type="button"
          className="responses-why"
          onClick={() => onWhy?.(option.kind)}
          aria-label={`Why? (${title})`}
        >
          Why?
        </button>
        {actions}
      </div>
    </article>
  )
}
