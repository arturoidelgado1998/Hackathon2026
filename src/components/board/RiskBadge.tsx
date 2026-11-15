import type { ReactNode } from 'react'
import type { RiskLabel } from '../../types.ts'
import { AlertIcon, CheckIcon, CloseIcon, QuestionIcon } from '../icons.tsx'
import './RiskBadge.css'

/** Text label and icon per risk value, so status never relies on colour. */
const RISK_DISPLAY: Record<RiskLabel, { label: string; icon: ReactNode }> = {
  ON_TRACK: { label: 'ON TRACK', icon: <CheckIcon size={12} /> },
  TIGHT: { label: 'TIGHT', icon: <AlertIcon size={12} /> },
  LATE: { label: 'LATE', icon: <CloseIcon size={12} /> },
  UNKNOWN: { label: 'UNKNOWN', icon: <QuestionIcon size={12} /> },
}

export interface RiskBadgeProps {
  risk: RiskLabel
  /** Replaces the risk wording, for an outcome that is no longer an estimate. */
  label?: string
}

export function RiskBadge({ risk, label: wording }: RiskBadgeProps) {
  const { icon } = RISK_DISPLAY[risk]
  const label = wording ?? RISK_DISPLAY[risk].label
  return (
    <span className={`risk-badge risk-badge--${risk.toLowerCase()}`} data-risk={risk}>
      <span className="risk-badge__icon">{icon}</span>
      <span className="risk-badge__label">{label}</span>
    </span>
  )
}
