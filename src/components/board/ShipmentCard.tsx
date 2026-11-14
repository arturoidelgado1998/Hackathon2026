import type { TimeHHMM } from '../../types.ts'
import type { ShipmentCardView } from '../../viewModels.ts'
import { CheckIcon } from '../icons.tsx'
import { RiskBadge } from './RiskBadge.tsx'
import './board.css'

export interface ShipmentCardProps {
  card: ShipmentCardView
  selected?: boolean
  onSelectShipment?: (shipmentId: string) => void
}

/** Displays the given arrival values; no time arithmetic. */
function formatArrival(min: TimeHHMM | null, max: TimeHHMM | null): string {
  if (min === null && max === null) return 'Unknown'
  if (min === max) return min as TimeHHMM
  return `${min ?? '?'}–${max ?? '?'}`
}

/** One shipment in the queue. Selecting it opens its response comparison. */
export function ShipmentCard({ card, selected = false, onSelectShipment }: ShipmentCardProps) {
  const { shipment, destinationName, summary } = card
  return (
    <button
      type="button"
      className={`shipment-card${selected ? ' shipment-card--selected' : ''}`}
      aria-pressed={selected}
      data-shipment-id={shipment.id}
      onClick={() => onSelectShipment?.(shipment.id)}
    >
      <span className="shipment-card__top">
        <span className="shipment-card__id">{shipment.id}</span>
        {selected && (
          <span className="shipment-card__selected-tag">
            <CheckIcon size={12} /> Selected
          </span>
        )}
        <RiskBadge risk={summary.risk} />
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
          <span className="shipment-card__label">Est. arrival</span>{' '}
          <span className="shipment-card__value pp-num">
            {formatArrival(summary.arrival_min, summary.arrival_max)}
          </span>
        </span>
      </span>
      <span className="shipment-card__reason">{summary.reason}</span>
    </button>
  )
}
