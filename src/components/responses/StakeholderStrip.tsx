import type { ResponseOption } from '../../types'
import type { Baseline, CommunityInfo } from '../../viewModels'
import { delta, deltaOneDecimal } from './deltas'
import {
  NOT_MODELED_TEXT,
  PENDING_STRIP_TEXT,
  formatCommunityCounts,
  formatDutyDelta,
  formatEnvironment,
} from './format'

export interface StakeholderStripProps {
  option: ResponseOption
  baseline: Baseline
  /** Community facts for this option's route; undefined when there are none. */
  community?: CommunityInfo
}

function WarningIcon() {
  return (
    <span className="responses-warning-icon" role="img" aria-label="Warning">
      ⚠
    </span>
  )
}

function CommunityLine({ option, community }: { option: ResponseOption; community?: CommunityInfo }) {
  if (!community || community.schools_150m === null) {
    if (option.passes_sensitive_zone) {
      return (
        <span className="responses-warning">
          <WarningIcon /> Passes a flagged zone (placeholder)
        </span>
      )
    }
    return <span>No flagged zone on this route (placeholder)</span>
  }
  const schools = community.schools_150m
  const tracts = community.dac_tracts === null ? null : community.dac_tracts.length
  const text = formatCommunityCounts(schools, tracts)
  if (schools > 0 || (tracts !== null && tracts > 0)) {
    return (
      <span className="responses-warning">
        <WarningIcon /> {text}
      </span>
    )
  }
  return <span>{text}</span>
}

export function StakeholderStrip({ option, baseline, community }: StakeholderStripProps) {
  const pending = option.kind === 'request_slot'
  const titleId = `stakeholder-${option.kind}`
  return (
    <section className="responses-strip" aria-labelledby={titleId}>
      <h4 id={titleId} className="responses-strip-title">
        Stakeholder impact (SIMULATED)
      </h4>
      <dl className="responses-strip-lines">
        <dt>Driver:</dt>
        <dd>
          {pending
            ? PENDING_STRIP_TEXT
            : formatDutyDelta(delta(option.driver_duty_min, baseline.driver_duty_min))}
        </dd>
        <dt>Community:</dt>
        <dd>{pending ? PENDING_STRIP_TEXT : <CommunityLine option={option} community={community} />}</dd>
        <dt>Environment:</dt>
        <dd>
          {pending
            ? PENDING_STRIP_TEXT
            : formatEnvironment(
                delta(option.miles, baseline.miles),
                deltaOneDecimal(option.co2_kg, baseline.co2_kg),
              )}
        </dd>
        <dt>Not modeled:</dt>
        <dd>{NOT_MODELED_TEXT}</dd>
      </dl>
    </section>
  )
}
