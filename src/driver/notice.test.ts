import { describe, expect, it } from 'vitest'
import { buildResponseView } from '../state/selectors.ts'
import { sampleIncident } from '../data/index.ts'
import type { Decision, ResponseOptionKind } from '../types.ts'
import { buildDraft } from './draft.ts'
import { PENDING_INSTRUCTION, TRUCK_CAUTION } from './notice.ts'

const view = buildResponseView('S-01', 'disrupted')!

function decision(kind: ResponseOptionKind, status?: Decision['status']): Decision {
  return {
    shipment_id: 'S-01',
    option_kind: kind,
    status: status ?? (kind === 'request_slot' ? 'pending_confirmation' : 'selected'),
    timestamp: '2026-11-14T10:05:00Z',
  }
}

const draft = (kind: ResponseOptionKind, status?: Decision['status']) =>
  buildDraft(view, decision(kind, status), sampleIncident)

const allText = (body: object) => JSON.stringify(body)

describe('buildDriverNotice (reference shipment S-01)', () => {
  it('says what changed, with the reopening time as an estimate', () => {
    expect(draft('wait')!.what_changed).toBe(
      'NB-03 (I-710 northbound to SR-60 east (shared corridor)) is closed from 10:00. ' +
        'Reported reopening 11:10 (estimate, not a guarantee).',
    )
  })

  it('labels an assumed reopening time as an assumption', () => {
    const body = buildDraft(view, decision('wait'), {
      ...sampleIncident,
      reported_reopen_time: null,
      assumed_reopen_time: '11:30',
    })
    expect(body!.what_changed).toContain('Dispatch assumes 11:30 (assumption).')
  })

  it('Wait: keeps the original route and copies the option values', () => {
    const body = draft('wait')!
    expect(body.instruction).toBe(
      'Keep the original route. Expect to wait at NB-03 until it reopens.',
    )
    expect(body.caution).toBeNull()
    expect(body.route_steps).toEqual([])
    expect(body.estimated_arrival).toBe('12:00 to 12:12')
    expect(body.driver_impact).toBe('132 min on duty: +58 min duty time vs. normal.')
  })

  it('Reroute: names the route and its roads and carries the truck-suitability note', () => {
    const body = draft('reroute')!
    expect(body.instruction).toBe('Use the alternative route R-A-ALT.')
    expect(body.route_steps).toEqual([
      'Port exit to I-710 (Ocean Blvd / I-710 ramps)',
      'I-405 east / I-605 north to SR-60 (alternative corridor)',
      'SR-60 east to WH-A',
    ])
    expect(body.caution).toBe(TRUCK_CAUTION)
    expect(body.estimated_arrival).toBe('11:15 to 11:28')
    expect(body.driver_impact).toBe('88 min on duty: +14 min duty time vs. normal.')
  })

  it('a pending slot request is never worded as a new plan or as saved', () => {
    const body = draft('request_slot')!
    expect(body.instruction).toBe(PENDING_INSTRUCTION)
    expect(body.instruction).toContain('NOT confirmed')
    expect(body.reason).toContain('the original appointment still applies')
    expect(body.estimated_arrival).toBeNull()
    expect(allText(body)).not.toMatch(/saved|new slot is confirmed\b(?!\.)|new appointment/i)
  })

  it('never tells the driver they are late or to go faster', () => {
    for (const kind of ['wait', 'reroute', 'request_slot'] as const) {
      expect(allText(draft(kind)!)).not.toMatch(/\blate\b|hurry|faster|speed|make up|countdown/i)
    }
  })

  it('carries the shipment id as its only identifier', () => {
    const body = draft('reroute')!
    expect(body.shipment_id).toBe('S-01')
    expect(Object.keys(body).sort()).toEqual(
      [
        'appt_end',
        'appt_start',
        'caution',
        'destination_name',
        'driver_impact',
        'estimated_arrival',
        'instruction',
        'option_kind',
        'reason',
        'route_steps',
        'shipment_id',
        'what_changed',
      ].sort(),
    )
  })

  it('builds nothing for a preview, a wrong status or another shipment', () => {
    expect(draft('reroute', 'previewed')).toBeNull()
    expect(draft('wait', 'pending_confirmation')).toBeNull()
    expect(draft('request_slot', 'selected')).toBeNull()
    expect(
      buildDraft(view, { ...decision('wait'), shipment_id: 'S-02' }, sampleIncident),
    ).toBeNull()
  })

  it('builds nothing from an unconfirmed incident', () => {
    expect(
      buildDraft(view, decision('wait'), { ...sampleIncident, confirmed_by_user: false }),
    ).toBeNull()
  })
})
