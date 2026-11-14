// The ONLY arithmetic in the response panel: subtracting a baseline value
// from an option value so the change against the normal scenario can be
// shown. No timing, cost, CO2 or risk calculation belongs here or anywhere
// else in the UI; those values come from the engine / data module as given.

/** option minus baseline; null when the option value is unknown. */
export function delta(value: number | null, baseline: number): number | null {
  if (value === null) return null
  return value - baseline
}

/**
 * option minus baseline, rounded to one decimal place so floating-point
 * noise does not show (94.2 - 70.7 gives 23.5, not 23.500000000000004).
 */
export function deltaOneDecimal(value: number | null, baseline: number): number | null {
  const d = delta(value, baseline)
  if (d === null) return null
  const rounded = Math.round(d * 10) / 10
  return Object.is(rounded, -0) ? 0 : rounded
}
