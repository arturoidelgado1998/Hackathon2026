import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Decision, ResponseOption, ResponseOptionKind } from '../../types'
import type { Baseline, CommunityInfo, ResponsePanelView } from '../../viewModels'
import { isResponseOptionAvailable } from '../../state/options'
import { RiskBadge } from '../board/RiskBadge'
import { AlertIcon, ClockIcon } from '../icons'
import { delta, deltaOneDecimal } from '../../engine/deltas.ts'
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
  decision?: Decision
  previewDecision?: Decision | null
  onUndo?: () => void
  onCancelPreview?: () => void
  /** Optional notification when an option's explanation is toggled. */
  onWhy?: (kind: ResponseOptionKind) => void
  /** Slot for response actions, such as Preview and Select. */
  renderActions?: (option: ResponseOption) => ReactNode
}

/** Risk labels that count as meeting, or possibly meeting, the appointment. */
const FEASIBLE: ResponseOption['risk'][] = ['ON_TRACK', 'TIGHT']

function hasFeasibleOption(options: ResponseOption[]): boolean {
  return options.some(
    (o) => o.kind !== 'request_slot' && isResponseOptionAvailable(o) && FEASIBLE.includes(o.risk),
  )
}

const isPending = (o: ResponseOption) => o.kind === 'request_slot'

function NoFeasibleResponse() {
  return (
    <p className="responses-banner" role="alert">
      <AlertIcon size={14} label="Warning" />
      <span>No currently feasible response: review with warehouse or customer.</span>
    </p>
  )
}

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
  estimate?: string
  cell: (option: ResponseOption, baseline: Baseline, community?: CommunityInfo) => ReactNode
}

const DELIVERY_ROWS: Row[] = [
  {
    label: 'Est. arrival',
    estimate: 'Estimated arrival from a simulated scenario.',
    cell: (o) => (
      <span className="pp-num" title="scenario bounds, not a statistical interval">
        {formatArrival(o)}
      </span>
    ),
  },
  {
    label: 'Appointment',
    estimate: 'Estimated lateness against the original appointment window.',
    cell: (o) => (isPending(o) ? 'Not confirmed yet' : formatAppointment(o)),
  },
  { label: 'Risk', cell: (o) => <RiskBadge risk={o.risk} /> },
  {
    label: 'Est. cost',
    estimate: 'Estimated cost using placeholder assumptions.',
    cell: (o) => <span className="pp-num">{formatCost(o.cost)}</span>,
  },
]

const IMPACT_ROWS: Row[] = [
  {
    label: 'Driver',
    estimate: 'Estimated driver duty and change from the estimated normal scenario.',
    cell: (o, baseline) => {
      if (isPending(o)) return PENDING_STRIP_TEXT
      if (o.driver_duty_min === null) return NA
      return withChange(
        `${o.driver_duty_min} min on duty`,
        formatDutyDelta(delta(o.driver_duty_min, baseline.driver_duty_min)),
      )
    },
  },
  {
    label: 'Community',
    estimate:
      'Estimated proximity along an illustrative route; not measured exposure or health impact.',
    cell: (o, _baseline, community) => communityCell(o, community),
  },
  {
    label: 'Environment: miles',
    estimate: 'Estimated route miles and change from the estimated normal scenario.',
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
    estimate: 'Estimated tailpipe CO2 and change from the estimated normal scenario.',
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
 * Key by scenario to reset explanations when switching scenarios.
 */
export function ResponsePanel({ view, ...props }: ResponsePanelProps) {
  if (view === null) {
    return (
      <div className="responses-panel responses-panel--empty">
        <h2 className="responses-heading">Compare responses</h2>
        <p className="responses-empty">Select a shipment to compare responses.</p>
        <p className="responses-hint">
          Choose a shipment under Needs review to see the available responses and their trade-offs.
        </p>
      </div>
    )
  }

  return (
    <ShipmentResponses
      key={view.shipment.id}
      view={view}
      {...props}
    />
  )
}

function ShipmentResponses({
  view,
  onWhy,
  renderActions,
  decision,
  previewDecision,
  onUndo,
  onCancelPreview,
}: Omit<ResponsePanelProps, 'view'> & { view: ResponsePanelView }) {
  const explanationId = useId()
  const [expanded, setExpanded] = useState<ResponseOptionKind[]>([])
  const [explanationToFocus, setExplanationToFocus] = useState<ResponseOptionKind | null>(null)
  const explanationRefs = useRef<Partial<Record<ResponseOptionKind, HTMLElement>>>({})
  const whyRefs = useRef<Partial<Record<ResponseOptionKind, HTMLButtonElement>>>({})
  const headingRef = useRef<HTMLHeadingElement>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)
  const { shipment, destinationName, summary, options, baseline, community } = view
  const preview = previewDecision?.shipment_id === shipment.id ? previewDecision : null
  const awaitingConfirmation = decision?.status === 'pending_confirmation'
  const previousFeedback = useRef({ decision, preview })

  useEffect(() => {
    if (explanationToFocus) explanationRefs.current[explanationToFocus]?.focus()
  }, [explanationToFocus])

  useEffect(() => {
    const previous = previousFeedback.current
    if (
      (decision && decision !== previous.decision) ||
      (preview && preview !== previous.preview)
    ) {
      feedbackRef.current?.focus()
    }
    previousFeedback.current = { decision, preview }
  }, [decision, preview])

  function toggleWhy(kind: ResponseOptionKind) {
    setExplanationToFocus(expanded.includes(kind) ? null : kind)
    setExpanded((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    )
    onWhy?.(kind)
  }

  function closeWhy(kind: ResponseOptionKind) {
    toggleWhy(kind)
    whyRefs.current[kind]?.focus()
  }

  const header = (
    <header className="responses-header">
      <h2 ref={headingRef} id="responses-heading" className="responses-heading" tabIndex={-1}>
        Responses for {shipment.id} to {destinationName}
      </h2>
      <p className="responses-context">
        <span>
          Appointment{' '}
          <strong className="pp-num" title="Simulated appointment window.">
            {shipment.appt_start}–{shipment.appt_end}
          </strong>
        </span>
        {summary && (
          <>
            <RiskBadge risk={summary.risk} />
            <span
              className="responses-reason"
              title="Estimated timing from a simulated scenario."
            >
              <span title="scenario bounds, not a statistical interval">{summary.reason}</span>
            </span>
          </>
        )}
      </p>
    </header>
  )

  if (options.length === 0) {
    return (
      <div className="responses-panel">
        {header}
        {summary?.affected ? (
          <NoFeasibleResponse />
        ) : (
          <p className="responses-empty">
            No response needed: this shipment is not affected by an incident.
          </p>
        )}
      </div>
    )
  }

  const columns = options.length + 1

  return (
    <div className="responses-panel">
      {header}
      <div
        ref={feedbackRef}
        className="responses-feedback"
        role="status"
        aria-atomic="true"
        tabIndex={-1}
      >
        {decision && (
          <div className="responses-notice">
            <p>
              <strong>
                {awaitingConfirmation ? 'Slot request' : OPTION_TITLES[decision.option_kind]}{' '}
                recorded for {shipment.id}.
              </strong>{' '}
              {awaitingConfirmation
                ? 'Awaiting confirmation. Original risk and current-plan totals are retained.'
                : 'Sample plan updated. Estimates are not confirmed outcomes.'}
            </p>
            {onUndo && (
              <button
                type="button"
                className="pp-button"
                onClick={() => {
                  onUndo()
                  headingRef.current?.focus()
                }}
              >
                Undo last choice
              </button>
            )}
          </div>
        )}
        {preview && (
          <div className="responses-notice responses-notice--preview">
            <p>
              <strong>Preview only: {OPTION_TITLES[preview.option_kind]}.</strong>{' '}
              No decision or totals changed.
            </p>
            {onCancelPreview && (
              <button
                type="button"
                className="pp-button"
                onClick={() => {
                  onCancelPreview()
                  headingRef.current?.focus()
                }}
              >
                Cancel preview
              </button>
            )}
          </div>
        )}
      </div>
      {!hasFeasibleOption(options) && <NoFeasibleResponse />}
      <div
        className="responses-table-scroll"
        role="region"
        aria-label="Response comparison (scroll horizontally for all options)"
        tabIndex={0}
      >
      <table className="responses-table" aria-labelledby="responses-heading">
        <caption className="responses-note">
          All values are estimates. Options are shown in a fixed order and are not ranked.
          {' '}Arrival ranges: <span>scenario bounds, not a statistical interval</span>.
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
                <td key={o.kind} data-kind={o.kind} title={row.estimate}>
                  {row.cell(o, baseline, community[o.kind])}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row">Status</th>
            {options.map((o) => (
              <td
                key={o.kind}
                data-kind={o.kind}
                title="Estimated status from a simulated scenario; reopening times are not guaranteed."
              >
                {isPending(o) ? (
                  <span className="responses-pending">
                    <ClockIcon size={13} />{' '}
                    {awaitingConfirmation ? 'Awaiting confirmation' : 'Requires confirmation'};
                    {' '}original deadline still applies
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
                <td key={o.kind} data-kind={o.kind} title={row.estimate}>
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
                    ref={(element) => {
                      if (element) whyRefs.current[o.kind] = element
                    }}
                    type="button"
                    className="pp-button"
                    onClick={() => toggleWhy(o.kind)}
                    aria-label={`Why? (${OPTION_TITLES[o.kind]})`}
                    aria-expanded={expanded.includes(o.kind)}
                    aria-controls={`${explanationId}-${o.kind}`}
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
      {options.map((option) => (
        <section
          ref={(element) => {
            if (element) explanationRefs.current[option.kind] = element
          }}
          key={option.kind}
          id={`${explanationId}-${option.kind}`}
          className="responses-explanation"
          hidden={!expanded.includes(option.kind)}
          aria-labelledby={`${explanationId}-${option.kind}-heading`}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              closeWhy(option.kind)
            }
          }}
        >
          <div className="responses-explanation__header">
            <h3 id={`${explanationId}-${option.kind}-heading`}>
              {OPTION_TITLES[option.kind]}: inputs and steps
            </h3>
            <button
              type="button"
              className="pp-button"
              aria-label={`Close explanation (${OPTION_TITLES[option.kind]})`}
              onClick={() => closeWhy(option.kind)}
            >
              Close
            </button>
          </div>
          <p className="responses-note">Estimated inputs and steps from this simulated scenario.</p>
          {option.explanation_inputs.length > 0 ? (
            <ol>
              {option.explanation_inputs.map((input, index) => (
                <li key={index} title="Estimated explanation input from a simulated scenario.">
                  {input}
                </li>
              ))}
            </ol>
          ) : (
            <p>No explanation inputs available.</p>
          )}
        </section>
      ))}
    </div>
  )
}
