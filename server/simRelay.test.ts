// @vitest-environment node
// The simulation relay over real HTTP: a server on a free local port, driven by fetch.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SIM_RELAY_PATH, type SimBroadcast } from '../src/sim/live.ts'
import { createSimRelay, SIM_MAX_BODY_BYTES, type SimRelayHandler } from './simRelay.ts'

const state: SimBroadcast = {
  v: 1,
  sender: 'page-1',
  seq: 1,
  query: 'closure=1&segment=NB-03&start=10%3A00&reopen=11%3A10&response=wait&case=slow&speed=5',
  time: 645,
  running: true,
  started: true,
  speed: 5,
  beat: false,
}

let relay: SimRelayHandler
let server: Server
let base: string

const put = (body: unknown, contentType = 'application/json') =>
  fetch(`${base}${SIM_RELAY_PATH}`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(async () => {
  relay = createSimRelay({ listening: () => server.address() })
  server = createServer((req, res) => relay(req, res, () => res.writeHead(404).end()))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  relay.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

describe('simulation relay', () => {
  it('starts empty and keeps the latest state', async () => {
    expect(await (await fetch(`${base}${SIM_RELAY_PATH}`)).json()).toEqual({ state: null, lan_urls: [] })
    expect((await put(state)).status).toBe(204)
    expect((await put({ ...state, seq: 2, time: 700, running: false })).status).toBe(204)
    const body = (await (await fetch(`${base}${SIM_RELAY_PATH}`)).json()) as { state: SimBroadcast }
    expect(body.state).toMatchObject({ seq: 2, time: 700, running: false })
  })

  it('refuses anything that is not a simulation state', async () => {
    expect((await put({ ...state, time: -5 })).status).toBe(400)
    expect((await put({ ...state, speed: 9999 })).status).toBe(400)
    expect((await put({ hello: 'world' })).status).toBe(400)
    expect((await put('not json')).status).toBe(400)
    expect((await put(state, 'text/plain')).status).toBe(415)
    expect((await put({ ...state, query: 'x'.repeat(SIM_MAX_BODY_BYTES) })).status).toBe(413)
    expect((await fetch(`${base}${SIM_RELAY_PATH}`, { method: 'DELETE' })).status).toBe(405)
    expect(((await (await fetch(`${base}${SIM_RELAY_PATH}`)).json()) as { state: unknown }).state).toBeNull()
  })

  it('streams the current state to a dashboard that connects, then every change', async () => {
    await put(state)
    const response = await fetch(`${base}${SIM_RELAY_PATH}/stream`)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const readUntil = async (marker: string) => {
      while (!text.includes(marker)) text += decoder.decode((await reader.read()).value)
    }
    await readUntil('event: snapshot')
    await readUntil('"seq":1')
    await put({ ...state, seq: 2, time: 646 })
    await readUntil('event: state')
    await readUntil('"seq":2')
    expect(text).toContain('"time":646')
    await reader.cancel()
  })

  it('follows one page at a time: a change takes control, another page’s repeats do not', async () => {
    const current = async () =>
      ((await (await fetch(`${base}${SIM_RELAY_PATH}`)).json()) as { state: SimBroadcast }).state
    await put({ ...state, sender: 'page-1', seq: 1, time: 600 })
    // A second page that is also running keeps repeating its own clock.
    expect((await put({ ...state, sender: 'page-2', seq: 1, time: 700, beat: true })).status).toBe(204)
    expect(await current()).toMatchObject({ sender: 'page-1', time: 600 })
    // The page being followed keeps the clock moving with its repeats.
    await put({ ...state, sender: 'page-1', seq: 2, time: 605, beat: true })
    expect(await current()).toMatchObject({ sender: 'page-1', time: 605 })
    // Someone changes something on the second page: it takes control.
    await put({ ...state, sender: 'page-2', seq: 2, time: 710, beat: false })
    expect(await current()).toMatchObject({ sender: 'page-2', time: 710 })
    // And now the first page's repeats are the ones ignored.
    await put({ ...state, sender: 'page-1', seq: 3, time: 610, beat: true })
    expect(await current()).toMatchObject({ sender: 'page-2', time: 710 })
  })

  it('passes other requests on', async () => {
    expect((await fetch(`${base}/api/other`)).status).toBe(404)
  })
})
