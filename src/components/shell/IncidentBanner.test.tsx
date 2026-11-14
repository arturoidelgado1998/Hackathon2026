import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Incident } from '../../types.ts'
import { IncidentBanner } from './IncidentBanner.tsx'

const closure: Incident = {
  segment_id: 'NB-03',
  type: 'closure',
  start_time: '10:00',
  reported_reopen_time: '11:10',
  assumed_reopen_time: null,
  evidence_text: 'SYNTHETIC report',
  confirmed_by_user: true,
}

describe('IncidentBanner', () => {
  it('says there is no incident in normal operations', () => {
    render(<IncidentBanner incident={null} />)
    expect(screen.getByText('No active incident.')).toBeInTheDocument()
  })

  it('names the closure and labels the reopening time as an estimate', () => {
    render(<IncidentBanner incident={closure} segmentName="Northbound freight corridor" />)
    expect(screen.getByText('Closure on NB-03, Northbound freight corridor')).toBeInTheDocument()
    expect(
      screen.getByText('from 10:00. Reported to reopen 11:10 (estimate, not a guarantee).'),
    ).toBeInTheDocument()
  })

  it('labels a dispatcher assumption as an assumption', () => {
    render(
      <IncidentBanner
        incident={{ ...closure, reported_reopen_time: null, assumed_reopen_time: '11:30' }}
      />,
    )
    expect(
      screen.getByText('from 10:00. Assumed to reopen 11:30 (dispatcher assumption).'),
    ).toBeInTheDocument()
  })

  it('does not guess when no reopening time is known', () => {
    render(<IncidentBanner incident={{ ...closure, reported_reopen_time: null }} />)
    expect(screen.getByText('from 10:00. Reopening time not reported.')).toBeInTheDocument()
  })
})
