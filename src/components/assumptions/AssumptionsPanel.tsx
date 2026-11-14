import { useId } from 'react'
import { assumptions, assumptionPlaceholders } from '../../data'
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
  ['Simulated', 'Prototype data, not a real shipment or incident.'],
  ['Unknown', 'Not available or not yet confirmed; not zero.'],
] as const

export function AssumptionsPanel() {
  const id = useId()

  return (
    <div className="assumptions-panel">
      <h2>Assumptions &amp; sources</h2>
      <p className="assumptions-note">
        Estimated values use the assumptions below. Placeholder values still need team verification.
      </p>
      <nav className="assumptions-nav" aria-label="Assumptions sections">
        <a href={`#${id}-inputs`}>Inputs &amp; sources</a>
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
                    <span className="assumptions-placeholder">Placeholder</span>
                  )}
                </th>
                <td
                  className="pp-num"
                  title="Estimated assumption for simulated scenarios."
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
