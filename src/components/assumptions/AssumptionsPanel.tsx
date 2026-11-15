import { useId } from 'react'
import { assumptions, assumptionPlaceholders, corridor } from '../../data'
import { limitations } from '../../data/limitations'
import type { Assumptions } from '../../types'
import './assumptions.css'

type AssumptionKey = Exclude<keyof Assumptions, 'sources'>

const DETAILS: Record<AssumptionKey, { label: string; unit: string }> = {
  pickup_handling_min: { label: 'Pickup handling time', unit: 'minutes' },
  mpg: { label: 'Fuel economy', unit: 'miles per gallon' },
  nonlabor_cost_per_mile: { label: 'Nonlabor cost', unit: 'USD per mile' },
  labor_rate_per_hr: { label: 'Labor rate', unit: 'USD per hour' },
  diesel_kgCO2_per_gal: { label: 'Diesel tailpipe CO2 factor', unit: 'kg CO2 per gallon' },
}

const VALUE_TYPES = [
  ['Confirmed', 'Human-confirmed input; estimated outcomes remain estimates.'],
  ['Estimated', 'Scenario-based value, not a measured real-world outcome.'],
  ['Unknown', 'Not available or not yet confirmed; not zero.'],
] as const

export function AssumptionsPanel() {
  const id = useId()

  return (
    <div className="assumptions-panel">
      <h2>Assumptions &amp; sources</h2>
      <p className="assumptions-note">
        Estimated values use the inputs below. Cost and CO2 inputs are published averages, cited in
        the Source column. An input marked Team assumption has no published source.
      </p>
      <nav className="assumptions-nav" aria-label="Assumptions sections">
        <a href={`#${id}-inputs`}>Inputs &amp; sources</a>
        <a href={`#${id}-community`}>Community proximity</a>
        <a href={`#${id}-legend`}>Value types</a>
        <a href={`#${id}-limitations`}>Limitations</a>
      </nav>
      <div className="assumptions-table-scroll" id={`${id}-inputs`} tabIndex={-1}>
        <table className="assumptions-table">
          <caption className="pp-visually-hidden">Numeric assumptions and their sources</caption>
          <thead>
            <tr>
              <th scope="col">Assumption</th>
              <th scope="col">Estimated value</th>
              <th scope="col">Unit</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(DETAILS) as AssumptionKey[]).map((key) => (
              <tr key={key}>
                <th scope="row">
                  {DETAILS[key].label}
                  {assumptionPlaceholders[key] && (
                    <span className="assumptions-placeholder">Team assumption</span>
                  )}
                </th>
                <td
                  className="pp-num"
                  title="Estimated input, used for every result."
                  data-label="Estimated value"
                >
                  {assumptions[key]}
                </td>
                <td data-label="Unit">{DETAILS[key].unit}</td>
                <td data-label="Source">{assumptions.sources[key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-labelledby={`${id}-community`}>
        <h3 id={`${id}-community`} tabIndex={-1}>
          Community proximity ({corridor.buffer_m} m)
        </h3>
        <p className="assumptions-note">{corridor.method}</p>
        <p className="assumptions-note">
          <strong>What it means:</strong> {corridor.meaning}
        </p>
        <p className="assumptions-note">
          <strong>Why {corridor.buffer_m} m:</strong> {corridor.basis}
        </p>
        <div className="assumptions-table-scroll">
          <table className="assumptions-table">
            <caption className="pp-visually-hidden">Real layers used for community proximity</caption>
            <thead>
              <tr>
                <th scope="col">Real layer</th>
                <th scope="col">Publisher</th>
                <th scope="col">Edition</th>
                <th scope="col">Downloaded</th>
              </tr>
            </thead>
            <tbody>
              {corridor.sources.map((source) => (
                <tr key={source.id}>
                  <th scope="row">{source.name}</th>
                  <td data-label="Publisher">{source.publisher}</td>
                  <td data-label="Edition">{source.edition}</td>
                  <td data-label="Downloaded" className="pp-num">
                    {source.retrieved}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby={`${id}-legend`}>
        <h3 id={`${id}-legend`}>Value types</h3>
        <dl className="assumptions-legend">
          {VALUE_TYPES.map(([label, description]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby={`${id}-limitations`}>
        <h3 id={`${id}-limitations`}>Limitations</h3>
        <ol className="assumptions-limitations">
          {limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ol>
      </section>
    </div>
  )
}
