// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, type AppDeps } from './app.ts'
import type { ModelConfig } from './model.ts'
import { RECORD_FUNCTION } from './prompt.ts'

const KEY = 'test-key-not-real-0123456789'
const REPORT = 'NB-03 closed at the port exit, expected to reopen in about 70 minutes.'
const config: ModelConfig = { provider: 'test', baseUrl: 'https://model.example/v1', model: 'test-model', apiKey: KEY }
const segments = [{ id: 'NB-03', name: 'I-710 northbound to SR-60 east (shared corridor)' }]
const reading = {
  segment_id: 'NB-03',
  disruption_type: 'closure',
  reported_duration_minutes: 70,
  requires_clarification: false,
  clarification_question: null,
  evidence: 'expected to reopen in about 70 minutes',
}
const modelAnswers = (answer: unknown) =>
  (async () =>
    Response.json({
      choices: [{ message: { tool_calls: [{ function: { name: RECORD_FUNCTION, arguments: JSON.stringify(answer) } }] } }],
    })) as unknown as typeof fetch

let server: Server | undefined

/** Starts the app on a free port and returns its address and its log lines. */
async function start(overrides: Partial<AppDeps> = {}) {
  const lines: string[] = []
  server = createServer(
    createApp({ config, segments, fetchImpl: modelAnswers(reading), log: (line) => lines.push(line), ...overrides }),
  )
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (body: string) =>
    fetch(`${origin}/incident/interpret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return { origin, lines, post }
}

afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)))
  server = undefined
})

describe('POST /incident/interpret', () => {
  it('returns the validated reading', async () => {
    const { post } = await start()
    const response = await post(JSON.stringify({ report: REPORT }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ interpretation: reading })
  })

  it('returns a clear error and no reading when the model\'s answer fails the checks', async () => {
    const { post } = await start({ fetchImpl: modelAnswers({ ...reading, segment_id: 'NB-99' }) })
    const response = await post(JSON.stringify({ report: REPORT }))
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body).toMatchObject({
      error: 'invalid_model_response',
      details: ['"segment_id" names a segment that does not exist: "NB-99".'],
    })
    expect(body).not.toHaveProperty('interpretation')
  })

  it('answers 503 when the AI is not set up, so the dashboard can offer manual entry', async () => {
    const { post } = await start({ config: null, configProblem: 'The AI service is not set up: LLM_API_KEY missing.' })
    const response = await post(JSON.stringify({ report: REPORT }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'not_configured',
      message: 'The AI service is not set up: LLM_API_KEY missing.',
    })
  })

  it('answers 502 when the model cannot be reached', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const { post } = await start({ fetchImpl: down })
    const response = await post(JSON.stringify({ report: REPORT }))
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'model_unreachable' })
  })

  it('rejects a body that is not JSON, has no report, or is too large', async () => {
    const { post } = await start()
    expect((await post('NB-03 closed')).status).toBe(400)
    expect((await post(JSON.stringify({ text: REPORT }))).status).toBe(400)
    expect((await post(JSON.stringify({ report: 'x'.repeat(20_000) }))).status).toBe(413)
  })

  it('only accepts POST, and only on its own path', async () => {
    const { origin } = await start()
    const get = await fetch(`${origin}/incident/interpret`)
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    expect((await fetch(`${origin}/incident/confirm`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${origin}/`)).status).toBe(404)
  })

  it('logs the outcome and the time taken, never the report or the key', async () => {
    const { post, lines } = await start()
    await post(JSON.stringify({ report: REPORT }))
    await post('not json')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^interpret ok \(\d+ ms\)$/)
    expect(lines[1]).toBe('interpret bad_request (not JSON)')
    const logged = lines.join('\n')
    expect(logged).not.toContain(KEY)
    expect(logged).not.toContain('NB-03')
  })
})

describe('the cap on model calls', () => {
  it('refuses the call past the limit in a minute, without asking the model, and recovers', async () => {
    let clock = 1_000_000
    let asked = 0
    const counting = (async (...args: Parameters<typeof fetch>) => {
      asked += 1
      return modelAnswers(reading)(...args)
    }) as typeof fetch
    const { origin, post, lines } = await start({ maxPerMinute: 3, now: () => clock, fetchImpl: counting })
    for (let i = 0; i < 3; i++) expect((await post(JSON.stringify({ report: REPORT }))).status).toBe(200)

    // The fourth in the same minute, on either route, is refused and costs nothing.
    const refused = await post(JSON.stringify({ report: REPORT }))
    expect(refused.status).toBe(429)
    expect(refused.headers.get('retry-after')).toBe('60')
    expect(await refused.json()).toMatchObject({ error: 'rate_limited', message: 'Too many AI requests in a minute. Try again in 60 seconds.' })
    const other = await fetch(`${origin}/shipment/suggest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(other.status).toBe(429)
    expect(asked).toBe(3)
    expect(lines.filter((line) => line.includes('rate_limited'))).toHaveLength(2)

    // Health is never limited, and the cap lifts as the minute passes.
    expect((await fetch(`${origin}/health`)).status).toBe(200)
    clock += 59_000
    expect((await post(JSON.stringify({ report: REPORT }))).status).toBe(429)
    clock += 1_000
    expect((await post(JSON.stringify({ report: REPORT }))).status).toBe(200)
    expect(asked).toBe(4)
  })

  it('counts refused and malformed requests too, so they cannot be used to hammer the server', async () => {
    const { post } = await start({ maxPerMinute: 2, now: () => 5 })
    expect((await post('not json')).status).toBe(400)
    expect((await post('not json')).status).toBe(400)
    expect((await post(JSON.stringify({ report: REPORT }))).status).toBe(429)
  })

  it('allows 30 a minute unless told otherwise', async () => {
    const { post } = await start({ now: () => 5 })
    for (let i = 0; i < 30; i++) expect((await post(JSON.stringify({ report: REPORT }))).status).toBe(200)
    expect((await post(JSON.stringify({ report: REPORT }))).status).toBe(429)
  })
})

describe('GET /health', () => {
  it('says whether the AI is set up and which model it uses, without the key', async () => {
    const { origin } = await start()
    const response = await fetch(`${origin}/health`)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ ok: true, ai_configured: true, provider: 'test', model: 'test-model' })
    expect(text).not.toContain(KEY)
    expect(text).not.toContain('model.example')
  })

  it('reports an AI that is switched off', async () => {
    const { origin } = await start({ config: null })
    expect(await (await fetch(`${origin}/health`)).json()).toEqual({
      ok: true,
      ai_configured: false,
      provider: null,
      model: null,
    })
  })
})
