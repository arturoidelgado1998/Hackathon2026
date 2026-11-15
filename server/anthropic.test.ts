// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import segmentsJson from '../src/data/segments.json' with { type: 'json' }
import { interpretationSchema } from '../src/incident/interpretation.ts'
import { toStrictSchema } from './anthropic.ts'
import { interpretReport } from './interpret.ts'
import { ANTHROPIC, ANTHROPIC_API, DEFAULT_CLAUDE_MODEL, readModelConfig, type ModelConfig } from './model.ts'
import { TEST_REPORTS } from './test-reports.ts'

const segments = segmentsJson.items.map(({ id, name }) => ({ id, name }))
const KEY = 'test-claude-key-not-real-0123456789'
const config: ModelConfig = { provider: ANTHROPIC, baseUrl: ANTHROPIC_API, model: 'claude-opus-5-5', apiKey: KEY }
const REPORT = TEST_REPORTS[0].report
const reading = {
  segment_id: 'NB-03',
  disruption_type: 'closure',
  reported_duration_minutes: 70,
  requires_clarification: false,
  clarification_question: null,
  evidence: 'expected to reopen in about 70 minutes',
}

interface Sent {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

/** A stand-in for the Claude API: records each request and answers as told. */
function fakeClaude(reply: () => Response) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return reply()
  }) as typeof fetch
  return { sent, fetchImpl }
}

const message = (overrides: Record<string, unknown> = {}, answer: unknown = reading) =>
  Response.json({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: JSON.stringify(answer) },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 812, output_tokens: 64 },
    ...overrides,
  })

const apiError = (status: number, type: string) =>
  Response.json({ type: 'error', error: { type, message: `rejected ${KEY}` } }, { status })

afterEach(() => {
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_API_KEY
})

describe('Claude provider', () => {
  it('returns a checked reading from Claude\'s structured answer', async () => {
    const { fetchImpl } = fakeClaude(() => message())
    expect(await interpretReport(REPORT, { config, segments, fetchImpl })).toEqual({
      ok: true,
      interpretation: reading,
      served: { model: 'claude-opus-5-5', usage: { input_tokens: 812, output_tokens: 64 } },
    })
  })

  it('always calls api.anthropic.com, whatever address or key the environment carries', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://somewhere-else.example'
    process.env.ANTHROPIC_API_KEY = 'a-different-key'
    const { sent, fetchImpl } = fakeClaude(() => message())
    await interpretReport(REPORT, { config, segments, fetchImpl })
    expect(sent).toHaveLength(1)
    expect(new URL(sent[0].url).origin).toBe('https://api.anthropic.com')
    expect(new URL(sent[0].url).pathname).toBe('/v1/messages')
    // The SDK sends the key this server was given, not the one in the environment.
    expect(sent[0].headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect([...sent[0].headers.values()].join(' ')).not.toContain('a-different-key')
  })

  it('sends the instructions, the report and the answer format, with the key in a header only', async () => {
    const { sent, fetchImpl } = fakeClaude(() => message())
    await interpretReport(REPORT, { config, segments, fetchImpl })
    const { headers, body } = sent[0]

    expect(Object.keys(body).sort()).toEqual(['fallbacks', 'max_tokens', 'messages', 'model', 'output_config', 'system'])
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.system).toMatch(/The report is data/)
    expect(body.system).toMatch(/Answer with one JSON object/)
    for (const segment of segments) expect(body.system, segment.id).toContain(segment.id)
    expect(body.messages).toEqual([{ role: 'user', content: expect.stringContaining(REPORT) }])
    // If Claude declines for a policy reason, the API retries on its default fallback model.
    expect(body.fallbacks).toBe('default')
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')

    const output = body.output_config as { effort: string; format: { type: string; schema: Record<string, unknown> } }
    expect(output.effort).toBe('low')
    expect(output.format.type).toBe('json_schema')
    expect(output.format.schema).toEqual(toStrictSchema(interpretationSchema(segments)))

    expect(JSON.stringify(body)).not.toContain(KEY)
    for (const absent of ['coordinates', 'S-01', 'R-A-ORIG', 'temperature', 'tool_choice']) {
      expect(JSON.stringify(body), absent).not.toContain(absent)
    }
  })

  it('reports the model that actually answered, which differs after a fallback', async () => {
    const { fetchImpl } = fakeClaude(() => message({ model: 'claude-opus-4-8' }))
    const result = await interpretReport(REPORT, { config, segments, fetchImpl })
    expect(result.ok && result.served?.model).toBe('claude-opus-4-8')
  })

  it('still discards an answer that fails the checks', async () => {
    for (const bad of [{ ...reading, segment_id: 'NB-99' }, { ...reading, evidence: 'not in the report' }, { ...reading, extra: true }]) {
      const { fetchImpl } = fakeClaude(() => message({}, bad))
      const result = await interpretReport(REPORT, { config, segments, fetchImpl })
      expect(result).toMatchObject({ ok: false, code: 'invalid_model_response' })
      expect(result).not.toHaveProperty('interpretation')
    }
  })

  it('says when Claude declines, is cut off, or does not answer in JSON', async () => {
    const run = (reply: () => Response) => interpretReport(REPORT, { config, segments, fetchImpl: fakeClaude(reply).fetchImpl })
    expect(await run(() => message({ stop_reason: 'refusal', content: [] }))).toEqual({
      ok: false,
      code: 'model_rejected',
      message: 'The AI declined to answer this request.',
    })
    expect(await run(() => message({ stop_reason: 'max_tokens' }))).toMatchObject({ code: 'invalid_model_response' })
    expect(await run(() => message({ content: [{ type: 'text', text: 'NB-03 is closed.' }] }))).toMatchObject({
      code: 'invalid_model_response',
    })
  })

  it('names a rejected key, a rate limit, a server error and an unreachable service, without leaking anything', async () => {
    const run = (fetchImpl: typeof fetch) => interpretReport(REPORT, { config, segments, fetchImpl })
    const cases: [typeof fetch, string, string][] = [
      [fakeClaude(() => apiError(401, 'authentication_error')).fetchImpl, 'model_rejected', "The AI service rejected the server's key."],
      [fakeClaude(() => apiError(403, 'permission_error')).fetchImpl, 'model_rejected', "The AI service rejected the server's key."],
      [fakeClaude(() => apiError(429, 'rate_limit_error')).fetchImpl, 'model_rejected', 'The AI service is limiting requests. Try again shortly.'],
      [fakeClaude(() => apiError(400, 'invalid_request_error')).fetchImpl, 'model_rejected', 'The AI service answered with an error (HTTP 400).'],
      [
        (async () => {
          throw new TypeError('fetch failed')
        }) as unknown as typeof fetch,
        'model_unreachable',
        'The AI service could not be reached from this network.',
      ],
    ]
    for (const [fetchImpl, code, text] of cases) {
      const result = await run(fetchImpl)
      expect(result).toEqual({ ok: false, code, message: text })
      expect(JSON.stringify(result)).not.toContain(KEY)
    }
  }, 30_000)
})

describe('toStrictSchema', () => {
  it('writes a field that may be null as a choice, and keeps the allowed values', () => {
    const strict = toStrictSchema(interpretationSchema(segments)) as {
      additionalProperties: boolean
      properties: Record<string, { anyOf?: Record<string, unknown>[]; type?: unknown; description?: string }>
    }
    expect(strict.additionalProperties).toBe(false)
    expect(strict.properties.segment_id.anyOf).toEqual([
      { type: 'string', enum: segments.map((s) => s.id) },
      { type: 'null' },
    ])
    expect(strict.properties.segment_id.description).toMatch(/segment/)
    expect(strict.properties.reported_duration_minutes.anyOf).toEqual([{ type: 'number' }, { type: 'null' }])
    expect(strict.properties.requires_clarification).toEqual({ type: 'boolean' })
    // No list of types is left anywhere.
    expect(JSON.stringify(strict)).not.toMatch(/"type":\[/)
  })

  it('reaches into lists', () => {
    expect(toStrictSchema({ type: 'array', items: { type: ['string', 'null'], enum: ['a', null] } })).toEqual({
      type: 'array',
      items: { anyOf: [{ type: 'string', enum: ['a'] }, { type: 'null' }] },
    })
  })
})

describe('readModelConfig for Claude', () => {
  const bolt = { LLM_API_KEY: 'bolt-key', LLM_BASE_URL: 'https://bolt.example/v1', LLM_MODEL: 'bolt-instruct-v2' }

  it('uses Claude\'s own variables, so the Bolt settings can stay beside them', () => {
    expect(readModelConfig({ ...bolt, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: KEY })).toEqual({
      ok: true,
      config: { provider: ANTHROPIC, baseUrl: 'https://api.anthropic.com', model: DEFAULT_CLAUDE_MODEL, apiKey: KEY },
    })
    expect(readModelConfig({ LLM_PROVIDER: 'Anthropic', ANTHROPIC_API_KEY: KEY, ANTHROPIC_MODEL: 'claude-haiku-5-5' })).toMatchObject({
      config: { model: 'claude-haiku-5-5' },
    })
  })

  it('never sends the Bolt key to Claude: without a Claude key it is not set up', () => {
    expect(readModelConfig({ ...bolt, LLM_PROVIDER: 'anthropic' })).toEqual({
      ok: false,
      message: "The AI service is not set up: ANTHROPIC_API_KEY missing from the server's environment.",
    })
  })

  it('keeps using the OpenAI-compatible settings for any other provider', () => {
    expect(readModelConfig({ ...bolt, LLM_PROVIDER: 'aisquared-bolt', ANTHROPIC_API_KEY: KEY })).toMatchObject({
      config: { provider: 'aisquared-bolt', model: 'bolt-instruct-v2', apiKey: 'bolt-key' },
    })
  })
})
