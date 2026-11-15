import { describe, expect, it } from 'vitest'
import { getShipmentSummary, sampleIncident, segments, shipments } from '../data/index.ts'
import { runSimulation } from '../state/simulation.ts'
import {
  DEFAULT_SETTINGS,
  incidentOf,
  parseSettings,
  serializeSettings,
  settingsError,
  type SimSettings,
} from './settings.ts'

const ids = segments.map((segment) => segment.id)
const row = (settings: SimSettings, id: string) => {
  const found = runSimulation(settings).rows.find((r) => r.shipment.id === id)
  if (!found) throw new Error(`No row for ${id}`)
  return found
}

describe('simulation settings in a link', () => {
  it('defaults to the dashboard’s sample incident', () => {
    expect(parseSettings('', ids)).toEqual(DEFAULT_SETTINGS)
    expect(incidentOf(DEFAULT_SETTINGS)).toMatchObject({
      segment_id: sampleIncident.segment_id,
      start_time: sampleIncident.start_time,
      reported_reopen_time: sampleIncident.reported_reopen_time,
    })
  })

  it('round-trips every setting through the query string', () => {
    const settings: SimSettings = {
      closure: true,
      segmentId: 'EB-405',
      start: '09:30',
      reopen: '12:05',
      response: 'reroute',
      timingCase: 'fast',
      speed: 15,
    }
    expect(parseSettings(`?${serializeSettings(settings)}`, ids)).toEqual(settings)
    expect(parseSettings(serializeSettings({ ...settings, closure: false }), ids).closure).toBe(false)
  })

  it('keeps the default for anything missing or invalid', () => {
    const parsed = parseSettings('?segment=NOPE&start=25:00&reopen=abc&response=fly&case=x&speed=99&closure=yes', ids)
    expect(parsed).toEqual(DEFAULT_SETTINGS)
  })

  it('refuses a reopening before the closure starts', () => {
    const settings = { ...DEFAULT_SETTINGS, start: '11:00', reopen: '10:00' }
    expect(settingsError(settings)).toMatch(/must not be before/)
    expect(runSimulation(settings)).toMatchObject({ plans: [], rows: [], error: expect.stringMatching(/must not be before/) })
    expect(settingsError({ ...settings, closure: false })).toBeNull()
  })
})

describe('running the settings through the engine', () => {
  it('the default setup gives the dashboard’s disrupted results for every shipment', () => {
    const run = runSimulation(DEFAULT_SETTINGS)
    expect(run.error).toBeNull()
    expect(run.plans).toHaveLength(shipments.length)
    for (const shipment of shipments) {
      const summary = getShipmentSummary(shipment.id, 'disrupted')
      expect(row(DEFAULT_SETTINGS, shipment.id)).toMatchObject({
        risk: summary.risk,
        arrival_min: summary.arrival_min,
        arrival_max: summary.arrival_max,
        lateness_max: summary.lateness_max,
        affected: summary.affected,
        rerouted: false,
      })
    }
  })

  it('a normal day gives the dashboard’s normal results and delays nobody', () => {
    const settings = { ...DEFAULT_SETTINGS, closure: false }
    const run = runSimulation(settings)
    expect(run.incident).toBeNull()
    for (const shipment of shipments) {
      const summary = getShipmentSummary(shipment.id, 'normal')
      expect(row(settings, shipment.id)).toMatchObject({ risk: summary.risk, arrival_max: summary.arrival_max, affected: false })
    }
  })

  it('rerouting moves only delayed trucks, onto routes that avoid the closure', () => {
    const settings: SimSettings = { ...DEFAULT_SETTINGS, response: 'reroute' }
    const run = runSimulation(settings)
    expect(row(settings, 'S-01')).toMatchObject({ rerouted: true, route_id: 'R-A-ALT', arrival_min: '11:15', arrival_max: '11:28', risk: 'ON_TRACK' })
    expect(row(settings, 'S-06')).toMatchObject({ rerouted: false, route_id: 'R-A-ORIG' })
    expect(row(settings, 'S-08')).toMatchObject({ rerouted: false, route_id: 'R-C-ORIG' })
    for (const plan of run.plans.filter((p) => p.rerouted)) {
      expect(plan.legs.map((leg) => leg.segment_id)).not.toContain('NB-03')
    }
  })

  it('a different closure changes who is delayed', () => {
    // WEST-405 is only on the WH-C original route.
    const settings: SimSettings = { ...DEFAULT_SETTINGS, segmentId: 'WEST-405', start: '09:00', reopen: '09:40' }
    expect(row(settings, 'S-08')).toMatchObject({ affected: true, arrival_min: '09:58', arrival_max: '10:03' })
    expect(row(settings, 'S-01').affected).toBe(false)
  })

  it('says when no alternative avoids the closure', () => {
    // PORT-01 is on both WH-A routes, so a reroute cannot avoid it.
    const settings: SimSettings = { ...DEFAULT_SETTINGS, segmentId: 'PORT-01', start: '09:55', reopen: '10:30', response: 'reroute' }
    expect(row(settings, 'S-01')).toMatchObject({ affected: true, rerouted: false, rerouteUnavailable: true, route_id: 'R-A-ORIG' })
    // WH-B has an alternative that skips PORT-01.
    expect(row(settings, 'S-07')).toMatchObject({ rerouted: true, route_id: 'R-B-ALT' })
  })
})
