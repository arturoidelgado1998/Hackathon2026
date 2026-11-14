import type { ReactNode } from 'react'
import type { ResponseOption, ResponseOptionKind } from '../../types'
import type { Baseline, CommunityInfo, ResponsePanelView } from '../../viewModels'
import { RiskBadge } from '../board/RiskBadge'
import { AlertIcon, ClockIcon } from '../icons'
import { delta, deltaOneDecimal } from './deltas'
import {
  NA,
  NOT_MODELED_TEXT,
  OPTION_TITLES,
  PENDING_STRIP_TEXT,
  formatAppointment,
  formatArrival,
  formatCo2,
  formatCo2Delta,
  formatCommunityCounts,
  formatCost,
  formatDutyDelta,
  formatMiles,
  formatMilesDelta,
} from './format'
import './responses.css'

export interface ResponsePanelProps {
  view: ResponsePanelView | null
  /** "Why?" button; wired in a later issue. */
  onWhy?: (kind: ResponseOptionKind) => void
  /** Slot for Preview/Select buttons, added later. */
  renderActions?: (option: ResponseOption) => ReactNode
}

/** Risk labels that count as meeting, or possibly meeting, the appointment. */
const FEASIBLE: ResponseOption['risk'][] = ['ON_TRACK', 'TIGHT']

function hasFeasibleOption(options: ResponseOption[]): boolean {
  return options.some(
    (o) => (o.kind === 'wait' || o.kind === 'reroute') && FEASIBLE.includes(o.risk),
  )
}

const isPending = (o: ResponseOption) => o.kind === 'request_slot'

function Warning({ children }: { children: ReactNode }) {
  return (
    <span className="responses-warning">
      <AlertIcon size={13} label="Warning" /> {children}
    </span>
  )
}

function communityCell(option: ResponseOption, community?: CommunityInfo): ReactNode {
  if (isPending(option)) return PENDING_STRIP_TEXT
  if (!community || community.schools_150m === null) {
    return option.passes_sensitive_zone ? (
      <Warning>Passes a flagged zone (placeholder)</Warning>
    ) : (
      'No flagged zone on this route (placeholder)'
    )
  }
  const schools = community.schools_150m
  const tracts = community.dac_tracts === null ? null : community.dac_tracts.length
  const text = formatCommunityCounts(schools, tracts)
  return schools > 0 || (tracts !== null && tracts > 0) ? <Warning>{text}</Warning> : text
}

/** A value with its change against the normal scenario underneath. */
function withChange(value: string, change: string | null): ReactNode {
  return (
    <>
      <span className="pp-num">{value}</span>
      {change !== null && <span className="responses-change pp-num">{change}</span>}
    </>
  )
}

interface Row {
  label: string
  cell: (option: ResponseOption, baseline: Baseline, community?: CommunityInfo) => ReactNode
}

const DELIVERY_ROWS: Row[] = [
  { label: 'Est. arrival', cell: (o) => <span className="pp-num">{formatArrival(o)}</span> },
  {
    label: 'Appointment',
    cell: (o) => (isPending(o) ? 'Not confirmed yet' : formatAppointment(o)),
  },
  { label: 'Risk', cell: (o) => <RiskBadge risk={o.risk} /> },
  { label: 'Est. cost', cell: (o) => <span className="pp-num">{formatCost(o.cost)}</span> },
]

const IMPACT_ROWS: Row[] = [
  {
    label: 'Driver',
    cell: (o, baseline) => {
      if (isPending(o)) return PENDING_STRIP_TEXT
      if (o.driver_duty_min === null) return NA
      return withChange(
        `${o.driver_duty_min} min on duty`,
        formatDutyDelta(delta(o.driver_duty_min, baseline.driver_duty_min)),
      )
    },
  },
  { label: 'Community', cell: (o, _baseline, community) => communityCell(o, community) },
  {
    label: 'Environment: miles',
    cell: (o, baseline) => {
      if (isPending(o)) return PENDING_STRIP_TEXT
      if (o.miles === null) return NA
      return withChange(
        formatMiles(o.miles),
        `${formatMilesDelta(delta(o.miles, baseline.miles))} vs. normal`,
      )
    },
  },
  {
    label: 'Environment: est. tailpipe CO2',
    cell: (o, baseline) => {
      if (isPending(o)) return PENDING_STRIP_TEXT
      if (o.co2_kg === null) return NA
      return withChange(
        formatCo2(o.co2_kg),
        `${formatCo2Delta(deltaOneDecimal(o.co2_kg, baseline.co2_kg))} vs. normal`,
      )
    },
  },
]

/**
 * Side-by-side comparison of the response options for one shipment.
 * One table, so the same measure lines up across every option. Options
 * keep the order they are given in and are never ranked or scored.
 */
export function ResponsePanel({ view, onWhy, renderActions }: ResponsePanelProps) {
  if (view === null) {
    return (
      <div className="responses-panel responses-panel--empty">
        <h2 className="responses-heading">Compare responses</h2>
        <p className="responses-empty">Select a shipment to compare responses.</p>
        <p className="responses-hint">
          Shipments under Needs review are affected by the current incident and have options to
          compare.
        </p>
      </div>
    )
  }

  const { shipment, destinationName, summary, options, baseline, community } = view
  const header = (
    <header className="responses-header">
      <h2 id="responses-heading" className="responses-heading">
        Responses for {shipment.id} to {destinationName}
      </h2>
      <p className="responses-context">
        <span>
          Appointment{' '}
          <strong className="pp-num">
            {shipment.appt_start}–{shipment.appt_end}
          </strong>
        </span>
        {summary && (
          <>
            <RiskBadge risk={summary.risk} />
            <span className="responses-reason">{summary.reason}</span>
          </>
        )}
      </p>
    </header>
  )

  if (options.length === 0) {
    return (
      <div className="responses-panel">
        {header}
        <p className="responses-empty">
          No response needed: this shipment is not affected by an incident.
        </p>
      </div>
    )
  }

  const columns = options.length + 1

  return (
    <div className="responses-panel">
      {header}
      {!hasFeasibleOption(options) && (
        <p className="responses-banner" role="alert">
          <AlertIcon size={14} label="Warning" />
          <span>No currently feasible response: review with warehouse or customer.</span>
        </p>
      )}
      <table className="responses-table" aria-labelledby="responses-heading">
        <caption className="responses-note">
          All values are estimates. Options are shown in a fixed order and are not ranked.
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="pp-visually-hidden">Measure</span>
            </th>
            {options.map((o) => (
              <th key={o.kind} scope="col" data-kind={o.kind}>
                {OPTION_TITLES[o.kind]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="responses-group">
            <th colSpan={columns} scope="colgroup">
              Delivery
            </th>
          </tr>
          {DELIVERY_ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {options.map((o) => (
                <td key={o.kind} data-kind={o.kind}>
                  {row.cell(o, baseline, community[o.kind])}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row">Status</th>
            {options.map((o) => (
              <td key={o.kind} data-kind={o.kind}>
                {isPending(o) ? (
                  <span className="responses-pending">
                    <ClockIcon size={13} /> {o.status || NA}
                  </span>
                ) : (
                  o.status || NA
                )}
              </td>
            ))}
          </tr>
        </tbody>
        <tbody>
          <tr className="responses-group">
            <th colSpan={columns} scope="colgroup">
              Stakeholder impact (SIMULATED)
            </th>
          </tr>
          {IMPACT_ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {options.map((o) => (
                <td key={o.kind} data-kind={o.kind}>
                  {row.cell(o, baseline, community[o.kind])}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row">Not modeled</th>
            <td colSpan={options.length} className="responses-not-modeled">
              {NOT_MODELED_TEXT}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">
              <span className="pp-visually-hidden">Actions</span>
            </th>
            {options.map((o) => (
              <td key={o.kind} data-kind={o.kind}>
                <div className="responses-actions">
                  <button
                    type="button"
                    className="pp-button"
                    onClick={() => onWhy?.(o.kind)}
                    aria-label={`Why? (${OPTION_TITLES[o.kind]})`}
                  >
                    Why?
                  </button>
                  {renderActions?.(o)}
                </div>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
