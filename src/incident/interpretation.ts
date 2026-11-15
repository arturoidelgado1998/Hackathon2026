// What the AI is allowed to say about an incident report, and the check that
// every model answer must pass before anyone sees it (A1, team plan 8.2).
//
// The model only interprets text. It does not calculate arrivals, cost, miles
// or emissions, it cannot add a segment or a route, and nothing it returns
// changes the board: the dispatcher confirms first (A2).
//
// This module is pure: no network, no UI. The server uses it on the model's
// answer, and the dashboard can use it again on what the server sends.

/** The fields of a model answer, in the order the team plan lists them. */
export const INTERPRETATION_FIELDS = [
  'segment_id',
  'disruption_type',
  'reported_duration_minutes',
  'requires_clarification',
  'clarification_question',
  'evidence',
] as const

/** `closure` is the only disruption the prototype handles; anything else is `unsupported`. */
export type DisruptionType = 'closure' | 'unsupported'

export const DISRUPTION_TYPES: readonly DisruptionType[] = ['closure', 'unsupported']

/** One incident report as the AI read it. Every value needs the dispatcher's confirmation. */
export interface IncidentInterpretation {
  /** A RoadSegment id from segments.json, or null when the report does not name one. */
  segment_id: string | null
  /** Null when the report does not describe a disruption at all. */
  disruption_type: DisruptionType | null
  /** Minutes until reopening as the report states them. Null when it gives none. Never a guess. */
  reported_duration_minutes: number | null
  /** True when the dispatcher must supply something the report does not say. */
  requires_clarification: boolean
  clarification_question: string | null
  /** An exact quote from the report that the reading rests on. */
  evidence: string
}

/** A segment the model may name. Only the id and name are ever sent to it. */
export interface AllowedSegment {
  id: string
  name: string
}

/**
 * The JSON schema given to the model. It carries the list of allowed segment
 * ids, so a model that honours the schema cannot name any other.
 */
export function interpretationSchema(segments: AllowedSegment[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...INTERPRETATION_FIELDS],
    properties: {
      segment_id: {
        type: ['string', 'null'],
        enum: [...segments.map((s) => s.id), null],
        description: 'The id of the one segment the report names, or null if it names none of them.',
      },
      disruption_type: {
        type: ['string', 'null'],
        enum: [...DISRUPTION_TYPES, null],
        description:
          'closure for a temporary road closure; unsupported for anything else (flooding, wildfire, ' +
          'congestion with no closure); null if the report describes no disruption.',
      },
      reported_duration_minutes: {
        type: ['number', 'null'],
        description: 'Minutes until reopening exactly as the report states them, or null if it states none.',
      },
      requires_clarification: { type: 'boolean' },
      clarification_question: {
        type: ['string', 'null'],
        description: 'One short question for the dispatcher when clarification is required, otherwise null.',
      },
      evidence: {
        type: 'string',
        description: 'Words copied exactly from the report that support the reading.',
      },
    },
  } as const
}

export type ValidationResult =
  | { ok: true; interpretation: IncidentInterpretation }
  | { ok: false; errors: string[] }

/** The longest closure the prototype accepts from a report: one day. */
export const MAX_REPORTED_MINUTES = 24 * 60

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Line breaks and repeated spaces are not a difference between a quote and its source. */
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Checks a model answer against the report and the allowed segments.
 * It returns the interpretation only when every rule holds; otherwise it
 * returns every problem found and no partial incident.
 */
export function validateInterpretation(
  answer: unknown,
  report: string,
  segments: AllowedSegment[],
): ValidationResult {
  if (!isRecord(answer)) return { ok: false, errors: ['The answer is not an object.'] }

  const errors: string[] = []
  const known = new Set<string>(INTERPRETATION_FIELDS)
  for (const field of INTERPRETATION_FIELDS) {
    if (!(field in answer)) errors.push(`The answer is missing "${field}".`)
  }
  for (const field of Object.keys(answer)) {
    if (!known.has(field)) errors.push(`The answer has a field that is not allowed: "${field}".`)
  }
  if (errors.length > 0) return { ok: false, errors }

  const {
    segment_id,
    disruption_type,
    reported_duration_minutes,
    requires_clarification,
    clarification_question,
    evidence,
  } = answer

  if (segment_id !== null && typeof segment_id !== 'string') {
    errors.push('"segment_id" must be a segment id or null.')
  } else if (segment_id !== null && !segments.some((s) => s.id === segment_id)) {
    errors.push(`"segment_id" names a segment that does not exist: "${segment_id}".`)
  }

  if (disruption_type !== null && !DISRUPTION_TYPES.includes(disruption_type as DisruptionType)) {
    errors.push('"disruption_type" must be "closure", "unsupported" or null.')
  }

  if (reported_duration_minutes !== null) {
    if (typeof reported_duration_minutes !== 'number' || !Number.isFinite(reported_duration_minutes)) {
      errors.push('"reported_duration_minutes" must be a number or null.')
    } else if (reported_duration_minutes <= 0 || reported_duration_minutes > MAX_REPORTED_MINUTES) {
      errors.push(`"reported_duration_minutes" must be more than 0 and at most ${MAX_REPORTED_MINUTES}.`)
    } else if (disruption_type !== 'closure') {
      errors.push('"reported_duration_minutes" is only allowed for a closure.')
    }
  }

  if (typeof requires_clarification !== 'boolean') {
    errors.push('"requires_clarification" must be true or false.')
  }

  if (clarification_question !== null && typeof clarification_question !== 'string') {
    errors.push('"clarification_question" must be text or null.')
  } else if (requires_clarification === true && !collapse(clarification_question ?? '')) {
    errors.push('"clarification_question" is needed when clarification is required.')
  }

  // A closure with no segment cannot be acted on, so it must be sent back to
  // the dispatcher. The model is never allowed to fill the gap with a guess.
  if (segment_id === null && disruption_type === 'closure' && requires_clarification !== true) {
    errors.push('A closure with no segment must set "requires_clarification" to true.')
  }

  if (typeof evidence !== 'string') {
    errors.push('"evidence" must be text.')
  } else {
    const quote = collapse(evidence)
    const claimsSomething = segment_id !== null || disruption_type !== null || reported_duration_minutes !== null
    if (!quote && claimsSomething) {
      errors.push('"evidence" is needed: quote the words in the report that support the reading.')
    } else if (quote && !collapse(report).includes(quote)) {
      errors.push('"evidence" must be an exact quote from the report.')
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    interpretation: {
      segment_id: segment_id as string | null,
      disruption_type: disruption_type as DisruptionType | null,
      reported_duration_minutes: reported_duration_minutes as number | null,
      requires_clarification: requires_clarification as boolean,
      clarification_question: (clarification_question as string | null) || null,
      evidence: collapse(evidence as string),
    },
  }
}
