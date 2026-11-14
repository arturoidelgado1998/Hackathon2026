import { useId } from 'react'
import { BOARD_COLUMNS } from '../../viewModels.ts'
import type { BoardColumn, ShipmentCardView } from '../../viewModels.ts'
import { ShipmentCard } from './ShipmentCard.tsx'
import './board.css'

export interface TriageBoardProps {
  cards: ShipmentCardView[]
  selectedShipmentId?: string | null
  onSelectShipment?: (shipmentId: string) => void
  onRejectAll?: (shipmentId: string) => void
  showEmptyGroups?: boolean
  onToggleEmptyGroups?: () => void
}

/** Workflow wording per group. "Decision recorded" is the dispatcher's choice, not an outcome. */
const COLUMN_SUBTITLES: Partial<Record<BoardColumn, string>> = {
  decision_recorded: 'Dispatcher chose a response',
}

/**
 * The shipment queue: one group per workflow state, most urgent first.
 * A shipment's group is its workflow state; its badge is its calculated
 * risk. The two are independent.
 */
export function TriageBoard({
  cards,
  selectedShipmentId = null,
  onSelectShipment,
  onRejectAll,
  showEmptyGroups = false,
  onToggleEmptyGroups,
}: TriageBoardProps) {
  const idPrefix = useId()
  const emptyColumns = BOARD_COLUMNS.filter(({ id }) => !cards.some((card) => card.column === id))
  return (
    <div
      className="triage-board"
      role="group"
      aria-label="Triage board"
      data-collapse-empty={Boolean(onToggleEmptyGroups) && !showEmptyGroups}
    >
      <div className="triage-board__header">
        <h2 className="triage-board__title">Shipments</h2>
        <span className="triage-board__total pp-num">{cards.length} today</span>
      </div>
      {emptyColumns.length > 0 && onToggleEmptyGroups && (
        <button
          type="button"
          className="pp-button triage-board__empty-toggle"
          aria-expanded={showEmptyGroups}
          aria-controls={emptyColumns.map(({ id }) => `${idPrefix}-${id}`).join(' ')}
          onClick={onToggleEmptyGroups}
        >
          {showEmptyGroups ? 'Hide' : 'Show'} {emptyColumns.length} empty{' '}
          {emptyColumns.length === 1 ? 'group' : 'groups'}
        </button>
      )}
      {BOARD_COLUMNS.map(({ id, title }) => {
        const columnCards = cards.filter((card) => card.column === id)
        const titleId = `${idPrefix}-${id}-title`
        const subtitle = COLUMN_SUBTITLES[id]
        return (
          <section
            key={id}
            id={`${idPrefix}-${id}`}
            className={`board-column${columnCards.length === 0 ? ' board-column--empty' : ''}`}
            aria-labelledby={titleId}
            data-column={id}
          >
            <header className="board-column__header">
              <h3 className="board-column__title">
                <span id={titleId}>{title}</span>{' '}
                <span
                  className={`board-column__count pp-num${
                    id === 'needs_review' && columnCards.length > 0
                      ? ' board-column__count--action'
                      : ''
                  }`}
                  data-testid={`count-${id}`}
                >
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
                    {(card.shipment.id === selectedShipmentId ||
                      (id === 'needs_review' && onRejectAll)) && (
                      <div className="shipment-card__actions">
                        {card.shipment.id === selectedShipmentId && (
                          <a
                            className="pp-button shipment-card__view-responses"
                            href="#response-options"
                            aria-label={`View responses for ${card.shipment.id}`}
                          >
                            View responses
                          </a>
                        )}
                        {id === 'needs_review' && onRejectAll && (
                          <button
                            type="button"
                            className="shipment-card__reject"
                            aria-label={`Reject all options for ${card.shipment.id}`}
                            onClick={() => onRejectAll(card.shipment.id)}
                          >
                            Reject all
                          </button>
                        )}
                      </div>
                    )}
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
