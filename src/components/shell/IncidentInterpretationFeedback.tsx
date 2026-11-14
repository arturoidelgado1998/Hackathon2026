import { AlertIcon, ClockIcon } from '../icons.tsx'
import './IncidentInterpretationFeedback.css'

export type IncidentInterpretationStatus = 'idle' | 'loading' | 'unavailable'

export function AIUnavailableBanner() {
  return (
    <p className="pp-interpretation pp-interpretation--unavailable" role="alert">
      <AlertIcon size={16} />
      <span>
        <strong>AI unavailable: use manual entry</strong>
        {' '}The current plan is unchanged.
      </span>
    </p>
  )
}

/** Presentation only; incident entry and network requests belong to the incident flow. */
export function IncidentInterpretationFeedback({
  status,
}: {
  status: IncidentInterpretationStatus
}) {
  if (status === 'unavailable') return <AIUnavailableBanner />
  if (status === 'loading') {
    return (
      <p className="pp-interpretation" role="status" aria-atomic="true">
        <ClockIcon size={16} />
        <span>
          <strong>Interpreting incident…</strong> The current plan is unchanged.
        </span>
      </p>
    )
  }
  return null
}
