import type { Incident } from '../../types.ts'
import { AlertIcon, CheckIcon } from '../icons.tsx'
import './IncidentBanner.css'

export interface IncidentBannerProps {
  /** The confirmed incident, or null in normal operations. */
  incident: Incident | null
  /** Display name of the affected segment. */
  segmentName?: string
  /** The segment has reopened; delays it caused may remain. */
  reopened?: boolean
}

/** Says what changed. A reopening time is a report, never a guarantee. */
export function IncidentBanner({ incident, segmentName, reopened = false }: IncidentBannerProps) {
  if (incident === null) {
    return (
      <p className="pp-incident pp-incident--clear">
        <span className="pp-incident__icon">
          <CheckIcon size={14} />
        </span>
        <span>
          <strong>No active incident.</strong> Shipments are running to plan.
        </span>
      </p>
    )
  }

  const reopen = incident.assumed_reopen_time ?? incident.reported_reopen_time
  const reopenText =
    reopen === null
      ? 'Reopening time not reported.'
      : incident.assumed_reopen_time !== null
        ? `Assumed to reopen ${reopen} (dispatcher assumption).`
        : `Reported to reopen ${reopen} (estimate, not a guarantee).`

  if (reopened && reopen !== null) {
    return (
      <p className="pp-incident pp-incident--clear">
        <span className="pp-incident__icon">
          <CheckIcon size={14} />
        </span>
        <span>
          <strong>
            {incident.segment_id}
            {segmentName ? `, ${segmentName}` : ''} reopened
          </strong>{' '}
          <span className="pp-num">
            at {reopen}, after closing at {incident.start_time}. Shipments it delayed may still be late.
          </span>
        </span>
      </p>
    )
  }

  return (
    <p className="pp-incident pp-incident--active">
      <span className="pp-incident__icon">
        <AlertIcon size={14} />
      </span>
      <span>
        <strong>
          Closure on {incident.segment_id}
          {segmentName ? `, ${segmentName}` : ''}
        </strong>{' '}
        <span
          className="pp-num"
          title="Simulated closure report; reopening is an estimate, not a guarantee"
        >
          from {incident.start_time}. {reopenText}
        </span>
      </span>
    </p>
  )
}
