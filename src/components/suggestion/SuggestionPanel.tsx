import { useId, useState } from 'react'
import { buildShipmentFacts } from '../../suggestion/facts.ts'
import { requestSuggestion, type SuggestionOutcome } from '../../suggestion/client.ts'
import {
  MEASURE_LABELS,
  SLOT_GIVES_UP,
  WEIGHING,
  type Difference,
  type Measure,
  type OptionFacts,
  type ShipmentFacts,
} from '../../suggestion/suggestion.ts'
import type { ResponsePanelView } from '../../viewModels.ts'
import {
  NA,
  OPTION_TITLES,
  formatAppointment,
  formatArrival,
  formatCo2,
  formatCost,
  formatMiles,
} from '../responses/format.ts'
import './suggestion.css'

export interface SuggestionPanelProps {
  /** The selected shipment's response view, exactly as the comparison table shows it. */
  view: ResponsePanelView | null
  /** Replaceable in tests. Defaults to the incident server. */
  request?: (facts: ShipmentFacts) => Promise<SuggestionOutcome>
}

const RISK_WORDS = { ON_TRACK: 'On track', TIGHT: 'Tight', LATE: 'Late', UNKNOWN: 'Unknown' } as const

/** One measure of one option, printed from the dashboard's data. */
function valueOf(option: OptionFacts, measure: Measure): string {
  switch (measure) {
    case 'appointment':
      return formatAppointment(option)
    case 'risk':
      return RISK_WORDS[option.risk]
    case 'arrival':
      return formatArrival(option)
    case 'cost':
      return formatCost(option.cost)
    case 'driver_duty':
      return option.driver_duty_min === null ? NA : `${option.driver_duty_min} min`
    case 'schools':
      return option.schools_150m === null ? NA : String(option.schools_150m)
    case 'tracts':
      return option.dac_tracts === null ? NA : String(option.dac_tracts)
    case 'miles':
      return formatMiles(option.miles)
    case 'co2':
      return formatCo2(option.co2_kg)
  }
}

function DifferenceList({ items, facts, of }: { items: Difference[]; facts: ShipmentFacts; of: OptionFacts }) {
  return (
    <ul className="pp-suggestion__list">
      {items.map(({ measure, against }) => {
        const other = facts.options.find((o) => o.kind === against)!
        return (
          <li key={`${measure}-${against}`}>
            <span className="pp-suggestion__measure">{MEASURE_LABELS[measure]}:</span>{' '}
            <span className="pp-num">{valueOf(of, measure)}</span>, against{' '}
            <span className="pp-num">{valueOf(other, measure)}</span> for {OPTION_TITLES[against]}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * An AI suggestion for the selected shipment, shown only when the dispatcher
 * asks for one. It selects nothing and changes nothing: the comparison table
 * and its Preview and Choose buttons work exactly as they do without it.
 */
export function SuggestionPanel({ view, request = requestSuggestion }: SuggestionPanelProps) {
  const headingId = useId()
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'asking' } | { status: 'done'; outcome: SuggestionOutcome; facts: ShipmentFacts }
  >({ status: 'idle' })

  if (!view || view.options.length === 0) return null

  async function ask() {
    const facts = buildShipmentFacts(view!)
    setState({ status: 'asking' })
    setState({ status: 'done', outcome: await request(facts), facts })
  }

  const done = state.status === 'done' ? state : null
  const suggestion = done?.outcome.ok ? done.outcome.suggestion : null
  const suggested = suggestion?.suggested_option
    ? done!.facts.options.find((o) => o.kind === suggestion.suggested_option)
    : undefined

  return (
    <section className="pp-suggestion" aria-labelledby={headingId}>
      <div className="pp-suggestion__header">
        <h3 id={headingId} className="pp-suggestion__title">
          AI suggestion
        </h3>
        <span className="pp-suggestion__tag">Suggestion only. You decide.</span>
      </div>

      {state.status !== 'done' && (
        <>
          <p className="pp-suggestion__lead">
            Ask the AI which response it would lean towards for {view.shipment.id}. It sees only the figures in the
            table above, and it selects nothing.
          </p>
          <button type="button" className="pp-button" onClick={ask} disabled={state.status === 'asking'}>
            {state.status === 'asking' ? 'Asking the AI…' : 'Ask the AI for a suggestion'}
          </button>
        </>
      )}

      {/* Present only once there is an answer, so the page has one status region until then. */}
      {done && (
      <div role="status" aria-atomic="true">
        {!done.outcome.ok && (
          <p className="pp-suggestion__unavailable">
            No AI suggestion: {done.outcome.message} Compare the options in the table yourself.
          </p>
        )}

        {suggestion && !suggested && (
          <p className="pp-suggestion__pick">
            <strong>The AI makes no suggestion</strong> for {view.shipment.id}.
          </p>
        )}

        {suggestion && suggested && (
          <>
            <p className="pp-suggestion__pick">
              The AI leans towards <strong>{OPTION_TITLES[suggested.kind]}</strong> for {view.shipment.id}. Nothing has
              been selected.
            </p>
            {suggestion.because.length > 0 && (
              <>
                <h4 className="pp-suggestion__subhead">Why, checked against the table</h4>
                <DifferenceList items={suggestion.because} facts={done!.facts} of={suggested} />
              </>
            )}
            <h4 className="pp-suggestion__subhead">What it gives up</h4>
            {suggestion.pending ? (
              <p className="pp-suggestion__gives-up">{SLOT_GIVES_UP}</p>
            ) : suggestion.gives_up.length > 0 ? (
              <DifferenceList items={suggestion.gives_up} facts={done!.facts} of={suggested} />
            ) : (
              <p className="pp-suggestion__gives-up">Nothing in the table is worse for this option than for the other.</p>
            )}
          </>
        )}

        {suggestion && (
          <p className="pp-suggestion__note">
            <span className="pp-suggestion__measure">In the AI's words:</span> {suggestion.note}
          </p>
        )}
      </div>
      )}

      {done && (
        <>
          <details className="pp-suggestion__weighing">
            <summary>What the AI was asked to weigh</summary>
            <ol>
              {WEIGHING.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </details>
          <p className="pp-suggestion__foot">
            Every figure here is the dashboard's own estimate; the AI supplied none of them. A suggestion can be
            wrong.
          </p>
          <button type="button" className="pp-button" onClick={() => setState({ status: 'idle' })}>
            Dismiss suggestion
          </button>
        </>
      )}
    </section>
  )
}
