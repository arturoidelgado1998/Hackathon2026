import { formatTime } from '../engine/time.ts'
import type { LiveEvent } from './events.ts'
import './LiveUpdates.css'

export interface LiveUpdatesProps {
  /** Minutes since midnight. */
  now: number
  /** Newest first. */
  events: LiveEvent[]
  /** How many of the latest to show; closure reports are always kept. */
  limit?: number
}

/** A running log of what has been reported, newest first. */
export function LiveUpdates({ now, events, limit = 8 }: LiveUpdatesProps) {
  // The latest few, and always the closure reports however old they are.
  const shown = events.filter((event, i) => i < limit || event.kind === 'incident')
  return (
    <section className="pp-updates" aria-label="Live updates">
      <div className="pp-updates__header">
        <h3 className="pp-updates__title">Live updates</h3>
        <span className="pp-updates__now pp-num">Now {formatTime(Math.floor(now))}</span>
      </div>
      {events.length === 0 ? (
        <p className="pp-updates__empty">Nothing reported yet.</p>
      ) : (
        <ol className="pp-updates__list">
          {shown.map((event) => (
            <li
              key={`${event.time}-${event.text}`}
              className={event.kind === 'incident' ? 'pp-updates__item pp-updates__item--incident' : 'pp-updates__item'}
            >
              <span className="pp-updates__time pp-num">{formatTime(event.time)}</span>
              <span>{event.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
