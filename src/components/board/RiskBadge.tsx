import type { RiskLabel } from '../../types.ts'
import './board.css'

/** Text label and symbol per risk value, so status never relies on colour. */
const RISK_DISPLAY: Record<RiskLabel, { label: string; icon: string }> = {
  ON_TRACK: { label: 'ON TRACK', icon: '✓' },
  TIGHT: { label: 'TIGHT', icon: '!' },
  LATE: { label: 'LATE', icon: '✕' },
  UNKNOWN: { label: 'UNKNOWN', icon: '?' },
}

export interface RiskBadgeProps {
  risk: RiskLabel
}

export function RiskBadge({ risk }: RiskBadgeProps) {
  const { label, icon } = RISK_DISPLAY[risk]
  return (
    <span className={`risk-badge risk-badge--${risk.toLowerCase()}`} data-risk={risk}>
      <span className="risk-badge__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="risk-badge__label">{label}</span>
    </span>
  )
}
