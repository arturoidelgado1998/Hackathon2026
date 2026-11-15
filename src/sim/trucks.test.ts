import { describe, expect, it } from 'vitest'
import {
  facilities,
  getResponseOptions,
  getRoute,
  getShipmentSummary,
  sampleIncident,
  segments,
  shipments,
} from '../data/index.ts'
import { formatTime, parseTime } from '../engine/time.ts'
import { runSimulation } from '../state/simulation.ts'
import { buildTruckPlans } from '../state/trucks.ts'
import type { Decision, LonLat } from '../types.ts'
import { DEFAULT_SETTINGS } from './settings.ts'
import { countTrucks, pointAlong, simWindow, truckStateAt } from './trucks.ts'

const at = (hhmm: string) => parseTime(hhmm)
const plan = (plans: ReturnType<typeof buildTruckPlans>, id: string) => {
  const found = plans.find((p) => p.shipment_id === id)
  if (!found) throw new Error(`No plan for ${id}`)
  return found
}
const reroute = (id: string): Decision => ({
  shipment_id: id,
  option_kind: 'reroute',
  status: 'selected',
  timestamp: '2026-11-14T10:00:00Z',
})
const facility = (id: string): LonLat => {
  const f = facilities.find((item) => item.id === id)!
  return [f.lon, f.lat]
}

describe('pointAlong', () => {
  const line: LonLat[] = [[0, 0], [0, 1], [0, 3]]

  it('measures by length, not by point count', () => {
    expect(pointAlong(line, 0)).toEqual([0, 0])
    expect(pointAlong(line, 1)).toEqual([0, 3])
    expect(pointAlong(line, 0.5)![1]).toBeCloseTo(1.5, 6)
    expect(pointAlong(line, 1 / 3)![1]).toBeCloseTo(1, 6)
  })

  it('clamps out-of-range shares and handles empty lines', () => {
    expect(pointAlong(line, -1)).toEqual([0, 0])
    expect(pointAlong(line, 2)).toEqual([0, 3])
    expect(pointAlong([], 0.5)).toBeNull()
  })
})

describe('truck plans agree with the engine', () => {
  for (const scenario of ['normal', 'disrupted'] as const) {
    it(`every truck arrives at the ${scenario} arrival range the board shows`, () => {
      const slow = buildTruckPlans(scenario, {}, 'slow')
      const fast = buildTruckPlans(scenario, {}, 'fast')
      for (const shipment of shipments) {
        const summary = getShipmentSummary(shipment.id, scenario)
        expect(formatTime(plan(slow, shipment.id).arrival!)).toBe(summary.arrival_max)
        expect(formatTime(plan(fast, shipment.id).arrival!)).toBe(summary.arrival_min)
      }
    })
  }

  it('a rerouted truck arrives at the reroute option’s arrival range', () => {
    for (const shipment of shipments) {
      const option = getResponseOptions(shipment.id, 'disrupted').find((o) => o.kind === 'reroute')
      if (!option?.available) continue
      const decisions = { [shipment.id]: reroute(shipment.id) }
      const slow = plan(buildTruckPlans('disrupted', decisions, 'slow'), shipment.id)
      const fast = plan(buildTruckPlans('disrupted', decisions, 'fast'), shipment.id)
      expect(slow.route_id).toBe(option.route_id)
      expect(slow.rerouted).toBe(true)
      expect(formatTime(slow.arrival!)).toBe(option.arrival_max)
      expect(formatTime(fast.arrival!)).toBe(option.arrival_min)
      expect(slow.legs.map((leg) => leg.segment_id)).not.toContain(sampleIncident.segment_id)
    }
  })

  it('a slot request or a preview does not move the truck off its route', () => {
    const decisions: Record<string, Decision> = {
      'S-01': { ...reroute('S-01'), option_kind: 'request_slot', status: 'pending_confirmation' },
    }
    const truck = plan(buildTruckPlans('disrupted', decisions), 'S-01')
    expect(truck.route_id).toBe('R-A-ORIG')
    expect(truck.rerouted).toBe(false)
  })

  it('ignores a reroute decision in the normal scenario', () => {
    const truck = plan(buildTruckPlans('normal', { 'S-01': reroute('S-01') }), 'S-01')
    expect(truck.route_id).toBe('R-A-ORIG')
  })
})

describe('the reference shipment S-01', () => {
  it('normal: leaves at 10:00 and arrives 11:00 to 11:14', () => {
    const fast = plan(buildTruckPlans('normal', {}, 'fast'), 'S-01')
    const slow = plan(buildTruckPlans('normal', {}, 'slow'), 'S-01')
    expect(formatTime(fast.departure)).toBe('10:00')
    expect(formatTime(fast.arrival!)).toBe('11:00')
    expect(formatTime(slow.arrival!)).toBe('11:14')
    expect(truckStateAt(slow, at('09:59'), segments).status).toBe('at_port')
    expect(truckStateAt(slow, at('10:00'), segments)).toMatchObject({ status: 'moving', segment_id: 'PORT-01' })
    expect(truckStateAt(slow, at('11:13'), segments)).toMatchObject({ status: 'moving', segment_id: 'WH-A-APPR' })
    expect(truckStateAt(slow, at('11:14'), segments).status).toBe('arrived')
  })

  it('disrupted, fast case: held at the port until 11:00, reaches NB-03 as it reopens, arrives 12:00', () => {
    const truck = plan(buildTruckPlans('disrupted', {}, 'fast'), 'S-01')
    expect(truck).toMatchObject({ departure: at('10:00'), leaves: at('11:00'), held_for: 'NB-03' })
    for (const time of ['10:00', '10:30', '10:59']) {
      expect(truckStateAt(truck, at(time), segments)).toMatchObject({
        status: 'at_port',
        held_for: 'NB-03',
        wait_until: at('11:00'),
      })
    }
    expect(truckStateAt(truck, at('11:00'), segments)).toMatchObject({ status: 'moving', segment_id: 'PORT-01' })
    expect(truckStateAt(truck, at('11:10'), segments)).toMatchObject({ status: 'moving', segment_id: 'NB-03', fraction: 0 })
    expect(truckStateAt(truck, at('11:40'), segments)).toMatchObject({ status: 'moving', segment_id: 'WH-A-APPR' })
    expect(truckStateAt(truck, at('12:00'), segments).status).toBe('arrived')
  })

  it('disrupted, slow case: held at the port until 10:58 and arrives 12:12', () => {
    const truck = plan(buildTruckPlans('disrupted', {}, 'slow'), 'S-01')
    expect(truck.leaves).toBe(at('10:58'))
    expect(truckStateAt(truck, at('10:57'), segments)).toMatchObject({ status: 'at_port', held_for: 'NB-03' })
    expect(truckStateAt(truck, at('10:58'), segments)).toMatchObject({ status: 'moving', segment_id: 'PORT-01' })
    expect(truckStateAt(truck, at('11:10'), segments)).toMatchObject({ status: 'moving', segment_id: 'NB-03' })
    expect(truckStateAt(truck, at('11:48'), segments)).toMatchObject({ status: 'moving', segment_id: 'WH-A-APPR' })
    expect(truckStateAt(truck, at('12:11'), segments).status).toBe('moving')
    expect(truckStateAt(truck, at('12:12'), segments).status).toBe('arrived')
  })

  it('a truck already on the road when the closure starts queues at it; later ones are held at the port', () => {
    // NB-03 closes at 10:05: S-01 left at 10:00 and is caught; S-02 is ready at 10:15 and is held.
    const run = runSimulation({ ...DEFAULT_SETTINGS, start: '10:05', timingCase: 'fast' })
    const caught = plan(run.plans, 'S-01')
    expect(caught).toMatchObject({ leaves: at('10:00'), held_for: null })
    expect(truckStateAt(caught, at('10:30'), segments)).toMatchObject({ status: 'waiting', segment_id: 'NB-03', wait_until: at('11:10') })
    const held = plan(run.plans, 'S-02')
    expect(held).toMatchObject({ held_for: 'NB-03', leaves: at('11:00') })
    expect(truckStateAt(held, at('10:30'), segments)).toMatchObject({ status: 'at_port', held_for: 'NB-03' })
  })

  it('rerouted: takes R-A-ALT and arrives 11:15 to 11:28', () => {
    const decisions = { 'S-01': reroute('S-01') }
    const slow = plan(buildTruckPlans('disrupted', decisions, 'slow'), 'S-01')
    expect(slow.legs.map((leg) => leg.segment_id)).toEqual(['PORT-01', 'EB-405', 'WH-A-APPR'])
    expect(formatTime(slow.arrival!)).toBe('11:28')
    expect(formatTime(plan(buildTruckPlans('disrupted', decisions, 'fast'), 'S-01').arrival!)).toBe('11:15')
  })
})

describe('positions on the map', () => {
  const close = (a: LonLat | null, b: LonLat) => {
    expect(a).not.toBeNull()
    expect(a![0]).toBeCloseTo(b[0], 3)
    expect(a![1]).toBeCloseTo(b[1], 3)
  }

  it('every truck starts at its route’s origin and ends at its warehouse', () => {
    for (const scenario of ['normal', 'disrupted'] as const) {
      for (const truck of buildTruckPlans(scenario)) {
        const route = getRoute(truck.route_id)!
        close(truckStateAt(truck, truck.departure - 1, segments).position, facility(route.origin))
        close(truckStateAt(truck, truck.arrival!, segments).position, facility(route.destination))
      }
    }
  })

  it('a truck never moves backwards along its route', () => {
    for (const timingCase of ['slow', 'fast'] as const) {
      for (const truck of buildTruckPlans('disrupted', {}, timingCase)) {
        let previous = -1
        for (let time = truck.departure - 5; time <= truck.arrival! + 5; time++) {
          const state = truckStateAt(truck, time, segments)
          const leg = state.segment_id ? truck.legs.findIndex((l) => l.segment_id === state.segment_id) : -1
          const progress = state.status === 'at_port' ? 0 : state.status === 'arrived' ? truck.legs.length : leg + state.fraction
          expect(progress).toBeGreaterThanOrEqual(previous)
          previous = progress
        }
      }
    }
  })

  it('no truck enters the closed segment while it is closed', () => {
    const start = at(sampleIncident.start_time)
    const reopen = at(sampleIncident.reported_reopen_time!)
    for (const timingCase of ['slow', 'fast'] as const) {
      for (const truck of buildTruckPlans('disrupted', {}, timingCase)) {
        const leg = truck.legs.find((l) => l.segment_id === sampleIncident.segment_id)
        if (!leg) continue
        const enteredBeforeClosure = leg.enter! < start
        for (let time = start; time < reopen; time += 0.5) {
          const state = truckStateAt(truck, time, segments)
          const insideClosed = state.status === 'moving' && state.segment_id === sampleIncident.segment_id
          expect(insideClosed && !enteredBeforeClosure).toBe(false)
        }
      }
    }
  })

  it('S-06 leaves after the reopening and never waits', () => {
    const truck = plan(buildTruckPlans('disrupted'), 'S-06')
    for (let time = truck.departure; time <= truck.arrival!; time++) {
      expect(truckStateAt(truck, time, segments).status).not.toBe('waiting')
    }
  })
})

describe('the clock window and counts', () => {
  it('covers every departure and arrival, on quarter hours', () => {
    for (const scenario of ['normal', 'disrupted'] as const) {
      const plans = buildTruckPlans(scenario)
      const { start, end } = simWindow(plans)
      expect(start % 15).toBe(0)
      expect(end % 15).toBe(0)
      for (const truck of plans) {
        expect(truck.departure).toBeGreaterThan(start)
        expect(truck.arrival!).toBeLessThan(end)
      }
    }
  })

  it('counts every truck exactly once at any time', () => {
    const plans = buildTruckPlans('disrupted')
    const { start, end } = simWindow(plans)
    for (let time = start; time <= end; time += 7) {
      const counts = countTrucks(plans.map((truck) => truckStateAt(truck, time, segments)))
      expect(counts.at_port + counts.moving + counts.waiting + counts.arrived).toBe(shipments.length)
    }
    const during = countTrucks(plans.map((truck) => truckStateAt(truck, at('10:45'), segments)))
    // Six trucks are held at the port for the closure, two are not due yet, S-09 is moving, S-08 has arrived.
    expect(during).toEqual({ at_port: 8, moving: 1, waiting: 0, arrived: 1 })
  })
})
