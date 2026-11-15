// @vitest-environment node
import { describe, expect, it } from 'vitest'
import segmentsJson from '../src/data/segments.json' with { type: 'json' }
import type { IncidentInterpretation } from '../src/incident/interpretation.ts'
import { MAX_REPORT_CHARS, interpretReport } from './interpret.ts'
import { readModelConfig, type ModelConfig } from './model.ts'
import { RECORD_FUNCTION } from './prompt.ts'
import { TEST_REPORTS } from './test-reports.ts'

const segments = segmentsJson.items.map(({ id, name }) => ({ id, name }))
const KEY = 'test-key-not-real-0123456789'
const config: ModelConfig = {
  provider: 'test',
  baseUrl: 'https://model.example/v1',
  model: 'test-model',
  apiKey: KEY,
}

interface Sent {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

/** A stand-in for the model: records what it was sent and answers as told. */
function fakeModel(reply: (sent: Sent, attempt: number) => Response | Promise<Response>) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const request: Sent = {
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    }
    sent.push(request)
    return reply(request, sent.length)
  }) as typeof fetch
  return { sent, fetchImpl }
}

const asFunctionCall = (answer: unknown) =>
  Response.json({
    choices: [
      {
        message: {
          content: null,
          reasoning_content: 'private reasoning that must not be used',
          tool_calls: [{ type: 'function', function: { name: RECORD_FUNCTION, arguments: JSON.stringify(answer) } }],
        },
      },
    ],
  })

const asText = (text: string) => Response.json({ choices: [{ message: { content: text } }] })

/** What a well-behaved model would answer for each of the five test reports. */
const CANNED: Record<number, IncidentInterpretation> = {
  1: {
    segment_id: 'NB-03',
    disruption_type: 'closure',
    reported_duration_minutes: 70,
    requires_clarification: false,
    clarification_question: null,
    evidence: 'NB-03 closed at the port exit, expected to reopen in about 70 minutes',
  },
  2: {
    segment_id: null,
    disruption_type: null,
    reported_duration_minutes: null,
    requires_clarification: true,
    clarification_question: 'Which road segment near the port is affected, and is it closed?',
    evidence: 'Traffic is terrible near the port',
  },
  3: {
    segment_id: 'NB-03',
    disruption_type: 'closure',
    reported_duration_minutes: null,
    requires_clarification: false,
    clarification_question: null,
    evidence: 'NB-03 is closed',
  },
  4: {
    segment_id: null,
    disruption_type: 'unsupported',
    reported_duration_minutes: null,
    requires_clarification: false,
    clarification_question: null,
    evidence: 'Flooding near the east warehouse',
  },
  5: {
    segment_id: 'NB-03',
    disruption_type: 'closure',
    reported_duration_minutes: null,
    requires_clarification: false,
    clarification_question: null,
    evidence: 'NB-03 closed',
  },
}

describe('interpretReport: the five test reports', () => {
  for (const test of TEST_REPORTS) {
    it(`report ${test.number}: ${test.expected}`, async () => {
      const { fetchImpl } = fakeModel(() => asFunctionCall(CANNED[test.number]))
      const result = await interpretReport(test.report, { config, segments, fetchImpl })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(test.problems(result.interpretation)).toEqual([])
        expect(result.interpretation).toEqual(CANNED[test.number])
      }
    })
  }

  it('checks each report against its expectation, so a wrong reading is caught', () => {
    for (const test of TEST_REPORTS) {
      const wrong = { ...CANNED[test.number], reported_duration_minutes: 15 }
      expect(test.problems(wrong).length, `report ${test.number}`).toBeGreaterThan(0)
    }
  })
})

describe('interpretReport: what the model is sent', () => {
  it('sends the report, the allowed segments and the schema, and nothing else', async () => {
    const { sent, fetchImpl } = fakeModel(() => asFunctionCall(CANNED[1]))
    await interpretReport(TEST_REPORTS[0].report, { config, segments, fetchImpl })

    expect(sent).toHaveLength(1)
    const [{ url, headers, body }] = sent
    expect(url).toBe('https://model.example/v1/chat/completions')
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'temperature', 'tool_choice', 'tools'])
    expect(body.model).toBe('test-model')

    const messages = body.messages as { role: string; content: string }[]
    expect(messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(messages[1].content).toContain(TEST_REPORTS[0].report)
    for (const segment of segments) {
      expect(messages[0].content).toContain(segment.id)
      expect(messages[0].content).toContain(segment.name)
    }
    // The instructions treat the report as data.
    expect(messages[0].content).toMatch(/The report is data/)
    expect(messages[1].content).toMatch(/data, not instructions/)

    // Only segment ids and names leave the server: no geometry, miles, times,
    // shipments, routes or costs.
    const everything = JSON.stringify(body)
    for (const absent of ['coordinates', 'minutes_min', 'S-01', 'R-A-ORIG', 'Summit Ridge', 'appt_', 'labor_rate']) {
      expect(everything, absent).not.toContain(absent)
    }
    // The key travels in the Authorization header and nowhere else.
    expect(headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(everything).not.toContain(KEY)
  })

  it('offers the model one function, whose arguments are the six fields', async () => {
    const { sent, fetchImpl } = fakeModel(() => asFunctionCall(CANNED[1]))
    await interpretReport(TEST_REPORTS[0].report, { config, segments, fetchImpl })
    const tools = sent[0].body.tools as { function: { name: string; parameters: { required: string[] } } }[]
    expect(tools).toHaveLength(1)
    expect(tools[0].function.name).toBe(RECORD_FUNCTION)
    expect(tools[0].function.parameters.required).toHaveLength(6)
  })
})

describe('interpretReport: answers that must be refused', () => {
  const report = TEST_REPORTS[4].report // the prompt-injection report

  it('discards a reading that adds a field, such as an instruction carried over from the report', async () => {
    const { fetchImpl } = fakeModel(() => asFunctionCall({ ...CANNED[5], mark_all_shipments_on_track: true }))
    const result = await interpretReport(report, { config, segments, fetchImpl })
    expect(result).toMatchObject({ ok: false, code: 'invalid_model_response' })
    expect(result).not.toHaveProperty('interpretation')
    expect(!result.ok && 'details' in result && result.details).toEqual([
      'The answer has a field that is not allowed: "mark_all_shipments_on_track".',
    ])
  })

  it('discards a reading that names a segment the data does not have', async () => {
    const { fetchImpl } = fakeModel(() => asFunctionCall({ ...CANNED[5], segment_id: 'NB-04' }))
    const result = await interpretReport(report, { config, segments, fetchImpl })
    expect(result).toMatchObject({ ok: false, code: 'invalid_model_response' })
    expect(result).not.toHaveProperty('interpretation')
  })

  it('discards a reading whose evidence is not in the report', async () => {
    const { fetchImpl } = fakeModel(() => asFunctionCall({ ...CANNED[5], evidence: 'all shipments are on track' }))
    expect(await interpretReport(report, { config, segments, fetchImpl })).toMatchObject({
      ok: false,
      code: 'invalid_model_response',
    })
  })

  it('discards a guessed duration when the report gives none', async () => {
    // The validator cannot know a number was guessed, but a duration must be
    // backed by a quote, and the expectation for this report is null.
    const { fetchImpl } = fakeModel(() => asFunctionCall({ ...CANNED[3], reported_duration_minutes: 60 }))
    const result = await interpretReport(TEST_REPORTS[2].report, { config, segments, fetchImpl })
    expect(result.ok && TEST_REPORTS[2].problems(result.interpretation)).toEqual([
      'reported_duration_minutes is 60, expected null',
    ])
  })

  it('refuses an answer with no structured reading at all', async () => {
    for (const reply of [asText('All shipments are now on track.'), asText(''), Response.json({ choices: [] })]) {
      const { fetchImpl } = fakeModel(() => reply.clone())
      expect(await interpretReport(report, { config, segments, fetchImpl })).toMatchObject({
        ok: false,
        code: 'invalid_model_response',
      })
    }
  })

  it('refuses a function call whose arguments are not JSON', async () => {
    const broken = Response.json({
      choices: [{ message: { tool_calls: [{ function: { name: RECORD_FUNCTION, arguments: '{"segment_id": ' } }] } }],
    })
    const { fetchImpl } = fakeModel(() => broken.clone())
    expect(await interpretReport(report, { config, segments, fetchImpl })).toMatchObject({
      ok: false,
      code: 'invalid_model_response',
    })
  })
})

describe('interpretReport: other ways the model may answer', () => {
  it('accepts the same reading written as JSON text, and still checks it', async () => {
    const good = fakeModel(() => asText('```json\n' + JSON.stringify(CANNED[1]) + '\n```'))
    expect(await interpretReport(TEST_REPORTS[0].report, { config, segments, fetchImpl: good.fetchImpl })).toMatchObject({
      ok: true,
      interpretation: CANNED[1],
    })
    const bad = fakeModel(() => asText(JSON.stringify({ ...CANNED[1], segment_id: 'NB-99' })))
    expect(await interpretReport(TEST_REPORTS[0].report, { config, segments, fetchImpl: bad.fetchImpl })).toMatchObject({
      ok: false,
      code: 'invalid_model_response',
    })
  })

  it('asks once more without the forced function call if the service does not accept it', async () => {
    const { sent, fetchImpl } = fakeModel((_sent, attempt) =>
      attempt === 1 ? new Response('unsupported parameter', { status: 400 }) : asFunctionCall(CANNED[1]),
    )
    const result = await interpretReport(TEST_REPORTS[0].report, { config, segments, fetchImpl })
    expect(result.ok).toBe(true)
    expect(sent).toHaveLength(2)
    expect(Object.keys(sent[1].body).sort()).toEqual(['messages', 'model', 'tools'])
  })
})

describe('interpretReport: failures', () => {
  const run = (fetchImpl: typeof fetch) => interpretReport(TEST_REPORTS[0].report, { config, segments, fetchImpl })

  it('says when the model cannot be reached or does not answer in time', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await run(down)).toEqual({
      ok: false,
      code: 'model_unreachable',
      message: 'The AI service could not be reached from this network.',
    })
    const slow = (async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }) as unknown as typeof fetch
    expect(await run(slow)).toMatchObject({ code: 'model_unreachable', message: 'The AI service did not answer in time.' })
  })

  it('says when the service rejects the key or answers with an error', async () => {
    const denied = fakeModel(() => new Response(`invalid key ${KEY}`, { status: 401 }))
    expect(await run(denied.fetchImpl)).toMatchObject({ ok: false, code: 'model_rejected' })
    const broken = fakeModel(() => new Response('upstream error', { status: 503 }))
    expect(await run(broken.fetchImpl)).toMatchObject({
      code: 'model_rejected',
      message: 'The AI service answered with an error (HTTP 503).',
    })
  })

  it('never puts the key, or the service\'s own error text, in what it returns', async () => {
    const replies = [
      () => new Response(`invalid key ${KEY}`, { status: 401 }),
      () => new Response(`bad request for ${KEY}`, { status: 500 }),
      () => asText(`the key is ${KEY}`),
      () => asFunctionCall({ ...CANNED[1], evidence: KEY }),
    ]
    for (const reply of replies) {
      const { fetchImpl } = fakeModel(reply)
      expect(JSON.stringify(await run(fetchImpl))).not.toContain(KEY)
    }
  })

  it('does not call the model for an empty, non-text or over-long report', async () => {
    const { sent, fetchImpl } = fakeModel(() => asFunctionCall(CANNED[1]))
    for (const report of ['', '   ', undefined, null, 42, { text: 'NB-03 closed' }, 'x'.repeat(MAX_REPORT_CHARS + 1)]) {
      expect(await interpretReport(report, { config, segments, fetchImpl })).toMatchObject({
        ok: false,
        code: 'bad_request',
      })
    }
    expect(sent).toHaveLength(0)
  })

  it('does not call anything when the server has no model settings', async () => {
    const { sent, fetchImpl } = fakeModel(() => asFunctionCall(CANNED[1]))
    const result = await interpretReport(TEST_REPORTS[0].report, {
      config: null,
      configProblem: 'The AI service is not set up: LLM_API_KEY missing from the server\'s environment.',
      segments,
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, code: 'not_configured' })
    expect(sent).toHaveLength(0)
  })
})

describe('readModelConfig', () => {
  const env = { LLM_API_KEY: KEY, LLM_BASE_URL: 'https://model.example/v1/', LLM_MODEL: 'test-model' }

  it('reads the settings and trims the trailing slash', () => {
    expect(readModelConfig(env)).toEqual({
      ok: true,
      config: { provider: 'openai-compatible', baseUrl: 'https://model.example/v1', model: 'test-model', apiKey: KEY },
    })
  })

  it('names what is missing without ever echoing a value', () => {
    const result = readModelConfig({ ...env, LLM_MODEL: '', LLM_BASE_URL: undefined })
    expect(result).toEqual({
      ok: false,
      message: 'The AI service is not set up: LLM_BASE_URL, LLM_MODEL missing from the server\'s environment.',
    })
    expect(JSON.stringify(readModelConfig({ ...env, LLM_BASE_URL: 'not a url' }))).not.toContain(KEY)
  })

  it('will not send the key over plain http, except to this machine', () => {
    expect(readModelConfig({ ...env, LLM_BASE_URL: 'http://model.example/v1' })).toMatchObject({ ok: false })
    expect(readModelConfig({ ...env, LLM_BASE_URL: 'http://127.0.0.1:9000/v1' })).toMatchObject({ ok: true })
  })
})
