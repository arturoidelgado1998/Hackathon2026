// Do the generated data files still agree with each other, and do the scripts
// that build them still work?
//
// src/data is written by three Python scripts and read by the whole app. The
// slips these checks catch: one script rerun without the other, a JSON file
// edited by hand, a segment added to the feature service but not to a script's
// table, a place counted for a route but missing from the map's layers, and a
// real layer that lost its label, source or date.
//
// Nothing here uses the network. The scripts are imported and their pure
// functions run; their downloads are never called.

import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { ROOT, readJson, readText, trackedFiles } from './helpers.ts'

/** Runs a Python snippet from the repository root and returns the JSON it prints. */
function python<T>(code: string): T {
  const preamble = 'import copy, json, math, pathlib, sys\nsys.path.insert(0, "scripts")\n'
  const out = execFileSync('python3', ['-c', preamble + code], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' })
  return JSON.parse(out) as T
}

interface Listed<T> {
  label: string
  items: T[]
}
interface Segment {
  id: string
  near_sensitive_zone: boolean
}
interface Route {
  id: string
  segment_ids: string[]
  schools_150m: number | null
  dac_tracts: string[] | null
  max_diesel_pm_pctl: number | null
  near_sensitive_zone: boolean
  truck_suitability_note: string
}
interface Counted {
  schools_150m: number
  schools: string[]
  dac_tracts: string[]
  max_diesel_pm_pctl: number | null
  near_sensitive_zone: boolean
  note: string
}
interface Corridor {
  label: string
  buffer_m: number
  meaning: string
  basis: string
  sources: { id: string; name: string; publisher: string; edition: string; url: string; retrieved: string }[]
  routes: Record<string, Counted>
  segments: Record<string, { schools: string[]; dac_tracts: string[]; near_sensitive_zone: boolean }>
}
interface Layers {
  label: string
  schools: { id: string; name: string; lon: number; lat: number }[]
  tracts: { id: string; diesel_pm_percentile: number | null; geometry: { type: string; coordinates: number[][][][] } }[]
}
interface RealFile<T> {
  label: string
  source: string
  retrieved: string
  note: string
  items: T[]
}

const segments = readJson<Listed<Segment>>('src', 'data', 'segments.json')
const routes = readJson<Listed<Route>>('src', 'data', 'routes.json')
const corridor = readJson<Corridor>('src', 'data', 'corridor.json')
const layers = readJson<Layers>('src', 'data', 'corridor-layers.json')
const closures = readJson<RealFile<{ id: string; segment_id: string; facility: string }>>(
  'src', 'data', 'real', 'lane-closures.json',
)
const trucks = readJson<RealFile<{ segment_id: string; note: string; share_with_record: number }>>(
  'src', 'data', 'real', 'truck-network.json',
)

const segmentIds = segments.items.map((s) => s.id).sort()
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/
const sorted = (values: Iterable<string>) => [...values].sort()

describe('data scripts', () => {
  it('measure distance correctly: the projection and the 150 m tests', () => {
    const result = python<{
      origin: [number, number]
      north_m: number
      east_m: number
      beside_line: number
      past_the_end: number
      polygon_near: number
      polygon_crossed: number
      line_inside_polygon: number
      polygon_far_is_outside: boolean
      buffer_m: number
    }>(`
import corridor_analysis as c
a, north, east = c.albers(-118.2, 34.0), c.albers(-118.2, 34.01), c.albers(-118.19, 34.0)
line = [(0, 0), (1000, 0)]
def square(x, y, size):
    return [[(x, y), (x + size, y), (x + size, y + size), (x, y + size), (x, y)]], (x, y, x + size, y + size)
print(json.dumps({
    "origin": c.albers(-120.0, 0.0),
    "north_m": math.hypot(north[0] - a[0], north[1] - a[1]),
    "east_m": math.hypot(east[0] - a[0], east[1] - a[1]),
    "beside_line": c.point_to_line((500, 100), line),
    "past_the_end": c.point_to_line((1300, 400), line),
    "polygon_near": c.line_to_polygon(line, *square(200, 120, 100)),
    "polygon_crossed": c.line_to_polygon(line, *square(400, -50, 100)),
    "line_inside_polygon": c.line_to_polygon([(10, 10), (20, 20)], *square(0, 0, 100)),
    "polygon_far_is_outside": c.line_to_polygon(line, *square(200, 400, 100)) > c.BUFFER_M,
    "buffer_m": c.BUFFER_M,
}))`)
    // California Albers (EPSG:3310) puts 120 W on the equator at x 0, y -4,000,000.
    expect(result.origin[0]).toBeCloseTo(0, 3)
    expect(result.origin[1]).toBeCloseTo(-4_000_000, 3)
    // One hundredth of a degree near Los Angeles, in metres.
    expect(result.north_m).toBeGreaterThan(1105)
    expect(result.north_m).toBeLessThan(1113)
    expect(result.east_m).toBeGreaterThan(918)
    expect(result.east_m).toBeLessThan(928)
    expect(result.beside_line).toBeCloseTo(100, 6)
    expect(result.past_the_end).toBeCloseTo(500, 6)
    expect(result.polygon_near).toBeCloseTo(120, 6)
    expect(result.polygon_crossed).toBe(0)
    expect(result.line_inside_polygon).toBe(0)
    expect(result.polygon_far_is_outside).toBe(true)
    expect(result.buffer_m).toBe(corridor.buffer_m)
  })

  it('know every segment: no script table has fallen behind the data', () => {
    const result = python<{ problem: string | null; highways: string[] }>(`
import import_reference_data as r
try:
    r.load_segments()
    problem = None
except SystemExit as error:
    problem = str(error)
print(json.dumps({"problem": problem, "highways": sorted(r.SEGMENT_HIGHWAYS)}))`)
    expect(result.problem).toBeNull()
    expect(result.highways).toEqual(segmentIds)
  })

  it('are each explained in the data README', () => {
    const readme = readText('src', 'data', 'README.md')
    const scripts = trackedFiles().filter((f) => /^scripts\/.+\.py$/.test(f))
    expect(scripts.length).toBeGreaterThanOrEqual(3)
    expect(scripts.filter((script) => !readme.includes(script))).toEqual([])
  })
})

describe('generated files agree with each other', () => {
  it('has a corridor analysis that matches the segment lines it was run on', () => {
    const result = python<{ stored: string; now: string }>(`
import import_map_data as m
data = pathlib.Path("src/data")
segments = json.loads((data / "segments.json").read_text())["items"]
corridor = json.loads((data / "corridor.json").read_text())
print(json.dumps({"stored": corridor["geometry_fingerprint"], "now": m.fingerprint(segments)}))`)
    // If this fails, a segment line changed: run python3 scripts/corridor_analysis.py
    expect(result.stored).toBe(result.now)
  })

  it('has routes, segments and sample responses that already carry the corridor counts', () => {
    const result = python<{ changed: string[] }>(`
import import_map_data as m
data = pathlib.Path("src/data")
names = ["segments.json", "routes.json", "shipments.json", "sample-responses.json"]
files = {name: json.loads((data / name).read_text()) for name in names}
before = copy.deepcopy(files)
m.apply_corridor(files, json.loads((data / "corridor.json").read_text()))
print(json.dumps({"changed": [name for name in names if files[name] != before[name]]}))`)
    // Copying the stored analysis in again must change nothing. If it does, a
    // file was edited by hand or one script was rerun without the other.
    expect(result.changed).toEqual([])
  })

  it('counts every route and segment, each place once per route', () => {
    expect(sorted(Object.keys(corridor.segments))).toEqual(segmentIds)
    expect(sorted(Object.keys(corridor.routes))).toEqual(routes.items.map((r) => r.id).sort())
    for (const route of routes.items) {
      const counted = corridor.routes[route.id]
      const schools = new Set(route.segment_ids.flatMap((id) => corridor.segments[id].schools))
      const tracts = new Set(route.segment_ids.flatMap((id) => corridor.segments[id].dac_tracts))
      expect(counted.schools, route.id).toEqual(sorted(schools))
      expect(counted.dac_tracts, route.id).toEqual(sorted(tracts))
      expect(counted.schools_150m, route.id).toBe(schools.size)
      // What the dashboard reads from the route is the same count.
      expect(route.schools_150m, route.id).toBe(counted.schools_150m)
      expect(route.dac_tracts, route.id).toEqual(counted.dac_tracts)
      expect(route.max_diesel_pm_pctl, route.id).toBe(counted.max_diesel_pm_pctl)
      expect(route.near_sensitive_zone, route.id).toBe(schools.size > 0 || tracts.size > 0)
    }
  })

  it('gives the map exactly the places that were counted, no more and no fewer', () => {
    const countedSchools = new Set(Object.values(corridor.routes).flatMap((r) => r.schools))
    const countedTracts = new Set(Object.values(corridor.routes).flatMap((r) => r.dac_tracts))
    expect(layers.schools.map((s) => s.id).sort()).toEqual(sorted(countedSchools))
    expect(layers.tracts.map((t) => t.id).sort()).toEqual(sorted(countedTracts))
    for (const school of layers.schools) {
      expect(school.name, school.id).toBeTruthy()
      expect(school.lat > 33.5 && school.lat < 34.5 && school.lon > -118.6 && school.lon < -117, school.id).toBe(true)
    }
    for (const tract of layers.tracts) {
      expect(tract.geometry.type, tract.id).toBe('MultiPolygon')
      // Every outline is a closed ring with an area.
      for (const ring of tract.geometry.coordinates.flat()) {
        expect(ring.length, tract.id).toBeGreaterThanOrEqual(4)
        expect(ring[0], tract.id).toEqual(ring[ring.length - 1])
      }
    }
    // The highest diesel percentile on a route comes from the tracts it passes.
    const percentile = new Map(layers.tracts.map((t) => [t.id, t.diesel_pm_percentile]))
    for (const [routeId, counted] of Object.entries(corridor.routes)) {
      const values = counted.dac_tracts.map((id) => percentile.get(id)).filter((v) => typeof v === 'number')
      expect(counted.max_diesel_pm_pctl, routeId).toBe(values.length ? Math.max(...values) : null)
    }
  })

  it('matches the real Caltrans records to segments that exist', () => {
    expect(trucks.items.map((t) => t.segment_id).sort()).toEqual(segmentIds)
    expect(closures.items.filter((c) => !segmentIds.includes(c.segment_id)).map((c) => c.id)).toEqual([])
    expect(new Set(closures.items.map((c) => c.id)).size).toBe(closures.items.length)
  })
})

describe('real and simulated data stay told apart', () => {
  it('keeps every simulated file labelled SIMULATED', () => {
    for (const name of ['facilities', 'segments', 'routes', 'shipments', 'assumptions', 'sample-responses']) {
      expect(readJson<{ label: string }>('src', 'data', `${name}.json`).label, name).toBe('SIMULATED')
    }
  })

  it('labels the corridor analysis as real places beside illustrative routes, with its limits', () => {
    expect(corridor.label).toBe('REAL locations, ILLUSTRATIVE routes')
    expect(layers.label).toBe('REAL')
    expect(corridor.buffer_m).toBe(150)
    expect(corridor.meaning).toMatch(/not measured exposure/)
    expect(corridor.basis).toMatch(/Kozawa, Fruin and Winer \(2009\)/)
    for (const counted of Object.values(corridor.routes)) {
      expect(counted.note).toMatch(/within 150 m \(real locations, illustrative route\)$/)
    }
  })

  it('names the publisher, edition, address and download date of every real layer', () => {
    expect(corridor.sources.map((s) => s.id).sort()).toEqual(['dac_tracts', 'schools'])
    for (const source of corridor.sources) {
      expect(source.name, source.id).toBeTruthy()
      expect(source.publisher, source.id).toBeTruthy()
      expect(source.edition, source.id).toMatch(/\d{4}/)
      expect(source.url, source.id).toMatch(/^https:\/\//)
      expect(source.retrieved, source.id).toMatch(ISO_DATE)
    }
    for (const [name, file] of [['lane closures', closures], ['truck network', trucks]] as const) {
      expect(file.label, name).toBe('REAL')
      expect(file.source, name).toMatch(/^https:\/\/.*dot\.ca\.gov\//)
      expect(file.retrieved, name).toMatch(ISO_DATE)
      expect(file.note, name).toMatch(/Reference only/)
    }
  })

  it('never says a route is legal, safe or suitable for trucks', () => {
    const claim = /\b(legal|allowed|permitted|suitable|safe)\b/i
    expect(trucks.note).toMatch(/not a check that a truck may use them/)
    // "California Legal" is the name of a Caltrans designation, not a verdict on a route.
    const verdicts = trucks.items.filter((t) => claim.test(t.note.replaceAll('California Legal', '')))
    expect(verdicts.map((t) => t.segment_id)).toEqual([])
    for (const route of routes.items) expect(route.truck_suitability_note, route.id).toMatch(/not verified/i)
    // Ramp closures are left out on purpose: the routes do not name their ramps.
    expect(closures.items.filter((c) => /ramp/i.test(c.facility)).map((c) => c.id)).toEqual([])
  })
})
