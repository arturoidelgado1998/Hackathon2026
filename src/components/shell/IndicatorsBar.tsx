import './IndicatorsBar.css'

export interface IndicatorsBarProps {
  atRisk: number | null
  cost: number | null
  co2Kg: number | null
}

const PLACEHOLDER = '—'

function show(value: number | null, format: (v: number) => string): string {
  return value === null ? PLACEHOLDER : format(value)
}

/** Displays precomputed totals. It does no arithmetic. */
export function IndicatorsBar({ atRisk, cost, co2Kg }: IndicatorsBarProps) {
  return (
    <div className="pp-indicators">
      <dl className="pp-indicators__list">
        <div className="pp-indicators__item">
          <dt>At risk</dt>
          <dd>{show(atRisk, (v) => v.toLocaleString('en-US'))}</dd>
        </div>
        <div className="pp-indicators__item">
          <dt>Est. cost</dt>
          <dd>
            {show(cost, (v) =>
              v.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              }),
            )}
          </dd>
        </div>
        <div className="pp-indicators__item">
          <dt>Est. tailpipe CO2</dt>
          <dd>
            {show(co2Kg, (v) => `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} kg`)}
          </dd>
        </div>
      </dl>
    </div>
  )
}
