// An AI suggestion for one shipment: which response the model would pick, and
// the checks that keep that suggestion honest.
//
// The dispatcher decides. A suggestion is requested, never shown unasked; it is
// never pre-selected; and it changes nothing on the board, the map or the totals.
//
// Three things are guaranteed by code, not by the model:
//   1. Every figure shown comes from the dashboard's own data. The model
//      returns no numbers: it names measures, and the dashboard prints them.
//   2. A reason is only accepted if it is true in the data: the suggested
//      option really is better on that measure.
//   3. What the suggestion gives up is worked out here, in full, from the
//      data. The model cannot leave a downside out.
//
// This module is pure: no network, no UI. The server and the dashboard both
// use it, so both apply the same checks.

import type { ResponseOptionKind, RiskLabel } from '../types.ts'

/** What the dashboard already shows for one response option. Nothing here is new. */
export interface OptionFacts {
  kind: ResponseOptionKind
  /** False when the option cannot be chosen, such as a reroute that uses the closed segment. */
  available: boolean
  arrival_min: string | null
  arrival_max: string | null
  lateness_min: number | null
  lateness_max: number | null
  risk: RiskLabel
  miles: number | null
  cost: number | null
  co2_kg: number | null
  driver_duty_min: number | null
  /** Real schools within 150 m of the option's illustrative route. */
  schools_150m: number | null
  /** Real disadvantaged community tracts within 150 m of the option's illustrative route. */
  dac_tracts: number | null
  status: string
}

/** Everything the model is given about one shipment. All of it is SIMULATED or estimated. */
export interface ShipmentFacts {
  shipment_id: string
  appt_start: string
  appt_end: string
  options: OptionFacts[]
}

/** The measures an option can be compared on. For every one, less (or earlier) is better. */
export const MEASURES = [
  'appointment',
  'risk',
  'arrival',
  'cost',
  'driver_duty',
  'schools',
  'tracts',
  'miles',
  'co2',
] as const

export type Measure = (typeof MEASURES)[number]

export const MEASURE_LABELS: Record<Measure, string> = {
  appointment: 'Appointment',
  risk: 'Risk',
  arrival: 'Est. arrival',
  cost: 'Est. cost',
  driver_duty: 'Driver duty',
  schools: 'Schools within 150 m',
  tracts: 'Disadvantaged tracts within 150 m',
  miles: 'Miles',
  co2: 'Est. tailpipe CO2',
}

const RISK_ORDER: Partial<Record<RiskLabel, number>> = { ON_TRACK: 0, TIGHT: 1, LATE: 2 }

/** A comparable value for a measure, or null when the option has none. Smaller is better. */
export function measureValue(option: OptionFacts, measure: Measure): number | string | null {
  switch (measure) {
    case 'appointment':
      // Lateness in the worst case first, then the best case.
      return option.lateness_max === null || option.lateness_min === null
        ? null
        : option.lateness_max * 10_000 + option.lateness_min
    case 'risk':
      return RISK_ORDER[option.risk] ?? null
    case 'arrival':
      return option.arrival_max
    case 'cost':
      return option.cost
    case 'driver_duty':
      return option.driver_duty_min
    case 'schools':
      return option.schools_150m
    case 'tracts':
      return option.dac_tracts
    case 'miles':
      return option.miles
    case 'co2':
      return option.co2_kg
  }
}

/** -1 when `a` is better on the measure, 1 when worse, 0 when equal, null when they cannot be compared. */
export function compare(a: OptionFacts, b: OptionFacts, measure: Measure): -1 | 0 | 1 | null {
  const x = measureValue(a, measure)
  const y = measureValue(b, measure)
  if (x === null || y === null) return null
  return x < y ? -1 : x > y ? 1 : 0
}

/** Options that can be chosen and have figures to compare: Wait and Reroute, when available. */
export function comparableOptions(facts: ShipmentFacts): OptionFacts[] {
  return facts.options.filter((o) => o.available && o.kind !== 'request_slot' && o.arrival_max !== null)
}

/** One measure on which the suggested option differs from another option. */
export interface Difference {
  measure: Measure
  /** The option the suggested one is compared with. */
  against: ResponseOptionKind
}

function differences(kind: ResponseOptionKind, facts: ShipmentFacts, wanted: -1 | 1): Difference[] {
  const suggested = facts.options.find((o) => o.kind === kind)
  if (!suggested) return []
  const found: Difference[] = []
  for (const measure of MEASURES) {
    for (const other of comparableOptions(facts)) {
      if (other.kind !== kind && compare(suggested, other, measure) === wanted) {
        found.push({ measure, against: other.kind })
      }
    }
  }
  return found
}

/** Every measure on which the option is better than another comparable option. */
export const advantagesOf = (kind: ResponseOptionKind, facts: ShipmentFacts) => differences(kind, facts, -1)

/** Every measure on which the option is worse than another comparable option. Never shortened. */
export const givesUp = (kind: ResponseOptionKind, facts: ShipmentFacts) => differences(kind, facts, 1)

/** What the model was asked to weigh. Shown to the dispatcher word for word. */
export const WEIGHING = [
  'Meeting the appointment window matters most to the dispatcher.',
  'Passing more schools or disadvantaged communities is a cost to people who have no say in the decision. Weigh it; do not ignore it.',
  'Driver duty time, cost, miles and emissions come after those.',
  'When the options trade these against each other closely, or you are unsure, make no suggestion.',
] as const

/** A pending slot request never counts as solved, so this is always what it gives up. */
export const SLOT_GIVES_UP =
  'The warehouse has not confirmed a later slot. Until it does, the original deadline still applies and nothing is solved.'

/** The length the model is asked to keep to, and the longer limit at which its sentence is refused. */
export const NOTE_TARGET_CHARS = 200
export const MAX_NOTE_CHARS = 240
export const MAX_REASONS = 3

export const SUGGESTION_FIELDS = ['suggested_option', 'because', 'note'] as const

const IDENTIFIER = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g

/**
 * True when the model's sentence states a figure. Names the facts already use,
 * such as the shipment id or a segment id like NB-03, contain digits but are
 * not figures, and nor is the "2" in CO2, so those are set aside first.
 */
export function noteHasFigures(note: string, facts: ShipmentFacts): boolean {
  const names = new Set([facts.shipment_id, ...facts.options.flatMap((o) => o.status.match(IDENTIFIER) ?? [])])
  const words = note.replace(IDENTIFIER, (token) => (names.has(token) ? '' : token)).replace(/\bCO2\b/gi, '')
  return /\d/.test(words)
}

/** The JSON schema given to the model. It can name an option and measures, and write one sentence. */
export function suggestionSchema(facts: ShipmentFacts) {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...SUGGESTION_FIELDS],
    properties: {
      suggested_option: {
        type: ['string', 'null'],
        enum: [...facts.options.filter((o) => o.available).map((o) => o.kind), null],
        description: 'The one option you suggest, or null to make no suggestion.',
      },
      because: {
        type: 'array',
        items: { type: 'string', enum: [...MEASURES] },
        description:
          `Up to ${MAX_REASONS} measures on which the suggested option is better than the other option. ` +
          'Empty when you suggest nothing or suggest request_slot.',
      },
      note: {
        type: 'string',
        description: `One plain sentence to the dispatcher, at most ${NOTE_TARGET_CHARS} characters. No numbers or times: the dashboard prints the figures.`,
      },
    },
  } as const
}

/** A suggestion that passed every check, with what it gives up worked out from the data. */
export interface CheckedSuggestion {
  suggested_option: ResponseOptionKind | null
  /** Reasons the model gave, each confirmed true in the data. */
  because: Difference[]
  /** Every measure on which the suggestion is worse. Computed here, not by the model. */
  gives_up: Difference[]
  /** True for a slot request: it is pending and solves nothing until confirmed. */
  pending: boolean
  /** The model's own sentence. Contains no figures. */
  note: string
}

export type SuggestionResult = { ok: true; suggestion: CheckedSuggestion } | { ok: false; errors: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Checks a model answer against the facts it was given. It returns the
 * suggestion only when every rule holds; otherwise every problem found, and no
 * partial suggestion.
 */
export function validateSuggestion(answer: unknown, facts: ShipmentFacts): SuggestionResult {
  if (!isRecord(answer)) return { ok: false, errors: ['The answer is not an object.'] }

  const errors: string[] = []
  const known = new Set<string>(SUGGESTION_FIELDS)
  for (const field of SUGGESTION_FIELDS) {
    if (!(field in answer)) errors.push(`The answer is missing "${field}".`)
  }
  for (const field of Object.keys(answer)) {
    if (!known.has(field)) errors.push(`The answer has a field that is not allowed: "${field}".`)
  }
  if (errors.length > 0) return { ok: false, errors }

  const { suggested_option: option, because, note } = answer
  const chosen = option === null ? undefined : facts.options.find((o) => o.kind === option)

  if (option !== null && !chosen) {
    errors.push('"suggested_option" must be one of this shipment\'s options, or null.')
  } else if (chosen && !chosen.available) {
    errors.push(`"suggested_option" is not available for this shipment: ${chosen.status}`)
  } else if (chosen?.kind === 'request_slot' && comparableOptions(facts).some((o) => o.risk === 'ON_TRACK')) {
    // A pending request is no answer when a confirmed option already meets the window.
    errors.push('A slot request cannot be suggested while another option is on track.')
  }

  if (typeof note !== 'string' || note.trim() === '') {
    errors.push('"note" must be one sentence of text.')
  } else {
    if (note.trim().length > MAX_NOTE_CHARS) errors.push(`"note" is longer than ${MAX_NOTE_CHARS} characters.`)
    // The dashboard prints every figure from its own data, so the model's sentence carries none.
    if (noteHasFigures(note, facts)) errors.push('"note" must not contain numbers or times.')
    // Nothing in the comparison is ranked or called the best; the suggestion keeps to that wording.
    if (/\b(best|recommend\w*|optimal)\b/i.test(note)) errors.push('"note" must not call an option best or recommended.')
  }

  const real = chosen && chosen.available && chosen.kind !== 'request_slot' ? advantagesOf(chosen.kind, facts) : []
  const accepted: Difference[] = []
  if (!Array.isArray(because)) {
    errors.push('"because" must be a list of measures.')
  } else {
    if (because.length > MAX_REASONS) errors.push(`"because" has more than ${MAX_REASONS} measures.`)
    if (new Set(because).size !== because.length) errors.push('"because" repeats a measure.')
    for (const measure of because) {
      if (!MEASURES.includes(measure as Measure)) {
        errors.push(`"because" names something that is not a measure: ${JSON.stringify(measure)}.`)
      } else if (!chosen || chosen.kind === 'request_slot') {
        errors.push(`"because" must be empty when no comparable option is suggested, but names "${measure}".`)
      } else {
        const proof = real.filter((d) => d.measure === measure)
        if (proof.length === 0) errors.push(`"because" claims "${measure}", but the suggested option is not better on it.`)
        accepted.push(...proof)
      }
    }
    // A suggestion must rest on something true whenever there is something to rest on.
    if (chosen && chosen.kind !== 'request_slot' && real.length > 0 && because.length === 0) {
      errors.push('"because" is empty, but a suggestion needs at least one reason from the data.')
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  const kind = chosen?.kind ?? null
  return {
    ok: true,
    suggestion: {
      suggested_option: kind,
      because: accepted,
      gives_up: kind && kind !== 'request_slot' ? givesUp(kind, facts) : [],
      pending: kind === 'request_slot',
      note: (note as string).trim(),
    },
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const KINDS: ResponseOptionKind[] = ['wait', 'reroute', 'request_slot']
const RISKS: RiskLabel[] = ['ON_TRACK', 'TIGHT', 'LATE', 'UNKNOWN']
const OPTION_KEYS = [
  'kind', 'available', 'arrival_min', 'arrival_max', 'lateness_min', 'lateness_max', 'risk', 'miles',
  'cost', 'co2_kg', 'driver_duty_min', 'schools_150m', 'dac_tracts', 'status',
]

/**
 * Checks that what the browser sent really is a set of option facts and
 * nothing else, so the server never forwards arbitrary text to the model.
 */
export function parseShipmentFacts(input: unknown): { ok: true; facts: ShipmentFacts } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error })
  if (!isRecord(input)) return bad('Send the shipment facts as an object in "facts".')
  if (Object.keys(input).sort().join() !== 'appt_end,appt_start,options,shipment_id') return bad('The facts have the wrong fields.')
  const { shipment_id, appt_start, appt_end, options } = input
  if (typeof shipment_id !== 'string' || !/^[A-Z0-9-]{1,12}$/.test(shipment_id)) return bad('"shipment_id" is not a shipment id.')
  if (typeof appt_start !== 'string' || !TIME.test(appt_start) || typeof appt_end !== 'string' || !TIME.test(appt_end)) {
    return bad('The appointment times must be HH:MM.')
  }
  if (!Array.isArray(options) || options.length === 0 || options.length > KINDS.length) return bad('"options" must list the response options.')

  const numberOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)
  const timeOrNull = (v: unknown) => v === null || (typeof v === 'string' && TIME.test(v))
  const seen = new Set<string>()
  for (const option of options) {
    if (!isRecord(option) || Object.keys(option).sort().join() !== [...OPTION_KEYS].sort().join()) {
      return bad('An option has the wrong fields.')
    }
    if (!KINDS.includes(option.kind as ResponseOptionKind) || seen.has(option.kind as string)) return bad('An option has an unknown or repeated kind.')
    seen.add(option.kind as string)
    if (typeof option.available !== 'boolean' || !RISKS.includes(option.risk as RiskLabel)) return bad('An option has an invalid availability or risk.')
    if (!timeOrNull(option.arrival_min) || !timeOrNull(option.arrival_max)) return bad('An option has an invalid arrival time.')
    for (const field of ['lateness_min', 'lateness_max', 'miles', 'cost', 'co2_kg', 'driver_duty_min', 'schools_150m', 'dac_tracts']) {
      if (!numberOrNull(option[field])) return bad(`An option has an invalid "${field}".`)
    }
    if (typeof option.status !== 'string' || option.status.length > 200) return bad('An option has an invalid status.')
  }
  return { ok: true, facts: input as unknown as ShipmentFacts }
}
