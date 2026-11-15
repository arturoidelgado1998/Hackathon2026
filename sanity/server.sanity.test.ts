// Does the incident server actually start and answer, as a real process?
//
// The unit tests import the server's modules through Vitest. This check runs
// `node server/index.ts` the way `npm run server` does, so it also covers what
// they cannot: Node running the TypeScript directly, the JSON import, the
// environment handling and the listening socket.
//
// No real model is called and no real key is used. One check runs the server
// with the AI switched off; the other points it at a stand-in model on this
// machine and follows a report all the way through.

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { ROOT, readJson } from './helpers.ts'

const FAKE_KEY = 'sanity-check-key-not-real'
const REPORT = 'NB-03 closed at the port exit, expected to reopen in about 70 minutes.'
const segments = readJson<{ items: { id: string; name: string }[] }>('src', 'data', 'segments.json').items

let child: ChildProcess | undefined
let standIn: Server | undefined

afterEach(async () => {
  child?.kill()
  child = undefined
  await new Promise((resolve) => (standIn ? standIn.close(resolve) : resolve(undefined)))
  standIn = undefined
})

/** A free port on this machine. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise((resolve) => probe.close(resolve))
  return port
}

/** Starts the real server with only the given settings and waits until it listens. */
async function startServer(settings: Record<string, string>) {
  const port = await freePort()
  let output = ''
  // A clean environment: nothing from this machine's .env or shell reaches it.
  child = spawn(process.execPath, ['server/index.ts'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? '', PORT: String(port), ...settings },
  })
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const deadline = Date.now() + 20_000
  while (!output.includes('Incident server on')) {
    if (child.exitCode !== null) throw new Error(`The server stopped while starting:\n${output}`)
    if (Date.now() > deadline) throw new Error(`The server did not start within 20 s:\n${output}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const origin = `http://127.0.0.1:${port}`
  const interpret = (report: string) =>
    fetch(`${origin}/incident/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report }),
    })
  return { origin, interpret, output: () => output }
}

describe('incident server as a real process', () => {
  it('starts with the AI switched off and says so, so manual entry can take over', async () => {
    const { origin, interpret, output } = await startServer({})

    expect(await (await fetch(`${origin}/health`)).json()).toEqual({
      ok: true,
      ai_configured: false,
      provider: null,
      model: null,
    })
    const response = await interpret(REPORT)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'not_configured' })
    expect(output()).toContain('AI: off.')
  })

  it('takes a report through a stand-in model and returns only a checked reading', async () => {
    // The stand-in answers like an OpenAI-compatible service and records what it was sent.
    const received: { authorization?: string; body: string }[] = []
    let answer: Record<string, unknown> = {
      segment_id: 'NB-03',
      disruption_type: 'closure',
      reported_duration_minutes: 70,
      requires_clarification: false,
      clarification_question: null,
      evidence: 'expected to reopen in about 70 minutes',
    }
    standIn = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => {
        received.push({ authorization: request.headers.authorization, body })
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            choices: [
              { message: { tool_calls: [{ function: { name: 'record_incident', arguments: JSON.stringify(answer) } }] } },
            ],
          }),
        )
      })
    })
    await new Promise<void>((resolve) => standIn!.listen(0, '127.0.0.1', resolve))
    const modelPort = (standIn.address() as AddressInfo).port

    const { origin, interpret, output } = await startServer({
      LLM_PROVIDER: 'stand-in',
      LLM_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
      LLM_MODEL: 'stand-in-model',
      LLM_API_KEY: FAKE_KEY,
    })

    // A good answer comes back as the reading.
    const good = await interpret(REPORT)
    expect(good.status).toBe(200)
    expect(await good.json()).toEqual({ interpretation: answer })

    // The model was sent the report and every segment's id and name, with the key in the header only.
    expect(received).toHaveLength(1)
    expect(received[0].authorization).toBe(`Bearer ${FAKE_KEY}`)
    expect(received[0].body).toContain(REPORT)
    for (const segment of segments) expect(received[0].body, segment.id).toContain(segment.id)
    expect(received[0].body).not.toContain(FAKE_KEY)
    expect(received[0].body).not.toContain('coordinates')

    // An answer naming a segment that does not exist is refused whole.
    answer = { ...answer, segment_id: 'NB-99' }
    const bad = await interpret(REPORT)
    expect(bad.status).toBe(422)
    const refused = (await bad.json()) as Record<string, unknown>
    expect(refused.error).toBe('invalid_model_response')
    expect(refused).not.toHaveProperty('interpretation')

    // Nothing the server printed or returned contains the key or the report.
    const health = await (await fetch(`${origin}/health`)).text()
    for (const text of [output(), health, JSON.stringify(refused)]) {
      expect(text).not.toContain(FAKE_KEY)
    }
    expect(output()).not.toContain('NB-03 closed')
    expect(output()).toMatch(/interpret ok \(\d+ ms\)/)
    expect(output()).toMatch(/interpret invalid_model_response \(\d+ ms\)/)
  })

  it('suggests a response through a stand-in model, and refuses a reason the figures do not support', async () => {
    const option = (kind: string, values: object) => ({
      kind, available: true, arrival_min: null, arrival_max: null, lateness_min: null, lateness_max: null,
      risk: 'TIGHT', miles: null, cost: null, co2_kg: null, driver_duty_min: null, schools_150m: null,
      dac_tracts: null, status: '', ...values,
    })
    const facts = {
      shipment_id: 'S-07',
      appt_start: '11:30',
      appt_end: '12:00',
      options: [
        option('wait', { arrival_min: '11:55', arrival_max: '12:06', lateness_min: 0, lateness_max: 6, miles: 40, cost: 156, co2_kg: 62.8, driver_duty_min: 126, schools_150m: 5, dac_tracts: 51 }),
        option('reroute', { arrival_min: '11:05', arrival_max: '11:23', lateness_min: 0, lateness_max: 0, risk: 'ON_TRACK', miles: 45, cost: 136, co2_kg: 70.7, driver_duty_min: 83, schools_150m: 18, dac_tracts: 79 }),
      ],
    }
    let answer: object = { suggested_option: 'reroute', because: ['risk'], note: 'Rerouting keeps the appointment.' }
    standIn = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            choices: [{ message: { tool_calls: [{ function: { name: 'suggest_response', arguments: JSON.stringify(answer) } }] } }],
          }),
        )
      })
    })
    await new Promise<void>((resolve) => standIn!.listen(0, '127.0.0.1', resolve))
    const { origin, output } = await startServer({
      LLM_BASE_URL: `http://127.0.0.1:${(standIn.address() as AddressInfo).port}/v1`,
      LLM_MODEL: 'stand-in-model',
      LLM_API_KEY: FAKE_KEY,
    })
    const suggest = () =>
      fetch(`${origin}/shipment/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facts }),
      })

    const good = await suggest()
    expect(good.status).toBe(200)
    const { suggestion } = (await good.json()) as { suggestion: { gives_up: { measure: string }[]; because: object[] } }
    expect(suggestion.because).toEqual([{ measure: 'risk', against: 'wait' }])
    // What it gives up is worked out by the server from the figures, not by the model.
    expect(suggestion.gives_up.map((d) => d.measure)).toEqual(['schools', 'tracts', 'miles', 'co2'])

    // "Fewer schools" is false for the reroute, so the whole suggestion is refused.
    answer = { suggested_option: 'reroute', because: ['schools'], note: 'Rerouting passes fewer schools.' }
    const bad = await suggest()
    expect(bad.status).toBe(422)
    expect(await bad.json()).not.toHaveProperty('suggestion')
    expect(output()).not.toContain(FAKE_KEY)
  })
})

