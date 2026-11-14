import { useId } from 'react'
import { BOARD_COLUMNS } from '../../viewModels.ts'
import type { BoardColumn, ShipmentCardView } from '../../viewModels.ts'
import { ShipmentCard } from './ShipmentCard.tsx'
import './board.css'

export interface TriageBoardProps {
  cards: ShipmentCardView[]
  selectedShipmentId?: string | null
  onSelectShipment?: (shipmentId: string) => void
}

/** Workflow wording per column. "Decision recorded" is the dispatcher's choice, not an outcome. */
const COLUMN_SUBTITLES: Partial<Record<BoardColumn, string>> = {
  decision_recorded: 'Dispatcher chose a response',
}

export function TriageBoard({ cards, selectedShipmentId = null, onSelectShipment }: TriageBoardProps) {
  const idPrefix = useId()
  return (
    <div className="triage-board" role="group" aria-label="Triage board">
      {BOARD_COLUMNS.map(({ id, title }) => {
        const columnCards = cards.filter((card) => card.column === id)
        const titleId = `${idPrefix}-${id}-title`
        const subtitle = COLUMN_SUBTITLES[id]
        return (
          <section key={id} className="board-column" aria-labelledby={titleId} data-column={id}>
            <header className="board-column__header">
              <h3 className="board-column__title">
                <span id={titleId}>{title}</span>{' '}
                <span className="board-column__count" data-testid={`count-${id}`}>
                  {columnCards.length}
                </span>
              </h3>
              {subtitle && <p className="board-column__subtitle">{subtitle}</p>}
            </header>
            {columnCards.length === 0 ? (
              <p className="board-column__empty">No shipments</p>
            ) : (
              <ul className="board-column__list">
                {columnCards.map((card) => (
                  <li key={card.shipment.id}>
                    <ShipmentCard
                      card={card}
                      selected={card.shipment.id === selectedShipmentId}
                      onSelectShipment={onSelectShipment}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
