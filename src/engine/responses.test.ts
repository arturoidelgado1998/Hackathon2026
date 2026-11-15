import { describe, expect, it } from 'vitest'
import { assumptions, routes, sampleIncident, segments, shipments } from '../data'
import sampleResponses from '../data/sample-responses.json'
import type { Incident, ResponseOption } from '../types'
import { assessShipment, buildResponseOptions } from './responses'
import type { EngineData } from './responses'

const data: EngineData = { routes, segments }
const reference = shipments.find((shipment) => shipment.id === 'S-01')!
const unknown: Incident = {
  ...sampleIncident, reported_reopen_time: null, assumed_reopen_time: null,
}

function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}

describe('fixture response options', () => {
  it('matches the fixture metrics for all three options on every affected shipment', () => {
    for (const shipment of shipments) {
      const options = buildResponseOptions(shipment, sampleIncident, data, assumptions)
      const expected = sampleResponses.scenarios.disrupted[
        shipment.id as keyof typeof sampleResponses.scenarios.disrupted
      ].options
      expect(options.map((option) => option.kind)).toEqual(expected.map((option) => option.kind))
      for (const [index, option] of options.entries()) {
        const fixture = expected[index] as ResponseOption
        expect(option).toMatchObject({
          kind: fixture.kind, arrival_min: fixture.arrival_min, arrival_max: fixture.arrival_max,
          lateness_min: fixture.lateness_min, lateness_max: fixture.lateness_max,
          risk: fixture.risk, miles: fixture.miles, cost: fixture.cost, co2_kg: fixture.co2_kg,
          driver_duty_min: fixture.driver_duty_min, passes_sensitive_zone: fixture.passes_sensitive_zone,
          requires_confirmation: fixture.requires_confirmation, estimated: true, available: true,
        })
        expect(option.explanation_inputs.length).toBeGreaterThan(0)
        expect(option.stakeholder_notes.length).toBeGreaterThan(0)
      }
    }
  })

  it('exposes exact S-01 metrics and compares reroute duty to the assigned original normal route', () => {
    const result = assessShipment(reference, sampleIncident, data, assumptions)
    expect(result.summary).toMatchObject({
      arrival_min: '12:00', arrival_max: '12:12', risk: 'LATE',
      lateness_min: 30, lateness_max: 42, affected: true,
    })
    expect(result.baseline).toMatchObject({ miles: 45, cost: 103, co2_kg: 67.6, driver_duty_min: 74 })
    expect(result.options[0].metrics).toMatchObject({
      cost: 138, driver_duty_min: 132, normal_driver_duty_min: 74, driver_duty_increase_min: 58,
    })
    expect(result.options[1]).toMatchObject({
      kind: 'reroute', route_id: 'R-A-ALT', added_miles: 15,
      arrival_min: '11:15', arrival_max: '11:28', risk: 'ON_TRACK',
      cost: 132, co2_kg: 90.1,
      metrics: { driver_duty_min: 88, normal_driver_duty_min: 74, driver_duty_increase_min: 14 },
    })
    expect(result.options[0].explanation_inputs.join('\n')).toContain('$138')
    expect(result.options[1].stakeholder_notes.join('\n')).toContain('flagged sensitive zone')
  })

  it('returns no options for normal trips or trips unaffected by this incident', () => {
    for (const shipment of shipments) {
      expect(buildResponseOptions(shipment, null, data, assumptions)).toEqual([])
    }
    for (const id of ['S-06', 'S-08', 'S-09', 'S-10']) {
      const assessment = assessShipment(shipments.find((shipment) => shipment.id === id)!, sampleIncident, data, assumptions)
      expect(assessment).toMatchObject({
        summary: { affected: false }, options: [],
        reopen_needed_by: null, reroute_decide_by: null, no_feasible_response: false,
      })
    }
  })

  it('flags only S-03 as having no feasible driving response, not the TIGHT S-04 alternative', () => {
    const assessed = shipments.map((shipment) => ({
      id: shipment.id, assessment: assessShipment(shipment, sampleIncident, data, assumptions),
    }))
    expect(assessed.filter((item) => item.assessment.no_feasible_response).map((item) => item.id))
      .toEqual(['S-03'])
    expect(assessed.find((item) => item.id === 'S-04')!.assessment.options[1].risk).toBe('TIGHT')
  })
})

describe('decision deadlines and reopening uncertainty', () => {
  it('calculates S-01 deadlines from segment timing, ignoring stored route totals', () => {
    const result = assessShipment(reference, sampleIncident, {
      ...data,
      routes: routes.map((route) => ({ ...route, total_minutes_max: 999 })),
    }, assumptions)
    expect(result).toMatchObject({
      reopen_needed_by: '10:28', reopen_remaining_max_min: 62,
      reroute_decide_by: '10:02', reroute_travel_max_min: 88,
    })
    expect(result.options[0].explanation_inputs.join('\n')).toContain('62 max travel min')
    expect(result.options[1].explanation_inputs.join('\n')).toContain('88 max alternative travel min')
  })

  it('supplies both deadlines for every affected fixture shipment', () => {
    const expected = [
      ['S-01', '10:28', '10:02'], ['S-02', '12:58', '12:32'],
      ['S-03', '10:32', '10:06'], ['S-04', '10:24', '09:57'],
      ['S-05', '13:34', '13:07'], ['S-07', '11:04', '10:37'],
    ]
    for (const [id, reopen, reroute] of expected) {
      expect(assessShipment(shipments.find((shipment) => shipment.id === id)!, sampleIncident, data, assumptions))
        .toMatchObject({ reopen_needed_by: reopen, reroute_decide_by: reroute })
    }
  })

  it('does not guess arrival or costs when reopening is unknown', () => {
    const result = assessShipment(reference, unknown, data, assumptions)
    expect(result.options[0]).toMatchObject({
      arrival_min: null, arrival_max: null, lateness_min: null, lateness_max: null,
      cost: null, driver_duty_min: null, risk: 'UNKNOWN', miles: 45, co2_kg: 67.6,
    })
    expect(result.options[0].status).toContain('works only if NB-03 reopens by 10:28')
    expect(result.options[0].explanation_inputs.join('\n'))
      .toContain('works only if NB-03 reopens by 10:28')
    expect(result.options[1]).toMatchObject({ arrival_min: '11:15', arrival_max: '11:28', cost: 132 })
    expect(result.options[2]).toMatchObject({ risk: 'UNKNOWN', status: 'pending_confirmation' })
  })

  it('honors and explicitly labels assumed reopening instead of the report', () => {
    const result = assessShipment(reference, {
      ...sampleIncident, assumed_reopen_time: '10:20',
    }, data, assumptions)
    expect(result.options[0]).toMatchObject({
      arrival_min: '11:10', arrival_max: '11:22', risk: 'ON_TRACK',
    })
    expect(result.options[0].status).toContain('user-assumed reopening 10:20')
    expect(result.options[0].explanation_inputs.join('\n')).toContain('explicit user assumption overriding the report')
    expect(result.summary.reason).toContain('assumed')
  })

  it('keeps a partially known earliest arrival without inventing a latest bound', () => {
    const result = assessShipment({
      ...reference, cargo_ready: '09:19', truck_available: '09:00',
    }, unknown, data, assumptions)
    expect(result.options[0]).toMatchObject({
      arrival_min: '10:49', arrival_max: null, lateness_min: 0, lateness_max: null,
      cost: null, risk: 'UNKNOWN',
    })
  })
})

describe('unavailable routes and pending appointments', () => {
  it('marks a missing alternative unavailable rather than substituting the original', () => {
    const result = assessShipment(reference, sampleIncident, {
      ...data, routes: routes.filter((route) => route.id !== 'R-A-ALT'),
    }, assumptions)
    expect(result.options[1]).toMatchObject({
      available: false, status: 'unavailable', route_id: null, metrics: null,
      arrival_min: null, arrival_max: null, cost: null, miles: null, risk: 'UNKNOWN',
    })
    expect(result.options[1].unavailable_reason).toContain('No alternative route')
    expect(result).toMatchObject({ reroute_decide_by: null, reroute_travel_max_min: null })
  })

  it('marks an alternative containing the closed segment unavailable, regardless of reopening', () => {
    const blocked: EngineData = {
      ...data,
      routes: routes.map((route) => route.id === 'R-A-ALT'
        ? { ...route, segment_ids: ['PORT-01', 'NB-03', 'WH-A-APPR'] }
        : route),
    }
    for (const incident of [sampleIncident, unknown]) {
      const result = assessShipment(reference, incident, blocked, assumptions)
      expect(result.options[1]).toMatchObject({
        available: false, status: 'unavailable', route_id: 'R-A-ALT', metrics: null,
      })
      expect(result.options[1].unavailable_reason).toContain('closed segment NB-03')
      expect(result.reroute_decide_by).toBeNull()
    }
  })

  it('keeps request-slot estimates null and retains the current original-deadline risk', () => {
    const request = buildResponseOptions(reference, sampleIncident, data, assumptions)[2]
    expect(request).toMatchObject({
      kind: 'request_slot', status: 'pending_confirmation', requires_confirmation: true,
      metrics: null, arrival_min: null, arrival_max: null, lateness_min: null, lateness_max: null,
      cost: null, miles: null, co2_kg: null, driver_duty_min: null, added_miles: null, risk: 'LATE',
    })
    expect(request.explanation_inputs.join('\n')).toContain('original deadline 11:30')
  })

  it('preserves supplied community facts in metrics rather than inventing zeroes', () => {
    const note = 'Supplied corridor screening note; not measured exposure.'
    const result = assessShipment(reference, sampleIncident, {
      ...data,
      routes: routes.map((route) => {
        if (route.id === 'R-A-ALT') {
          return {
            ...route, schools_150m: 3, dac_tracts: ['tract-1'], max_diesel_pm_pctl: 92,
            sensitive_zone_note: note,
          }
        }
        if (route.id === reference.assigned_route_id) {
          return { ...route, schools_150m: null, dac_tracts: null, max_diesel_pm_pctl: null }
        }
        return route
      }),
    }, assumptions)
    expect(result.options[1].metrics).toMatchObject({
      schools_150m: 3, dac_tracts: ['tract-1'], max_diesel_pm_pctl: 92,
    })
    expect(result.options[1].stakeholder_notes).toContain(note)
    expect(result.baseline).toMatchObject({
      schools_150m: null, dac_tracts: null, max_diesel_pm_pctl: null,
    })
  })
})

describe('pure operation and explicit input failures', () => {
  it('is deterministic with deeply frozen inputs, including reversed data lookup order', () => {
    const inputs = freeze(structuredClone({ shipment: reference, incident: sampleIncident, data, assumptions }))
    const before = JSON.stringify(inputs)
    const first = assessShipment(inputs.shipment, inputs.incident, inputs.data, inputs.assumptions)
    expect(assessShipment(inputs.shipment, inputs.incident, inputs.data, inputs.assumptions)).toEqual(first)
    expect(assessShipment(inputs.shipment, inputs.incident, {
      routes: [...inputs.data.routes].reverse(), segments: [...inputs.data.segments].reverse(),
    }, inputs.assumptions)).toEqual(first)
    expect(JSON.stringify(inputs)).toBe(before)
  })

  it('uses stable route-id ordering when more than one alternative is supplied', () => {
    const alt = routes.find((route) => route.id === 'R-A-ALT')!
    const result = assessShipment(reference, sampleIncident, {
      ...data, routes: [{ ...alt, id: 'ZZ-ALT' }, ...routes],
    }, assumptions)
    expect(result.options[1].route_id).toBe('R-A-ALT')
  })

  it('rejects missing or incompatible assigned routes, duplicate ids and unknown incident segments', () => {
    expect(() => assessShipment({ ...reference, assigned_route_id: 'missing' }, sampleIncident, data, assumptions))
      .toThrow(/Missing assigned route/)
    expect(() => assessShipment({ ...reference, destination_id: 'WH-B' }, sampleIncident, data, assumptions))
      .toThrow(/must be an original route to WH-B/)
    expect(() => assessShipment(reference, sampleIncident, { ...data, routes: [...routes, routes[0]] }, assumptions))
      .toThrow(/Duplicate route id/)
    expect(() => assessShipment(reference, { ...sampleIncident, segment_id: 'missing' }, data, assumptions))
      .toThrow(/Missing incident segment/)
  })

  it('does not disguise malformed alternative segments as valid unavailable data', () => {
    expect(() => assessShipment(reference, sampleIncident, {
      ...data, routes: routes.map((route) => route.id === 'R-A-ALT'
        ? { ...route, segment_ids: ['missing'] } : route),
    }, assumptions)).toThrow(/Missing route segment/)
    expect(() => assessShipment(reference, sampleIncident, {
      ...data, segments: segments.map((segment) => segment.id === 'EB-405'
        ? { ...segment, miles: -1 } : segment),
    }, assumptions)).toThrow(/miles/)
  })

  it('propagates E1/E2 appointment, assumption, incident and demo-day errors', () => {
    expect(() => assessShipment({ ...reference, appt_start: '12:00' }, sampleIncident, data, assumptions))
      .toThrow(/appt_start/)
    expect(() => assessShipment(reference, sampleIncident, data, { ...assumptions, mpg: 0 }))
      .toThrow(/mpg/)
    expect(() => assessShipment(reference, { ...sampleIncident, reported_reopen_time: '09:59' }, data, assumptions))
      .toThrow(/must not precede/)
    expect(() => assessShipment({ ...reference, appt_start: '00:00', appt_end: '00:30' }, sampleIncident, data, assumptions))
      .toThrow(/reopen_needed_by falls before/)
  })
})
