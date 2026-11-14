import { describe, expect, it } from 'vitest'
import { getSegment, segments } from '../index'
import {
  REAL_DATA_LABEL,
  getLaneClosuresForSegment,
  getTruckNetworkForSegment,
  laneClosures,
  laneClosuresMeta,
  truckNetwork,
  truckNetworkMeta,
} from './index'

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const isLocalOrNull = (v: unknown) => v === null || (typeof v === 'string' && LOCAL.test(v))

describe('real reference data files', () => {
  it('are labelled REAL with a source and a retrieval time, never SIMULATED', () => {
    for (const meta of [laneClosuresMeta, truckNetworkMeta]) {
      expect(meta.label).toBe(REAL_DATA_LABEL)
      expect(meta.source).toMatch(/^https:\/\/.*dot\.ca\.gov\//)
      expect(meta.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/)
      expect(meta.note).toMatch(/Reference only/)
      expect(meta.matching).toMatch(/approximate/)
    }
  })

  it('say plainly what they are not', () => {
    expect(laneClosuresMeta.note).toMatch(/not a live feed/)
    expect(laneClosuresMeta.note).toMatch(/not used in any calculation/)
    expect(truckNetworkMeta.note).toMatch(/not a check that a truck may use them/)
  })
})

describe('lane closures', () => {
  it('each belong to a known segment and have the expected shape', () => {
    expect(laneClosures.length).toBeGreaterThan(0)
    expect(new Set(laneClosures.map((c) => c.id)).size).toBe(laneClosures.length)
    for (const c of laneClosures) {
      expect(getSegment(c.segment_id)).toBeDefined()
      expect(c.route).toMatch(/^(I|SR|US)-\d+$/)
      expect(['planned', 'in_place', 'completed', 'cancelled']).toContain(c.status)
      for (const t of [c.planned_start, c.planned_end, c.actual_start, c.actual_end]) expect(isLocalOrNull(t)).toBe(true)
      expect(c.lat).toBeGreaterThan(33.5)
      expect(c.lat).toBeLessThan(34.5)
      expect(c.lon).toBeGreaterThan(-118.6)
      expect(c.lon).toBeLessThan(-117)
      expect(c.summary).toContain(c.route)
      // Ramp closures are left out: the illustrative routes do not name their ramps.
      expect(c.facility).not.toMatch(/Ramp/)
    }
  })

  it('only report an overrun for a completed closure with both end times', () => {
    for (const c of laneClosures) {
      if (c.ran_over_min !== null) {
        expect(c.status).toBe('completed')
        expect(c.planned_end).not.toBeNull()
        expect(c.actual_end).not.toBeNull()
      }
    }
  })

  it('are found by segment', () => {
    const total = segments.reduce((n, s) => n + getLaneClosuresForSegment(s.id).length, 0)
    expect(total).toBe(laneClosures.length)
    expect(getLaneClosuresForSegment('C-LOCAL')).toEqual([])
  })
})

describe('truck network', () => {
  it('has one entry per segment', () => {
    expect(truckNetwork.map((t) => t.segment_id).sort()).toEqual(segments.map((s) => s.id).sort())
  })

  it('reports recorded designations and gaps without judging the route', () => {
    for (const t of truckNetwork) {
      expect(t.share_with_record).toBeGreaterThanOrEqual(0)
      expect(t.share_with_record).toBeLessThanOrEqual(1)
      for (const s of t.stretches) {
        expect(t.highways.some((h) => h.startsWith(s.highway))).toBe(true)
        expect(s.share_of_segment).toBeGreaterThan(0)
        expect(s.recorded_stretches.length).toBeGreaterThan(0)
      }
      expect(t.note).not.toMatch(/legal for|suitable|safe|allowed/i)
    }
  })

  it('leaves surface streets without a record', () => {
    const local = getTruckNetworkForSegment('C-LOCAL')
    expect(local?.highways).toEqual([])
    expect(local?.stretches).toEqual([])
    expect(local?.share_with_record).toBe(0)
  })
})
