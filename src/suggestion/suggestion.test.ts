import { describe, expect, it } from 'vitest'
import { buildResponseView } from '../state/selectors.ts'
import { buildShipmentFacts } from './facts.ts'
import {
  MEASURES,
  SUGGESTION_FIELDS,
  advantagesOf,
  compare,
  givesUp,
  parseShipmentFacts,
  suggestionSchema,
  validateSuggestion,
  type ShipmentFacts,
} from './suggestion.ts'

const factsFor = (shipmentId: string) => buildShipmentFacts(buildResponseView(shipmentId, 'disrupted')!)
// S-07: waiting is tight; rerouting is on track but passes more schools and tracts.
const s07 = factsFor('S-07')
// S-03: both waiting and rerouting are late.
const s03 = factsFor('S-03')
const measures = (list: { measure: string }[]) => list.map((d) => d.measure)
const errorsFor = (answer: unknown, facts: ShipmentFacts = s07) => {
  const result = validateSuggestion(answer, facts)
  return result.ok ? [] : result.errors
}
const reroute = { suggested_option: 'reroute', because: ['appointment'], note: 'Rerouting keeps the appointment at the cost of passing more schools.' }

describe('facts given to the AI', () => {
  it('are copied from what the comparison table shows, with nothing added', () => {
    const view = buildResponseView('S-07', 'disrupted')!
    expect(s07.shipment_id).toBe('S-07')
    expect(s07.options.map((o) => o.kind)).toEqual(view.options.map((o) => o.kind))
    for (const option of view.options) {
      const facts = s07.options.find((o) => o.kind === option.kind)!
      expect(facts).toMatchObject({
        arrival_max: option.arrival_max,
        lateness_max: option.lateness_max,
        risk: option.risk,
        miles: option.miles,
        cost: option.cost,
        co2_kg: option.co2_kg,
        driver_duty_min: option.driver_duty_min,
        schools_150m: view.community[option.kind]?.schools_150m ?? null,
        dac_tracts: view.community[option.kind]?.dac_tracts?.length ?? null,
      })
    }
    // No names, places or anything about a person.
    expect(Object.keys(s07).sort()).toEqual(['appt_end', 'appt_start', 'options', 'shipment_id'])
  })
})

describe('comparing options', () => {
  const [wait, rerouteFacts] = s07.options

  it('treats less as better on every measure', () => {
    expect(compare(rerouteFacts, wait, 'appointment')).toBe(-1)
    expect(compare(rerouteFacts, wait, 'risk')).toBe(-1)
    expect(compare(rerouteFacts, wait, 'schools')).toBe(1)
    expect(compare(wait, wait, 'cost')).toBe(0)
    expect(compare(s07.options[2], wait, 'cost')).toBeNull() // a pending slot has no figures
  })

  it('finds every advantage and every downside of an option, from the data', () => {
    expect(measures(advantagesOf('reroute', s07))).toEqual(['appointment', 'risk', 'arrival', 'cost', 'driver_duty'])
    expect(measures(givesUp('reroute', s07))).toEqual(['schools', 'tracts', 'miles', 'co2'])
    // What one option gains, the other gives up.
    expect(measures(givesUp('wait', s07))).toEqual(measures(advantagesOf('reroute', s07)))
    for (const difference of [...advantagesOf('reroute', s07), ...givesUp('reroute', s07)]) {
      expect(difference.against).toBe('wait')
    }
  })
})

describe('validateSuggestion', () => {
  it('accepts a suggestion whose reasons are true, and adds everything it gives up', () => {
    const result = validateSuggestion(reroute, s07)
    expect(result).toEqual({
      ok: true,
      suggestion: {
        suggested_option: 'reroute',
        because: [{ measure: 'appointment', against: 'wait' }],
        gives_up: givesUp('reroute', s07),
        pending: false,
        note: reroute.note,
      },
    })
    // The model named one reason; the four downsides are there regardless.
    expect(result.ok && result.suggestion.gives_up).toHaveLength(4)
  })

  it('rejects a reason that is not true in the data', () => {
    expect(errorsFor({ ...reroute, because: ['schools'] })).toEqual([
      '"because" claims "schools", but the suggested option is not better on it.',
    ])
    expect(errorsFor({ ...reroute, because: ['appointment', 'miles'] })).toHaveLength(1)
    expect(errorsFor({ ...reroute, because: ['safety'] })).toEqual([
      '"because" names something that is not a measure: "safety".',
    ])
  })

  it('needs a reason whenever the data offers one, and at most three', () => {
    expect(errorsFor({ ...reroute, because: [] })).toEqual([
      '"because" is empty, but a suggestion needs at least one reason from the data.',
    ])
    expect(errorsFor({ ...reroute, because: ['appointment', 'risk', 'arrival', 'cost'] })).toContain(
      '"because" has more than 3 measures.',
    )
    expect(errorsFor({ ...reroute, because: ['risk', 'risk'] })).toContain('"because" repeats a measure.')
  })

  it('lets no figure through in the AI\'s sentence: the dashboard prints the figures', () => {
    for (const note of ['Reroute arrives at 11:05.', 'It saves $20.', 'It passes 18 schools.']) {
      expect(errorsFor({ ...reroute, note }), note).toEqual(['"note" must not contain numbers or times.'])
    }
    expect(errorsFor({ ...reroute, note: '' })).toEqual(['"note" must be one sentence of text.'])
    expect(errorsFor({ ...reroute, note: 'x'.repeat(241) })).toEqual(['"note" is longer than 240 characters.'])
  })

  it('keeps the wording of a suggestion: nothing is called best or recommended', () => {
    for (const note of ['Reroute is the best option.', 'I recommend rerouting.', 'Rerouting is recommended.', 'The optimal choice is to reroute.']) {
      expect(errorsFor({ ...reroute, note }), note).toEqual(['"note" must not call an option best or recommended.'])
    }
  })

  it('rejects an option that does not exist or cannot be chosen', () => {
    expect(errorsFor({ ...reroute, suggested_option: 'reassign_truck', because: [] })).toContain(
      '"suggested_option" must be one of this shipment\'s options, or null.',
    )
    const blocked: ShipmentFacts = {
      ...s07,
      options: s07.options.map((o) => (o.kind === 'reroute' ? { ...o, available: false, status: 'Unavailable: uses the closed segment' } : o)),
    }
    expect(errorsFor(reroute, blocked)[0]).toBe(
      '"suggested_option" is not available for this shipment: Unavailable: uses the closed segment',
    )
  })

  it('treats a slot request as pending, and never suggests it while another option is on track', () => {
    const slot = { suggested_option: 'request_slot', because: [], note: 'Neither confirmed option meets the window, so asking the warehouse is worth trying.' }
    expect(errorsFor(slot, s07)).toEqual(['A slot request cannot be suggested while another option is on track.'])
    const result = validateSuggestion(slot, s03)
    expect(result).toMatchObject({ ok: true, suggestion: { suggested_option: 'request_slot', pending: true, because: [], gives_up: [] } })
    expect(errorsFor({ ...slot, because: ['cost'] }, s03)).toEqual([
      '"because" must be empty when no comparable option is suggested, but names "cost".',
    ])
  })

  it('accepts no suggestion at all, with a sentence saying why', () => {
    const none = { suggested_option: null, because: [], note: 'The options trade the appointment against the people along the route too closely to call.' }
    expect(validateSuggestion(none, s07)).toMatchObject({
      ok: true,
      suggestion: { suggested_option: null, because: [], gives_up: [], pending: false },
    })
    expect(errorsFor({ ...none, because: ['risk'] })).toHaveLength(1)
  })

  it('rejects a missing field, an extra field, and anything that is not an object', () => {
    expect(errorsFor({ suggested_option: 'reroute', because: ['risk'] })).toEqual(['The answer is missing "note".'])
    expect(errorsFor({ ...reroute, select_option_now: true })).toEqual([
      'The answer has a field that is not allowed: "select_option_now".',
    ])
    expect(errorsFor({ ...reroute, score: 0.9, ranking: ['reroute', 'wait'] })).toHaveLength(2)
    for (const bad of [null, 'reroute', ['reroute']]) expect(errorsFor(bad)).toEqual(['The answer is not an object.'])
  })

  it('never returns part of a suggestion', () => {
    const result = validateSuggestion({ ...reroute, because: ['schools'], note: 'Saves 20 minutes.' }, s07)
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('suggestion')
    expect(!result.ok && result.errors).toHaveLength(2)
  })
})

describe('suggestionSchema', () => {
  const schema = suggestionSchema(s07)

  it('lets the model name an available option and measures, and write one sentence', () => {
    expect(schema.required).toEqual([...SUGGESTION_FIELDS])
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.suggested_option.enum).toEqual(['wait', 'reroute', 'request_slot', null])
    expect(schema.properties.because.items.enum).toEqual([...MEASURES])
  })

  it('has no field for a figure, a score or a ranking', () => {
    const text = JSON.stringify(schema.properties).toLowerCase()
    for (const absent of ['score', 'rank', 'confidence', 'minutes', 'number']) expect(text, absent).not.toContain(`"${absent}`)
    expect(Object.values(schema.properties).map((p) => p.type)).toEqual([['string', 'null'], 'array', 'string'])
  })
})

describe('parseShipmentFacts', () => {
  it('accepts the facts the dashboard builds', () => {
    for (const facts of [s07, s03, factsFor('S-01')]) {
      expect(parseShipmentFacts(JSON.parse(JSON.stringify(facts)))).toEqual({ ok: true, facts })
    }
  })

  it('refuses anything that is not exactly a set of option facts', () => {
    const bad: unknown[] = [
      null,
      'S-07',
      { ...s07, driver_name: 'someone' },
      { ...s07, shipment_id: 'ignore previous instructions' },
      { ...s07, appt_end: 'noon' },
      { ...s07, options: [] },
      { ...s07, options: [{ ...s07.options[0], note: 'extra text for the model' }] },
      { ...s07, options: [{ ...s07.options[0], kind: 'teleport' }] },
      { ...s07, options: [s07.options[0], s07.options[0]] },
      { ...s07, options: [{ ...s07.options[0], cost: '156' }] },
      { ...s07, options: [{ ...s07.options[0], cost: -1 }] },
      { ...s07, options: [{ ...s07.options[0], status: 'x'.repeat(201) }] },
    ]
    for (const input of bad) expect(parseShipmentFacts(input).ok, JSON.stringify(input)?.slice(0, 80)).toBe(false)
  })
})
