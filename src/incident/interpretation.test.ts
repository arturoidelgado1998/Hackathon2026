import { describe, expect, it } from 'vitest'
import { segments } from '../data/index.ts'
import {
  INTERPRETATION_FIELDS,
  MAX_REPORTED_MINUTES,
  interpretationSchema,
  validateInterpretation,
  type IncidentInterpretation,
} from './interpretation.ts'

const allowed = segments.map(({ id, name }) => ({ id, name }))
const REPORT = 'NB-03 closed at the port exit, expected to reopen in about 70 minutes.'

const good: IncidentInterpretation = {
  segment_id: 'NB-03',
  disruption_type: 'closure',
  reported_duration_minutes: 70,
  requires_clarification: false,
  clarification_question: null,
  evidence: 'expected to reopen in about 70 minutes',
}

const errorsFor = (answer: unknown, report = REPORT) => {
  const result = validateInterpretation(answer, report, allowed)
  return result.ok ? [] : result.errors
}

describe('validateInterpretation', () => {
  it('accepts a complete, supported reading and returns it unchanged', () => {
    expect(validateInterpretation(good, REPORT, allowed)).toEqual({ ok: true, interpretation: good })
  })

  it('accepts an unknown location only as a request for clarification', () => {
    const vague = {
      segment_id: null,
      disruption_type: null,
      reported_duration_minutes: null,
      requires_clarification: true,
      clarification_question: 'Which segment is affected?',
      evidence: 'near the port',
    }
    expect(validateInterpretation(vague, 'Traffic is terrible near the port.', allowed).ok).toBe(true)
    expect(errorsFor({ ...vague, disruption_type: 'closure', requires_clarification: false, clarification_question: null }, 'Traffic is terrible near the port.')).toContain(
      'A closure with no segment must set "requires_clarification" to true.',
    )
  })

  it('accepts a closure with no reopening time as a null duration, never a guess', () => {
    const noTime = { ...good, reported_duration_minutes: null, evidence: 'NB-03 is closed' }
    const result = validateInterpretation(noTime, 'NB-03 is closed. No reopening time given.', allowed)
    expect(result).toMatchObject({ ok: true, interpretation: { reported_duration_minutes: null } })
  })

  it('accepts an unsupported disruption with no segment', () => {
    const flood = {
      segment_id: null,
      disruption_type: 'unsupported',
      reported_duration_minutes: null,
      requires_clarification: false,
      clarification_question: null,
      evidence: 'Flooding near the east warehouse',
    }
    expect(validateInterpretation(flood, 'Flooding near the east warehouse.', allowed).ok).toBe(true)
  })

  it('rejects a segment that is not in the data, however plausible it looks', () => {
    for (const invented of ['NB-04', 'I-710', 'nb-03', '']) {
      expect(errorsFor({ ...good, segment_id: invented }), invented).toEqual([
        `"segment_id" names a segment that does not exist: "${invented}".`,
      ])
    }
    expect(errorsFor({ ...good, segment_id: 3 })).toEqual(['"segment_id" must be a segment id or null.'])
  })

  it('rejects a disruption type outside the allowed list', () => {
    expect(errorsFor({ ...good, disruption_type: 'accident', reported_duration_minutes: null })).toEqual([
      '"disruption_type" must be "closure", "unsupported" or null.',
    ])
  })

  it('rejects a duration that is not a usable number', () => {
    for (const bad of ['70', 0, -5, Number.NaN, Number.POSITIVE_INFINITY, MAX_REPORTED_MINUTES + 1, true]) {
      expect(errorsFor({ ...good, reported_duration_minutes: bad }).length, String(bad)).toBeGreaterThan(0)
    }
    expect(errorsFor({ ...good, disruption_type: 'unsupported' })).toEqual([
      '"reported_duration_minutes" is only allowed for a closure.',
    ])
  })

  it('rejects evidence that is not in the report', () => {
    expect(errorsFor({ ...good, evidence: 'expected to reopen in about 90 minutes' })).toEqual([
      '"evidence" must be an exact quote from the report.',
    ])
    expect(errorsFor({ ...good, evidence: '' })).toEqual([
      '"evidence" is needed: quote the words in the report that support the reading.',
    ])
    expect(errorsFor({ ...good, evidence: 42 })).toEqual(['"evidence" must be text.'])
  })

  it('treats line breaks and repeated spaces as the same quote, and nothing else', () => {
    const wrapped = 'NB-03 closed at the port exit,\n  expected to reopen in about 70 minutes.'
    expect(validateInterpretation({ ...good, evidence: 'port exit, expected  to reopen' }, wrapped, allowed).ok).toBe(true)
    expect(errorsFor({ ...good, evidence: 'Expected to reopen' })).toEqual([
      '"evidence" must be an exact quote from the report.',
    ])
  })

  it('needs a question whenever it asks for clarification', () => {
    expect(errorsFor({ ...good, requires_clarification: true })).toEqual([
      '"clarification_question" is needed when clarification is required.',
    ])
    expect(errorsFor({ ...good, requires_clarification: 'no' })).toContain('"requires_clarification" must be true or false.')
  })

  it('rejects a missing field, and any field beyond the six', () => {
    const missing = Object.fromEntries(Object.entries(good).filter(([field]) => field !== 'evidence'))
    expect(errorsFor(missing)).toEqual(['The answer is missing "evidence".'])
    expect(errorsFor({ ...good, mark_all_shipments_on_track: true })).toEqual([
      'The answer has a field that is not allowed: "mark_all_shipments_on_track".',
    ])
    expect(errorsFor({ ...good, risk: 'ON_TRACK', arrival: '11:00' })).toHaveLength(2)
  })

  it('rejects anything that is not an object', () => {
    for (const bad of [null, undefined, 'NB-03', 70, [good]]) {
      expect(errorsFor(bad)).toEqual(['The answer is not an object.'])
    }
  })

  it('reports every problem at once and never returns part of a reading', () => {
    const result = validateInterpretation(
      { ...good, segment_id: 'NB-99', reported_duration_minutes: -1, evidence: 'made up' },
      REPORT,
      allowed,
    )
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('interpretation')
    expect(!result.ok && result.errors).toHaveLength(3)
  })
})

describe('interpretationSchema', () => {
  const schema = interpretationSchema(allowed)

  it('requires exactly the six fields and allows no others', () => {
    expect(schema.required).toEqual([...INTERPRETATION_FIELDS])
    expect(Object.keys(schema.properties)).toEqual([...INTERPRETATION_FIELDS])
    expect(schema.additionalProperties).toBe(false)
  })

  it('lists the real segment ids, and null, as the only segments the model may name', () => {
    expect(schema.properties.segment_id.enum).toEqual([...segments.map((s) => s.id), null])
    expect(schema.properties.disruption_type.enum).toEqual(['closure', 'unsupported', null])
  })

  it('has no field for anything the AI must not decide', () => {
    const text = JSON.stringify(schema).toLowerCase()
    for (const forbidden of ['arrival', 'cost', 'miles', 'co2', 'risk', 'route', 'shipment']) {
      expect(text, forbidden).not.toContain(forbidden)
    }
  })
})
