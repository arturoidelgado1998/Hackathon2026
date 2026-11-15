import type { Shipment } from '../../types.ts'
import './board.css'

export interface ScheduleBoardProps {
  shipments: { shipment: Shipment; destinationName: string }[]
}

/**
 * The day's plan before any live update has arrived: who goes where and when
 * they are expected. No estimates, risk or responses yet, so nothing is selectable.
 */
export function ScheduleBoard({ shipments }: ScheduleBoardProps) {
  return (
    <div className="triage-board" role="group" aria-label="Today's schedule">
      <div className="triage-board__header">
        <h2 className="triage-board__title">Shipments</h2>
        <span className="triage-board__total pp-num">{shipments.length} today</span>
      </div>
      <p className="board-column__empty">
        Today’s schedule. Arrival estimates and risk appear when live updates start.
      </p>
      <ul className="board-column__list">
        {shipments.map(({ shipment, destinationName }) => (
          <li key={shipment.id}>
            <div className="shipment-card shipment-card--schedule" data-shipment-id={shipment.id}>
              <span className="shipment-card__top">
                <span className="shipment-card__id">{shipment.id}</span>
              </span>
              <span className="shipment-card__dest">{destinationName}</span>
              <span className="shipment-card__times">
                <span className="shipment-card__row">
                  <span className="shipment-card__label">Appt</span>{' '}
                  <span className="shipment-card__value pp-num">
                    {shipment.appt_start}–{shipment.appt_end}
                  </span>
                </span>
                <span className="shipment-card__row">
                  <span className="shipment-card__label">Cargo ready</span>{' '}
                  <span className="shipment-card__value pp-num">{shipment.cargo_ready}</span>
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
