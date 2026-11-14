// The real places the corridor analysis counted, for drawing on the map.
// Kept out of src/data/index.ts so the dashboard does not load every tract
// outline just to show the counts: only the map imports this module.
// Written by scripts/corridor_analysis.py; sources and dates are in corridor.json.

import layersJson from './corridor-layers.json'

/** A public school (NCES). A real location. */
export interface CorridorSchool {
  id: string
  name: string
  city: string
  lon: number
  lat: number
}

/** An SB 535 disadvantaged community tract (OEHHA). A real area. */
export interface CorridorTract {
  id: string
  population: number | null
  /** CalEnviroScreen 4.0 overall percentile. */
  ces_percentile: number | null
  /** CalEnviroScreen 4.0 diesel particulate percentile. */
  diesel_pm_percentile: number | null
  /** GeoJSON MultiPolygon, [longitude, latitude]. */
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] }
}

const layers = layersJson as unknown as { schools: CorridorSchool[]; tracts: CorridorTract[] }

export const corridorSchools: CorridorSchool[] = layers.schools
export const corridorTracts: CorridorTract[] = layers.tracts
