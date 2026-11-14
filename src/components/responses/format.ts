// Display formatting for the response panel. Text only: no calculations.
// The single subtraction against the baseline lives in deltas.ts.

import type { ResponseOption, ResponseOptionKind, RiskLabel } from '../../types'

export const NA = 'n/a'

export const OPTION_TITLES: Record<ResponseOptionKind, string> = {
  wait: 'Wait',
  reroute: 'Reroute',
  request_slot: 'Request later slot',
}

export const PENDING_SLOT_TEXT = 'Pending confirmation; original deadline still applies'
export const PENDING_STRIP_TEXT = 'n/a until a new slot is confirmed'
export const NOT_MODELED_TEXT = 'noise, local air quality, driver pay/hours rules'

export const RISK_TEXT: Record<RiskLabel, string> = {
  ON_TRACK: 'On track',
  TIGHT: 'Tight',
  LATE: 'Late',
  UNKNOWN: 'Unknown',
}

export function formatArrival(option: ResponseOption): string {
  const { arrival_min: min, arrival_max: max } = option
  if (min === null && max === null) return NA
  if (min === null || max === null || min === max) return (min ?? max) as string
  return `${min} to ${max}`
}

export function formatAppointment(option: ResponseOption): string {
  const { lateness_min: min, lateness_max: max } = option
  if (min === null || max === null) return 'Unknown'
  if (max === 0) return 'Meets window'
  if (min > 0) return min === max ? `${min} min late` : `${min} to ${max} min late`
  if (min === 0 && max > 0) return `May be up to ${max} min late`
  return 'Unknown'
}

export function formatMiles(miles: number | null): string {
  return miles === null ? NA : `${miles} mi`
}

export function formatCost(cost: number | null): string {
  if (cost === null) return NA
  return cost.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

export function formatCo2(co2: number | null): string {
  return co2 === null ? NA : `${co2} kg`
}

function signed(d: number): string {
  return d > 0 ? `+${d}` : `${d}`
}

/** "+15 mi", "-3 mi", "no change", or "n/a". */
export function formatMilesDelta(d: number | null): string {
  if (d === null) return NA
  return d === 0 ? 'no change' : `${signed(d)} mi`
}

/** "+23.5 kg", "no change", or "n/a". */
export function formatCo2Delta(d: number | null): string {
  if (d === null) return NA
  return d === 0 ? 'no change' : `${signed(d)} kg`
}

/** "+15 min duty time vs. normal", "no change", or "n/a". */
export function formatDutyDelta(d: number | null): string {
  if (d === null) return NA
  return d === 0 ? 'no change' : `${signed(d)} min duty time vs. normal`
}

/** "+15 mi, +23.5 kg est. tailpipe CO2" or "no added miles or CO2". */
export function formatEnvironment(milesD: number | null, co2D: number | null): string {
  if (milesD === null || co2D === null) return NA
  if (milesD === 0 && co2D === 0) return 'no added miles or CO2'
  const miles = milesD === 0 ? 'no change in miles' : `${signed(milesD)} mi`
  const co2 = co2D === 0 ? 'no change in est. tailpipe CO2' : `${signed(co2D)} kg est. tailpipe CO2`
  return `${miles}, ${co2}`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Community sentence when real counts exist (after G3). */
export function formatCommunityCounts(schools: number, tracts: number | null): string {
  const schoolText = plural(schools, 'school', 'schools')
  const tail = '(real locations, illustrative route)'
  if (tracts === null) {
    return `${schoolText} within 150 m; disadvantaged tracts not available ${tail}`
  }
  return `${schoolText} and ${plural(tracts, 'disadvantaged tract', 'disadvantaged tracts')} within 150 m ${tail}`
}
