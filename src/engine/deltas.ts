/** Signed estimate difference; an unknown value stays unknown. */
export function delta(value: number | null, baseline: number): number | null {
  return value === null ? null : value - baseline
}

/** One-decimal estimate difference without floating-point noise or negative zero. */
export function deltaOneDecimal(value: number | null, baseline: number): number | null {
  const difference = delta(value, baseline)
  if (difference === null) return null
  const rounded = Math.round(difference * 10) / 10
  return Object.is(rounded, -0) ? 0 : rounded
}
