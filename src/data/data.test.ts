import { describe, expect, it } from 'vitest'
import type { ResponseOption, RiskLabel } from '../types'
import assumptionsJson from './assumptions.json'
import facilitiesJson from './facilities.json'
import routesJson from './routes.json'
import sampleResponsesJson from './sample-responses.json'
import segmentsJson from './segments.json'
import shipmentsJson from './shipments.json'
import {
  REFERENCE_SHIPMENT_ID,
  assumptions,
  facilities,
  getBaseline,
  getFacility,
  getResponseOptions,
  getRoute,
  getRoutesForDestination,
  getSegment,
  getShipmentSummary,
  routes,
  sampleIncident,
  segments,
  shipments,
  type Scenario,
} from './index'

const RISKS: RiskLabel[] = ['ON_TRACK', 'TIGHT', 'LATE', 'UNKNOWN']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const SCENARIOS: Scenario[] = ['normal', 'disrupted']
const isTimeOrNull = (v: unknown) => v === null || (typeof v === 'string' && HHMM.test(v))
const isNumOrNull = (v: unknown) => v === null || typeof v === 'number'
const keys = (o: object) => Object.keys(o).sort()

describe('sample data files', () => {
  it('are all labelled SIMULATED', () => {
    for (const file of [facilitiesJson, segmentsJson, routesJson, shipmentsJson, assumptionsJson, sampleResponsesJson]) {
      expect(file.label).toBe('SIMULATED')
    }
    expect(assumptionsJson.placeholder).toBe(true)
    expect(Object.values(assumptionsJson.placeholders).every((v) => v === true)).toBe(true)
  })

  it('facilities satisfy Facility', () => {
    for (const f of facilities) {
      expect(typeof f.id).toBe('string')
      expect(typeof f.name).toBe('string')
      expect(['port', 'warehouse']).toContain(f.type)
      expect(f.lat).toBeGreaterThan(33.5)
      expect(f.lat).toBeLessThan(34.5)
      expect(f.lon).toBeGreaterThan(-118.6)
      expect(f.lon).toBeLessThan(-117)
    }
  })

  it('segments satisfy RoadSegment with null geometry', () => {
    expect(segments.length).toBeGreaterThanOrEqual(5)
    expect(segments.length).toBeLessThanOrEqual(8)
    for (const s of segments) {
      expect(s.geometry).toBeNull()
      expect(s.miles).toBeGreaterThan(0)
      expect(s.minutes_min).toBeGreaterThan(0)
      expect(s.minutes_max).toBeGreaterThanOrEqual(s.minutes_min)
      expect(typeof s.name).toBe('string')
      expect(typeof s.near_sensitive_zone).toBe('boolean')
      expect(typeof s.sensitive_zone_note).toBe('string')
    }
    expect(segments.some((s) => s.minutes_max > s.minutes_min)).toBe(true)
  })

  it('routes satisfy Route and reference real facilities and segments', () => {
    for (const r of routes) {
      expect(getFacility(r.origin)?.type).toBe('port')
      expect(getFacility(r.destination)?.type).toBe('warehouse')
      expect(['original', 'alternative']).toContain(r.kind)
      expect(r.segment_ids.length).toBeGreaterThan(0)
      for (const id of r.segment_ids) expect(getSegment(id)).toBeDefined()
      expect(r.truck_suitability_note).toMatch(/not verified/i)
      expect(typeof r.near_sensitive_zone).toBe('boolean')
    }
  })

  it('shipments satisfy Shipment', () => {
    for (const s of shipments) {
      for (const t of [s.cargo_ready, s.truck_available, s.appt_start, s.appt_end]) expect(t).toMatch(HHMM)
      expect(s.appt_start < s.appt_end).toBe(true)
      expect(getFacility(s.destination_id)?.type).toBe('warehouse')
      const route = getRoute(s.assigned_route_id)
      expect(route?.destination).toBe(s.destination_id)
      expect(route?.kind).toBe('original')
    }
  })

  it('assumptions satisfy Assumptions with sources for every value', () => {
    expect(assumptions).toMatchObject({
      mpg: 6.5,
      nonlabor_cost_per_mile: 1.8,
      labor_rate_per_hr: 40,
      diesel_kgCO2_per_gal: 10.21,
    })
    expect(typeof assumptions.pickup_handling_min).toBe('number')
    for (const k of ['pickup_handling_min', 'mpg', 'nonlabor_cost_per_mile', 'labor_rate_per_hr', 'diesel_kgCO2_per_gal']) {
      expect(assumptions.sources[k]).toMatch(/\S/)
      expect(assumptionsJson.placeholders[k as keyof typeof assumptionsJson.placeholders]).toBe(true)
    }
    expect(assumptions.sources.diesel_kgCO2_per_gal).toContain('EPA GHG Emission Factors Hub, 2025')
  })

  it('sample incident is the NB-03 closure', () => {
    expect(sampleIncident).toMatchObject({
      segment_id: 'NB-03',
      type: 'closure',
      start_time: '10:00',
      reported_reopen_time: '11:10',
    })
    expect(getSegment(sampleIncident.segment_id)).toBeDefined()
  })
})

describe('counts and route totals', () => {
  it('has 1 port, 3 fictional warehouses and 10 shipments', () => {
    expect(facilities.filter((f) => f.type === 'port')).toHaveLength(1)
    const warehouses = facilities.filter((f) => f.type === 'warehouse')
    expect(warehouses).toHaveLength(3)
    for (const w of warehouses) expect(w.name).toMatch(/\(fictional\)/)
    expect(shipments).toHaveLength(10)
    expect(new Set(shipments.map((s) => s.id)).size).toBe(10)
  })

  it('has one original and one alternative route per warehouse', () => {
    for (const w of facilities.filter((f) => f.type === 'warehouse')) {
      expect(getRoutesForDestination(w.id).map((r) => r.kind)).toEqual(['original', 'alternative'])
    }
  })

  it('stores route totals equal to the sum of segments', () => {
    for (const r of routes) {
      const segs = r.segment_ids.map((id) => getSegment(id)!)
      expect(r.total_miles).toBe(segs.reduce((a, s) => a + s.miles, 0))
      expect(r.total_minutes_min).toBe(segs.reduce((a, s) => a + s.minutes_min, 0))
      expect(r.total_minutes_max).toBe(segs.reduce((a, s) => a + s.minutes_max, 0))
    }
  })

  it('uses NB-03 on 4 or 5 routes, and at least 2 shipments avoid it', () => {
    const using = routes.filter((r) => r.segment_ids.includes('NB-03'))
    expect(using.length).toBeGreaterThanOrEqual(4)
    expect(using.length).toBeLessThanOrEqual(5)
    const avoiding = shipments.filter((s) => !getRoute(s.assigned_route_id)!.segment_ids.includes('NB-03'))
    expect(avoiding.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps sensitive-zone fields as placeholders', () => {
    for (const r of routes) {
      expect(r.schools_150m).toBeNull()
      expect(r.dac_tracts).toBeNull()
      expect(r.max_diesel_pm_pctl).toBeNull()
    }
    const flagged = routes.filter((r) => r.near_sensitive_zone)
    expect(flagged.length).toBeGreaterThanOrEqual(1)
    for (const r of flagged) {
      expect(r.kind).toBe('alternative')
      expect(r.sensitive_zone_note).toBe('PLACEHOLDER, replaced by corridor analysis (G3)')
    }
  })
})

describe('reference shipment SHP-001', () => {
  const s = shipments.find((x) => x.id === REFERENCE_SHIPMENT_ID)!

  it('matches the issue route and timing inputs', () => {
    expect(s.destination_id).toBe('WH-A')
    expect(s.appt_start).toBe('11:00')
    expect(s.appt_end).toBe('11:30')
    const orig = getRoute(s.assigned_route_id)!
    expect(orig.segment_ids).toEqual(['PORT-01', 'NB-03', 'WH-A-APPR'])
    expect(getSegment('PORT-01')).toMatchObject({ miles: 5, minutes_min: 10, minutes_max: 10 })
    expect(getSegment('NB-03')).toMatchObject({ miles: 25, minutes_min: 30, minutes_max: 30 })
    expect(getSegment('WH-A-APPR')).toMatchObject({ miles: 15, minutes_min: 20, minutes_max: 20 })
    const alt = getRoutesForDestination('WH-A')[1]
    expect(alt).toMatchObject({ total_miles: 60, total_minutes_min: 75, total_minutes_max: 75 })
    expect(alt.segment_ids).not.toContain('NB-03')
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
    const departure = Math.max(toMin(s.cargo_ready), toMin(s.truck_available)) + assumptions.pickup_handling_min
    expect(departure).toBe(10 * 60)
  })

  it('normal: 11:00, meets window, 45 mi, $121, 70.7 kg', () => {
    expect(getShipmentSummary(s.id, 'normal')).toEqual({
      risk: 'ON_TRACK', arrival_min: '11:00', arrival_max: '11:00', lateness_min: 0, lateness_max: 0,
      reason: expect.any(String), affected: false,
    })
    expect(getBaseline(s.id)).toEqual({ miles: 45, cost: 121, co2_kg: 70.7, driver_duty_min: 60 })
  })

  it('disrupted options match the issue table', () => {
    const [wait, reroute, slot] = getResponseOptions(s.id, 'disrupted')
    expect(wait).toMatchObject({
      kind: 'wait', arrival_min: '12:00', arrival_max: '12:00', lateness_min: 30, lateness_max: 30,
      risk: 'LATE', miles: 45, cost: 161, co2_kg: 70.7, driver_duty_min: 120,
    })
    expect(reroute).toMatchObject({
      kind: 'reroute', arrival_min: '11:15', arrival_max: '11:15', lateness_min: 0, lateness_max: 0,
      risk: 'ON_TRACK', miles: 60, cost: 158, co2_kg: 94.2, driver_duty_min: 75, passes_sensitive_zone: true,
    })
    expect(slot).toMatchObject({
      kind: 'request_slot', arrival_min: null, arrival_max: null, lateness_min: null, lateness_max: null,
      miles: null, cost: null, co2_kg: null, driver_duty_min: null, requires_confirmation: true,
      status: 'Pending confirmation; original deadline still applies', risk: 'LATE',
    })
    expect(getShipmentSummary(s.id, 'disrupted')).toMatchObject({ risk: 'LATE', arrival_max: '12:00', affected: true })
  })
})

describe('summaries and options', () => {
  it('every shipment has an exact summary in both scenarios and an exact baseline', () => {
    for (const s of shipments) {
      for (const sc of SCENARIOS) {
        const sum = getShipmentSummary(s.id, sc)
        expect(keys(sum)).toEqual(['affected', 'arrival_max', 'arrival_min', 'lateness_max', 'lateness_min', 'reason', 'risk'])
        expect(RISKS).toContain(sum.risk)
        expect(isTimeOrNull(sum.arrival_min) && isTimeOrNull(sum.arrival_max)).toBe(true)
        expect(isNumOrNull(sum.lateness_min) && isNumOrNull(sum.lateness_max)).toBe(true)
        expect(sum.reason).toMatch(/\S/)
        expect(typeof sum.affected).toBe('boolean')
      }
      expect(getShipmentSummary(s.id, 'normal').affected).toBe(false)
      expect(getResponseOptions(s.id, 'normal')).toEqual([])
      expect(keys(getBaseline(s.id))).toEqual(['co2_kg', 'cost', 'driver_duty_min', 'miles'])
    }
  })

  it('affected shipments have wait, reroute, request_slot; unaffected have none', () => {
    for (const s of shipments) {
      const opts = getResponseOptions(s.id, 'disrupted')
      if (getShipmentSummary(s.id, 'disrupted').affected) {
        expect(opts.map((o) => o.kind)).toEqual(['wait', 'reroute', 'request_slot'])
      } else {
        expect(opts).toEqual([])
      }
    }
  })

  it('options are well formed and follow the slot / reroute rules', () => {
    for (const s of shipments) {
      const summary = getShipmentSummary(s.id, 'disrupted')
      for (const o of getResponseOptions(s.id, 'disrupted')) {
        const check = (opt: ResponseOption) => {
          expect(RISKS).toContain(opt.risk)
          expect(isTimeOrNull(opt.arrival_min) && isTimeOrNull(opt.arrival_max)).toBe(true)
          expect(opt.explanation_inputs.length).toBeGreaterThan(0)
          expect(Array.isArray(opt.stakeholder_notes)).toBe(true)
        }
        check(o)
        if (o.kind === 'wait') {
          expect(o.risk).toBe(summary.risk)
          expect(o.arrival_max).toBe(summary.arrival_max)
        }
        if (o.kind === 'request_slot') {
          expect(o.risk).toBe(summary.risk)
          expect(o.requires_confirmation).toBe(true)
          expect(o.status).toBe('Pending confirmation; original deadline still applies')
          expect([o.miles, o.cost, o.co2_kg, o.arrival_min, o.driver_duty_min]).toEqual([null, null, null, null, null])
        }
        if (o.kind === 'reroute') {
          const alt = getRoutesForDestination(s.destination_id)[1]
          if (alt.segment_ids.includes('NB-03')) {
            expect(o.risk).toBe('UNKNOWN')
            expect(o.status).toMatch(/Unavailable/)
            expect(o.miles).toBeNull()
          } else {
            const wait = getResponseOptions(s.id, 'disrupted')[0]
            expect(o.miles!).toBeGreaterThan(wait.miles!)
            expect(o.co2_kg!).toBeGreaterThan(wait.co2_kg!)
            expect(o.passes_sensitive_zone).toBe(alt.near_sensitive_zone)
          }
        }
      }
    }
  })
})

describe('shipment mix after the sample closure', () => {
  const d = (id: string) => getShipmentSummary(id, 'disrupted')
  const opts = (id: string) => getResponseOptions(id, 'disrupted')
  const ids = shipments.map((s) => s.id)

  it('meets every mix requirement', () => {
    expect(ids.filter((id) => !d(id).affected).length).toBeGreaterThanOrEqual(2)
    expect(ids.filter((id) => d(id).affected && d(id).risk === 'ON_TRACK').length).toBeGreaterThanOrEqual(2)
    expect(ids.filter((id) => d(id).risk === 'TIGHT' || d(id).risk === 'LATE').length).toBeGreaterThanOrEqual(2)
    expect(ids.filter((id) => d(id).risk !== 'ON_TRACK' && opts(id)[1]?.risk === 'ON_TRACK').length).toBeGreaterThanOrEqual(1)
    const unfixable = ids.filter((id) => {
      const [wait, reroute] = opts(id)
      return wait?.risk === 'LATE' && (reroute.risk === 'LATE' || reroute.risk === 'UNKNOWN')
    })
    expect(unfixable.length).toBeGreaterThanOrEqual(1)
    expect(ids.some((id) => d(id).risk === 'TIGHT')).toBe(true)
  })

  it('no option wins every metric for the reference shipment', () => {
    const [wait, reroute] = opts(REFERENCE_SHIPMENT_ID)
    expect(reroute.lateness_max!).toBeLessThan(wait.lateness_max!)
    expect(reroute.miles!).toBeGreaterThan(wait.miles!)
    expect(reroute.co2_kg!).toBeGreaterThan(wait.co2_kg!)
  })
})

describe('privacy', () => {
  it('has no personal-data fields or values', () => {
    const banned = /driver_?name|first_?name|last_?name|full_?name|phone|email|contact|license|ssn|dob/i
    const valuesBanned = [/@/, /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/, /\b(Mr|Mrs|Ms|Dr)\.?\s+[A-Z]/]
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') {
        for (const [k, child] of Object.entries(v)) {
          expect(k).not.toMatch(banned)
          walk(child)
        }
      } else if (typeof v === 'string') {
        for (const re of valuesBanned) expect(v).not.toMatch(re)
      }
    }
    ;[facilitiesJson, segmentsJson, routesJson, shipmentsJson, assumptionsJson, sampleResponsesJson].forEach(walk)
  })
})
