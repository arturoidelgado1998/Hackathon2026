import { describe, expect, it } from 'vitest'
import {
  assumptions,
  getBaseline,
  getRoute,
  getShipment,
  sampleIncident,
  segments,
  shipments,
} from '../data'
import type { Route } from '../types'
import { calculateMetrics } from './metrics'
import type { MetricsInput, MetricsTiming } from './metrics'
import { formatTime } from './time'
import { departure, routeTiming } from './timing'

const shipment = getShipment('S-01')!
const route = getRoute(shipment.assigned_route_id)!
const start = departure(shipment, assumptions)
const normal = routeTiming(route, segments, start, null)
const base: MetricsInput = {
  shipment,
  route,
  segments,
  timing: normal,
  assumptions,
  normal_timing: normal,
}

function arrival(min: number | null, max: number | null): MetricsTiming {
  return { departure: 600, arrival_min: min, arrival_max: max }
}

describe('reference shipment estimates', () => {
  it('matches S-01 normal, closure-wait and alternative max-arrival cases exactly', () => {
    const alternative = getRoute('R-A-ALT')!
    const wait = routeTiming(route, segments, start, sampleIncident)
    const reroute = routeTiming(alternative, segments, start, sampleIncident)
    const results = [
      calculateMetrics(base),
      calculateMetrics({ ...base, timing: wait }),
      calculateMetrics({ ...base, route: alternative, timing: reroute }),
    ]
    expect(results.map((result) => [
      formatTime(result.arrival_min!), formatTime(result.arrival_max!),
      result.lateness_min, result.lateness_max, result.risk, result.miles,
      result.cost, result.co2_kg, result.driver_duty_min, result.driver_duty_increase_min,
    ])).toEqual([
      ['11:00', '11:14', 0, 0, 'ON_TRACK', 45, 130, 70.7, 74, 0],
      ['12:00', '12:12', 30, 42, 'LATE', 45, 169, 70.7, 132, 58],
      ['11:15', '11:28', 0, 0, 'ON_TRACK', 60, 167, 94.2, 88, 14],
    ])
    for (const result of results) {
      expect(result.estimated).toBe(true)
      expect(result.normal_driver_duty_min).toBe(74)
    }
  })

  it('matches the source normal metrics for all shipments', () => {
    for (const item of shipments) {
      const assigned = getRoute(item.assigned_route_id)!
      const timing = routeTiming(assigned, segments, departure(item, assumptions), null)
      expect(calculateMetrics({
        ...base, shipment: item, route: assigned, timing, normal_timing: timing,
      })).toMatchObject({ ...getBaseline(item.id), driver_duty_increase_min: 0, estimated: true })
    }
  })

  it('is deterministic and does not mutate any input', () => {
    const before = JSON.stringify(base)
    expect(calculateMetrics(base)).toEqual(calculateMetrics(base))
    expect(JSON.stringify(base)).toBe(before)
  })
})

describe('appointment service and risk boundaries', () => {
  it.each([
    [675, 690, 0, 0, 'ON_TRACK'],
    [690, 690, 0, 0, 'ON_TRACK'],
    [690, 691, 0, 1, 'TIGHT'],
    [689, 691, 0, 1, 'TIGHT'],
    [691, 700, 1, 10, 'LATE'],
  ])('classifies arrival %s–%s against the 11:30 inclusive deadline', (min, max, lateMin, lateMax, risk) => {
    expect(calculateMetrics({ ...base, timing: arrival(min, max) })).toMatchObject({
      lateness_min: lateMin, lateness_max: lateMax, risk, estimated: true,
    })
  })

  it('waits for appointment opening, never makes lateness negative, and ends duty at arrival', () => {
    const result = calculateMetrics({
      ...base,
      shipment: { appt_start: '11:00', appt_end: '11:30' },
      timing: arrival(610, 620),
    })
    expect(result).toMatchObject({
      service_start_min: 660, service_start_max: 660,
      lateness_min: 0, lateness_max: 0, risk: 'ON_TRACK', driver_duty_min: 20,
    })
  })

  it('supports a zero-width appointment window and same-minute zero-duration trip', () => {
    expect(calculateMetrics({
      ...base, shipment: { appt_start: '10:00', appt_end: '10:00' }, timing: arrival(600, 600),
    })).toMatchObject({
      service_start_min: 600, service_start_max: 600,
      lateness_min: 0, lateness_max: 0, risk: 'ON_TRACK', driver_duty_min: 0,
    })
  })
})

describe('unknown timing and explicit normal comparisons', () => {
  it('keeps unavailable metrics null when reopening is unknown, but preserves mileage and CO2', () => {
    const unknown = routeTiming(route, segments, start, {
      ...sampleIncident, reported_reopen_time: null, assumed_reopen_time: null,
    })
    expect(calculateMetrics({ ...base, timing: unknown })).toMatchObject({
      estimated: true, arrival_min: null, arrival_max: null,
      service_start_min: null, service_start_max: null,
      lateness_min: null, lateness_max: null, risk: 'UNKNOWN',
      cost: null, driver_duty_min: null, driver_duty_increase_min: null,
      normal_driver_duty_min: 74, miles: 45, co2_kg: 70.7,
    })
  })

  it('retains a known earliest bound without inventing a latest arrival', () => {
    expect(calculateMetrics({ ...base, timing: arrival(680, null) })).toMatchObject({
      arrival_min: 680, arrival_max: null, service_start_min: 680,
      service_start_max: null, lateness_min: 0, lateness_max: null,
      risk: 'UNKNOWN', cost: null, driver_duty_min: null,
    })
  })

  it('retains known max-case metrics when only the earliest bound is unavailable', () => {
    expect(calculateMetrics({ ...base, timing: arrival(null, 674) })).toMatchObject({
      lateness_min: null, lateness_max: 0, risk: 'UNKNOWN', driver_duty_min: 74, cost: 130,
    })
  })

  it.each([null, arrival(660, null), arrival(null, null)])(
    'returns a null increase for an explicitly unavailable normal max case: %s',
    (normalTiming) => {
      expect(calculateMetrics({ ...base, normal_timing: normalTiming })).toMatchObject({
        estimated: true, driver_duty_min: 74, normal_driver_duty_min: null,
        driver_duty_increase_min: null,
      })
    },
  )

  it('uses the supplied baseline departure and preserves a signed duty reduction', () => {
    expect(calculateMetrics({
      ...base, normal_timing: { departure: 580, arrival_min: 660, arrival_max: 674 },
    })).toMatchObject({
      estimated: true, normal_driver_duty_min: 94, driver_duty_increase_min: -20,
    })
  })

  it('rejects an omitted baseline instead of silently reporting zero increase', () => {
    expect(() => calculateMetrics({ ...base, normal_timing: undefined } as unknown as MetricsInput))
      .toThrow(/normal_timing must be supplied/)
  })
})

describe('cost, emissions and sensitive-zone context', () => {
  it('charges only mileage plus max-case labor, rounds once, and adds no idling emissions', () => {
    const simple: MetricsInput = {
      ...base,
      route: { ...route, segment_ids: ['single'] },
      segments: [{ id: 'single', miles: 3 }],
      timing: arrival(610, 630),
      assumptions: {
        mpg: 2, nonlabor_cost_per_mile: 1.1, labor_rate_per_hr: 10, diesel_kgCO2_per_gal: 3.14,
      },
    }
    expect(calculateMetrics(simple)).toMatchObject({ cost: 8, co2_kg: 4.7, driver_duty_min: 30 })
    expect(calculateMetrics({ ...simple, timing: arrival(610, 660) }))
      .toMatchObject({ cost: 13, co2_kg: 4.7, driver_duty_min: 60 })
  })

  it('allows zero mileage and cost rates without inventing an unknown-timing cost', () => {
    const free: MetricsInput = {
      ...base,
      segments: segments.map((segment) => ({ ...segment, miles: 0 })),
      assumptions: { ...assumptions, nonlabor_cost_per_mile: 0, labor_rate_per_hr: 0 },
    }
    expect(calculateMetrics(free)).toMatchObject({ miles: 0, cost: 0, co2_kg: 0 })
    expect(calculateMetrics({ ...free, timing: arrival(null, null) })).toMatchObject({ cost: null })
  })

  it('sums only route-ordered segment mileage, not stored totals or unrelated segments', () => {
    const staleRoute = { ...route, total_miles: 9999 }
    const unordered = [{ id: 'unused', miles: NaN }, ...[...segments].reverse()]
    expect(calculateMetrics({ ...base, route: staleRoute, segments: unordered }).miles).toBe(45)
  })

  it.each([true, false])('passes GIS context through unchanged when near_sensitive_zone=%s', (sensitive) => {
    const context: Route = {
      ...route, near_sensitive_zone: sensitive, schools_150m: 3,
      dac_tracts: ['06037500100', '06037500200'], max_diesel_pm_pctl: 93.5,
    }
    const result = calculateMetrics({ ...base, route: context })
    expect(result).toMatchObject({
      passes_sensitive_zone: sensitive, schools_150m: 3,
      dac_tracts: context.dac_tracts, max_diesel_pm_pctl: 93.5,
    })
    expect(calculateMetrics(base)).toMatchObject({
      schools_150m: null, dac_tracts: null, max_diesel_pm_pctl: null,
    })
  })
})

describe('explicit input validation', () => {
  it.each(['appt_start', 'appt_end'] as const)('rejects malformed or missing %s', (field) => {
    for (const value of ['24:00', '9:00', '11:60', '', undefined]) {
      expect(() => calculateMetrics({
        ...base, shipment: { ...shipment, [field]: value },
      } as unknown as MetricsInput)).toThrow(new RegExp(field))
    }
  })

  it('rejects reversed and overnight appointment windows', () => {
    for (const [appt_start, appt_end] of [['12:00', '11:30'], ['23:00', '01:00']]) {
      expect(() => calculateMetrics({ ...base, shipment: { appt_start, appt_end } }))
        .toThrow(/appt_start must not exceed appt_end/)
    }
  })

  it.each(['departure', 'arrival_min', 'arrival_max'] as const)('validates demo-day %s in both timings', (field) => {
    for (const value of [-1, 1440, 0.5, NaN, Infinity, undefined]) {
      for (const key of ['timing', 'normal_timing'] as const) {
        expect(() => calculateMetrics({
          ...base, [key]: { ...normal, [field]: value },
        } as unknown as MetricsInput)).toThrow(new RegExp(`${key}.${field}`))
      }
    }
  })

  it('rejects arrival before departure and reversed bounds, including the baseline', () => {
    for (const timing of [arrival(599, 674), arrival(null, 599), arrival(675, 674)]) {
      expect(() => calculateMetrics({ ...base, timing })).toThrow(/precede departure|must not exceed/)
      expect(() => calculateMetrics({ ...base, normal_timing: timing }))
        .toThrow(/precede departure|must not exceed/)
    }
  })

  it.each(['mpg', 'nonlabor_cost_per_mile', 'labor_rate_per_hr', 'diesel_kgCO2_per_gal'] as const)(
    'rejects invalid %s even if timing is unknown',
    (field) => {
      for (const value of [-1, NaN, Infinity, undefined, null, '1']) {
        expect(() => calculateMetrics({
          ...base, assumptions: { ...assumptions, [field]: value }, timing: arrival(null, null),
        } as unknown as MetricsInput)).toThrow(new RegExp(field))
      }
    },
  )

  it.each(['mpg', 'diesel_kgCO2_per_gal'] as const)('rejects zero %s', (field) => {
    expect(() => calculateMetrics({ ...base, assumptions: { ...assumptions, [field]: 0 } }))
      .toThrow(new RegExp(field))
  })

  it.each([-1, NaN, Infinity, undefined, null, '45'])('rejects invalid route segment mileage %s', (miles) => {
    const invalid = segments.map((segment) => segment.id === 'PORT-01' ? { ...segment, miles } : segment)
    expect(() => calculateMetrics({ ...base, segments: invalid } as unknown as MetricsInput))
      .toThrow(/PORT-01.miles/)
  })

  it('rejects missing and duplicate segment records and empty routes', () => {
    expect(() => calculateMetrics({ ...base, segments: [] })).toThrow(/Missing route segment/)
    expect(() => calculateMetrics({ ...base, segments: [...segments, segments[0]] }))
      .toThrow(/Duplicate segment id/)
    expect(() => calculateMetrics({ ...base, route: { ...route, segment_ids: [] } }))
      .toThrow(/segment_ids/)
  })

  it('rejects calculation overflow instead of returning Infinity', () => {
    expect(() => calculateMetrics({
      ...base, assumptions: { ...assumptions, nonlabor_cost_per_mile: Number.MAX_VALUE },
    })).toThrow(/calculated cost/)
    expect(() => calculateMetrics({
      ...base, assumptions: { ...assumptions, mpg: Number.MIN_VALUE },
    })).toThrow(/calculated co2_kg/)
    expect(() => calculateMetrics({
      ...base, segments: segments.map((segment) => ({ ...segment, miles: Number.MAX_VALUE })),
    })).toThrow(/route miles/)
  })
})
