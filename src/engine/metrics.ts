import type { Assumptions, RiskLabel, RoadSegment, Route, Shipment } from '../types.ts'
import { assertDayMinute, parseTime } from './time.ts'
import type { RouteTimingResult } from './timing.ts'

/** Clock fields are whole demo-day minutes; null means unavailable, never zero. */
export type MetricsTiming = Pick<RouteTimingResult, 'departure' | 'arrival_min' | 'arrival_max'>

export interface MetricsInput {
  shipment: Pick<Shipment, 'appt_start' | 'appt_end'>
  route: Pick<Route,
    'segment_ids' | 'near_sensitive_zone' | 'schools_150m' | 'dac_tracts' | 'max_diesel_pm_pctl'>
  segments: readonly Pick<RoadSegment, 'id' | 'miles'>[]
  timing: MetricsTiming
  assumptions: Pick<Assumptions,
    'mpg' | 'nonlabor_cost_per_mile' | 'labor_rate_per_hr' | 'diesel_kgCO2_per_gal'>
  /** Normal assigned-route timing, even for a reroute. Explicit null disables comparison. */
  normal_timing: MetricsTiming | null
}

/** All modeled values, including the normal comparison and signed increase, are estimates. */
export interface MetricsResult {
  estimated: true
  departure: number
  arrival_min: number | null
  arrival_max: number | null
  service_start_min: number | null
  service_start_max: number | null
  lateness_min: number | null
  lateness_max: number | null
  risk: RiskLabel
  miles: number
  /** Rounded whole dollars, using the max-arrival duty case. */
  cost: number | null
  /** Estimated tailpipe CO2 only, rounded to one decimal kilogram. */
  co2_kg: number
  driver_duty_min: number | null
  normal_driver_duty_min: number | null
  /** Signed minutes versus normal; negative means a reduction. */
  driver_duty_increase_min: number | null
  passes_sensitive_zone: boolean
  schools_150m: number | null
  dac_tracts: string[] | null
  max_diesel_pm_pctl: number | null
}

function assertNonnegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite nonnegative number`)
  }
}

function assertPositive(value: number, field: string): void {
  assertNonnegative(value, field)
  if (value === 0) throw new RangeError(`${field} must be positive`)
}

function validateTiming(timing: MetricsTiming, field: string): void {
  assertDayMinute(timing.departure, `${field}.departure`)
  for (const bound of ['arrival_min', 'arrival_max'] as const) {
    const arrival = timing[bound]
    if (arrival === null) continue
    assertDayMinute(arrival, `${field}.${bound}`)
    if (arrival < timing.departure) {
      throw new RangeError(`${field}.${bound} must not precede departure`)
    }
  }
  if (timing.arrival_min !== null && timing.arrival_max !== null
    && timing.arrival_min > timing.arrival_max) {
    throw new RangeError(`${field}.arrival_min must not exceed arrival_max`)
  }
}

function routeMiles(route: MetricsInput['route'], segments: MetricsInput['segments']): number {
  if (!Array.isArray(route.segment_ids) || route.segment_ids.length === 0) {
    throw new RangeError('route.segment_ids must contain at least one segment id')
  }
  if (!Array.isArray(segments)) throw new TypeError('segments must be an array')
  const byId = new Map<string, Pick<RoadSegment, 'id' | 'miles'>>()
  for (const segment of segments) {
    if (byId.has(segment.id)) throw new RangeError(`Duplicate segment id: ${segment.id}`)
    byId.set(segment.id, segment)
  }
  const miles = route.segment_ids.reduce((total, id) => {
    const segment = byId.get(id)
    if (!segment) throw new RangeError(`Missing route segment: ${id}`)
    assertNonnegative(segment.miles, `${id}.miles`)
    return total + segment.miles
  }, 0)
  assertNonnegative(miles, 'route miles')
  return miles
}

/**
 * Pure per-route estimates from E1 timing; no fixture totals or inferred baseline.
 * Early arrival waits for appt_start, but duty ends at arrival (not service).
 * Closure waiting is already in E1 timing and is engine-off: it adds labor,
 * not fuel/CO2. Nonlabor mileage cost already includes fuel; never add it again.
 * No speeding or hours-of-service adjustments are modeled.
 */
export function calculateMetrics(input: MetricsInput): MetricsResult {
  const { shipment, route, segments, timing, assumptions, normal_timing: normal } = input
  const start = parseTime(shipment.appt_start, 'appt_start')
  const end = parseTime(shipment.appt_end, 'appt_end')
  if (start > end) throw new RangeError('appt_start must not exceed appt_end on the demo day')
  validateTiming(timing, 'timing')
  if (normal === undefined) throw new TypeError('normal_timing must be supplied as timing or null')
  if (normal !== null) validateTiming(normal, 'normal_timing')
  assertPositive(assumptions.mpg, 'mpg')
  assertNonnegative(assumptions.nonlabor_cost_per_mile, 'nonlabor_cost_per_mile')
  assertNonnegative(assumptions.labor_rate_per_hr, 'labor_rate_per_hr')
  assertPositive(assumptions.diesel_kgCO2_per_gal, 'diesel_kgCO2_per_gal')

  const miles = routeMiles(route, segments)
  const serviceMin = timing.arrival_min === null ? null : Math.max(timing.arrival_min, start)
  const serviceMax = timing.arrival_max === null ? null : Math.max(timing.arrival_max, start)
  const lateMin = serviceMin === null ? null : Math.max(0, serviceMin - end)
  const lateMax = serviceMax === null ? null : Math.max(0, serviceMax - end)
  // Service starting exactly at appt_end is on time, including the max-arrival case.
  const risk: RiskLabel = lateMin === null || lateMax === null
    ? 'UNKNOWN'
    : lateMax === 0 ? 'ON_TRACK' : lateMin === 0 ? 'TIGHT' : 'LATE'
  const duty = timing.arrival_max === null ? null : timing.arrival_max - timing.departure
  const normalDuty = normal === null || normal.arrival_max === null
    ? null
    : normal.arrival_max - normal.departure
  const cost = duty === null ? null
    : miles * assumptions.nonlabor_cost_per_mile + duty / 60 * assumptions.labor_rate_per_hr
  const co2 = miles / assumptions.mpg * assumptions.diesel_kgCO2_per_gal
  if (cost !== null) assertNonnegative(cost, 'calculated cost')
  assertNonnegative(co2, 'calculated co2_kg')

  return {
    estimated: true,
    departure: timing.departure,
    arrival_min: timing.arrival_min,
    arrival_max: timing.arrival_max,
    service_start_min: serviceMin,
    service_start_max: serviceMax,
    lateness_min: lateMin,
    lateness_max: lateMax,
    risk,
    miles,
    cost: cost === null ? null : Math.round(cost),
    co2_kg: Number(co2.toFixed(1)),
    driver_duty_min: duty,
    normal_driver_duty_min: normalDuty,
    driver_duty_increase_min: duty === null || normalDuty === null ? null : duty - normalDuty,
    passes_sensitive_zone: route.near_sensitive_zone,
    schools_150m: route.schools_150m,
    dac_tracts: route.dac_tracts,
    max_diesel_pm_pctl: route.max_diesel_pm_pctl,
  }
}
