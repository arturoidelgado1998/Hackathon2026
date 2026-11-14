// @vitest-environment node
// The relay over real HTTP: a server on a free local port, driven by fetch.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DriverNotice } from '../src/driver/types.ts'
import {
  createDriverNoticeRelay,
  MAX_BODY_BYTES,
  RELAY_PATH,
  type RelayHandler,
} from './driverNotices.ts'

const notice: DriverNotice = {
  shipment_id: 'S-01',
  destination_name: 'Summit Ridge Distribution (fictional)',
  appt_start: '11:00',
  appt_end: '11:30',
  option_kind: 'reroute',
  what_changed: 'NB-03 is closed from 10:00.',
  instruction: 'Use the alternative route R-A-ALT.',
  route_steps: ['A', 'B'],
  caution: 'Route suitability for trucks is not verified.',
  reason: 'Dispatch chose the alternative route.',
  estimated_arrival: '11:15 to 11:28',
  driver_impact: '88 min on duty: +14 min duty time vs. normal.',
  state: 'active',
  version: 1,
  sent_at: '2026-11-14T10:31:00Z',
  replaces_sent_at: null,
}

let relay: RelayHandler
let server: Server
let base: string
let listening: AddressInfo | null

const url = (path = '') => `${base}${RELAY_PATH}${path}`

function put(shipmentId: string, body: unknown, contentType = 'application/json') {
  return fetch(url(`/${shipmentId}`), {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const latest = async (shipmentId: string) =>
  ((await (await fetch(url(`/${shipmentId}`))).json()) as { notice: DriverNotice | null }).notice

/** Opens a stream and returns a function that waits for the next event. */
async function openStream(shipmentId: string) {
  const abort = new AbortController()
  const response = await fetch(url(`/${shipmentId}/stream`), { signal: abort.signal })
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  async function next(): Promise<{ event: string; data: unknown }> {
    for (;;) {
      const end = buffer.indexOf('\n\n')
      if (end >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const event = /^event: (.+)$/m.exec(block)?.[1]
        const data = /^data: (.+)$/m.exec(block)?.[1]
        if (event && data) return { event, data: JSON.parse(data) as unknown }
        continue
      }
      const { value, done } = await reader.read()
      if (done) throw new Error('Stream ended')
      buffer += value
    }
  }
  return { response, next, close: () => abort.abort() }
}

beforeEach(async () => {
  listening = null
  relay = createDriverNoticeRelay({
    isKnownShipment: (id) => ['S-01', 'S-02'].includes(id),
    listening: () => listening,
  })
  server = createServer((req, res) =>
    relay(req, res, () => {
      res.statusCode = 418
      res.end('passed on')
    }),
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  relay.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

describe('driver notice relay', () => {
  it('leaves other paths to the rest of the server', async () => {
    expect((await fetch(`${base}/driver.html`)).status).toBe(418)
    expect((await fetch(`${base}/api/driver-notices-other`)).status).toBe(418)
  })

  it('stores a notice and returns it as the latest', async () => {
    expect(await latest('S-01')).toBeNull()
    expect((await put('S-01', notice)).status).toBe(204)
    expect(await latest('S-01')).toEqual(notice)
    expect(await latest('S-02')).toBeNull()
  })

  it('replaces the notice with a later one for the same shipment', async () => {
    await put('S-01', notice)
    const revised = { ...notice, state: 'under_revision' }
    await put('S-01', revised)
    expect(await latest('S-01')).toEqual(revised)
  })

  it('rejects an unknown shipment and stores nothing', async () => {
    const response = await put('S-99', { ...notice, shipment_id: 'S-99' })
    expect(response.status).toBe(404)
    expect((await fetch(url('/S-99'))).status).toBe(404)
    expect((await fetch(url('/S-99/stream'))).status).toBe(404)
  })

  it('rejects malformed bodies and stores nothing', async () => {
    expect((await put('S-01', 'not json')).status).toBe(400)
    expect((await put('S-01', { instruction: 'Drive faster' })).status).toBe(400)
    expect((await put('S-01', { ...notice, version: 0 })).status).toBe(400)
    // A notice for S-02 cannot be filed under S-01.
    expect((await put('S-01', { ...notice, shipment_id: 'S-02' })).status).toBe(400)
    expect((await put('S-01', notice, 'text/plain')).status).toBe(415)
    expect(await latest('S-01')).toBeNull()
  })

  it('rejects a body over 8 KB', async () => {
    const big = { ...notice, reason: 'x'.repeat(MAX_BODY_BYTES) }
    expect((await put('S-01', big)).status).toBe(413)
    expect(await latest('S-01')).toBeNull()
  })

  it('refuses methods it does not support', async () => {
    expect((await fetch(url('/S-01'), { method: 'POST' })).status).toBe(405)
    expect((await fetch(url('/S-01'), { method: 'DELETE' })).status).toBe(405)
    expect((await fetch(url(), { method: 'PUT' })).status).toBe(405)
  })

  it('streams the current notice on connect, then each update, to that shipment only', async () => {
    await put('S-01', notice)
    const first = await openStream('S-01')
    const other = await openStream('S-02')
    expect(first.response.headers.get('content-type')).toBe('text/event-stream')
    expect(await first.next()).toEqual({ event: 'snapshot', data: { notice } })
    expect(await other.next()).toEqual({ event: 'snapshot', data: { notice: null } })
    const info = (await (await fetch(url())).json()) as { connected: Record<string, number> }
    expect(info.connected).toEqual({ 'S-01': 1, 'S-02': 1 })

    const update = { ...notice, version: 2, instruction: 'Keep the original route.' }
    await put('S-01', update)
    expect(await first.next()).toEqual({ event: 'notice', data: update })

    // S-02's page hears nothing about S-01; the next thing it gets is Reset.
    expect((await fetch(url(), { method: 'DELETE' })).status).toBe(204)
    expect(await other.next()).toEqual({ event: 'clear', data: {} })
    expect(await first.next()).toEqual({ event: 'clear', data: {} })
    expect(await latest('S-01')).toBeNull()
    first.close()
    other.close()
  })

  it('reports no phone address for a local-only server', async () => {
    listening = { address: '127.0.0.1', family: 'IPv4', port: 5195 }
    const info = (await (await fetch(url())).json()) as { relay: string; lan_urls: string[] }
    expect(info.relay).toBe('portplan-driver-notices')
    expect(info.lan_urls).toEqual([])
  })

  it('reports the address a phone can open when the server listens on the network', async () => {
    listening = { address: '192.168.1.20', family: 'IPv4', port: 5195 }
    const info = (await (await fetch(url())).json()) as { lan_urls: string[]; notices: number }
    expect(info.lan_urls).toEqual(['http://192.168.1.20:5195'])
    expect(info.notices).toBe(0)

    listening = { address: '::', family: 'IPv6', port: 5195 }
    const wildcard = (await (await fetch(url())).json()) as { lan_urls: string[] }
    for (const address of wildcard.lan_urls) {
      expect(address).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:5195$/)
      expect(address).not.toContain('127.')
    }
  })
})
