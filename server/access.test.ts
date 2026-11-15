// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createAccess, createLocalOnlyGuard, isLoopback, newAccessKey, ACCESS_KEY_HEADER } from './access.ts'
import { createDriverNoticeRelay, RELAY_PATH } from './driverNotices.ts'
import { createSimRelay } from './simRelay.ts'
import { SIM_RELAY_PATH } from '../src/sim/live.ts'

describe('isLoopback', () => {
  it('accepts this computer only', () => {
    for (const address of ['127.0.0.1', '127.0.0.53', '::1', '::ffff:127.0.0.1']) expect(isLoopback(address), address).toBe(true)
    for (const address of [undefined, '', '192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', '0.0.0.0', '1127.0.0.1', '127.0.0.1.evil', 'localhost']) {
      expect(isLoopback(address), String(address)).toBe(false)
    }
  })
})

describe('access key', () => {
  it('is new each time, long enough to resist guessing, and easy to read aloud', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newAccessKey()))
    expect(keys.size).toBe(200)
    for (const key of keys) expect(key).toMatch(/^[A-HJ-NP-Za-km-z2-9]{12}$/)
  })

  it('uses a fixed key only when it is well formed', () => {
    expect(createAccess({ key: 'TeamDemo2026' }).key).toBe('TeamDemo2026')
    for (const bad of ['', 'short', 'has space 12', 'semi;colon123', undefined]) {
      expect(createAccess({ key: bad }).key).toMatch(/^[A-Za-z0-9]{12}$/)
      expect(createAccess({ key: bad }).key).not.toBe(bad)
    }
  })
})

// The relays as another device would reach them: every request here counts as
// coming from the network, never from this computer.
describe('the relays behind the gate', () => {
  let server: Server | undefined
  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)))
    server = undefined
  })

  async function start(isLocal: boolean) {
    const access = createAccess({ key: 'TeamDemo2026', isLocal: () => isLocal })
    const sim = createSimRelay({ access })
    const notices = createDriverNoticeRelay({ isKnownShipment: (id) => id === 'S-01', access })
    server = createServer((req, res) =>
      sim(req, res, () => notices(req, res, () => { res.writeHead(404); res.end('page') })),
    )
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    server.on('close', () => { sim.close(); notices.close() })
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }
  const state = { v: 1, sender: 'a', seq: 1, query: 'closure=1', time: 600, running: false, started: true, speed: 5, beat: false }

  it('refuses another device without the key, on every relay address and method', async () => {
    const origin = await start(false)
    const attempts: [string, RequestInit?][] = [
      [SIM_RELAY_PATH],
      [`${SIM_RELAY_PATH}/stream`],
      [SIM_RELAY_PATH, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) }],
      [RELAY_PATH],
      [RELAY_PATH, { method: 'DELETE' }],
      [`${RELAY_PATH}/stream`],
      [`${RELAY_PATH}/S-01`],
      [`${RELAY_PATH}/S-01/stream`],
      [`${RELAY_PATH}/S-01/reply`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
      [`${SIM_RELAY_PATH}?k=WrongKey0000`],
      [`${SIM_RELAY_PATH}?k=`],
      [SIM_RELAY_PATH, { headers: { [ACCESS_KEY_HEADER]: 'TeamDemo202' } }],
    ]
    for (const [path, init] of attempts) {
      const response = await fetch(origin + path, init)
      expect(response.status, `${init?.method ?? 'GET'} ${path}`).toBe(401)
      const body = (await response.json()) as Record<string, unknown>
      expect(body.error).toBe('access_key_required')
      // The refusal never gives the key, or anything the relay holds, away.
      expect(JSON.stringify(body)).not.toContain('TeamDemo2026')
      expect(body).not.toHaveProperty('state')
    }
    // Nothing was stored by the refused PUT.
    const allowed = await (await fetch(`${origin}${SIM_RELAY_PATH}?k=TeamDemo2026`)).json()
    expect(allowed).toMatchObject({ state: null })
  })

  it('lets another device in with the key, in the link or in a header', async () => {
    const origin = await start(false)
    const put = await fetch(`${origin}${SIM_RELAY_PATH}?k=TeamDemo2026`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
    })
    expect(put.status).toBe(204)
    const byHeader = await fetch(origin + SIM_RELAY_PATH, { headers: { [ACCESS_KEY_HEADER]: 'TeamDemo2026' } })
    expect(await byHeader.json()).toMatchObject({ state: { time: 600 }, key: 'TeamDemo2026' })
    const notices = await fetch(`${origin}${RELAY_PATH}?k=TeamDemo2026`)
    expect(await notices.json()).toMatchObject({ relay: 'portplan-driver-notices', key: 'TeamDemo2026' })
    expect((await fetch(`${origin}${RELAY_PATH}/S-01?k=TeamDemo2026`)).status).toBe(200)
  })

  it('asks nothing of this computer, and tells its pages the key for their links', async () => {
    const origin = await start(true)
    expect(await (await fetch(origin + SIM_RELAY_PATH)).json()).toMatchObject({ state: null, key: 'TeamDemo2026' })
    expect((await fetch(`${origin}${RELAY_PATH}/S-01`)).status).toBe(200)
  })

  it('leaves every other address to the pages', async () => {
    const origin = await start(false)
    const response = await fetch(`${origin}/driver.html`)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('page')
  })
})

describe('the AI stays on this computer', () => {
  let server: Server | undefined
  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)))
    server = undefined
  })
  async function start(isLocal: boolean) {
    const guard = createLocalOnlyGuard(['/incident', '/shipment'], () => isLocal)
    server = createServer((req, res) => guard(req, res, () => { res.writeHead(200); res.end('passed on') }))
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  it('refuses another device on every AI address, with or without the relay key', async () => {
    const origin = await start(false)
    for (const path of ['/incident/interpret', '/shipment/suggest', '/incident', '/shipment/suggest?k=TeamDemo2026', '/incident/interpret/']) {
      const response = await fetch(origin + path, { method: 'POST', headers: { [ACCESS_KEY_HEADER]: 'TeamDemo2026' }, body: '{}' })
      expect(response.status, path).toBe(403)
      expect(await response.json()).toMatchObject({ error: 'local_only' })
    }
  })

  it('still serves another device the pages and the relays', async () => {
    const origin = await start(false)
    for (const path of ['/', '/driver.html', '/api/sim-state', '/incidents', '/shipments.json', '/src/incident/interpretation.ts']) {
      expect(await (await fetch(origin + path)).text(), path).toBe('passed on')
    }
  })

  it('lets this computer through', async () => {
    const origin = await start(true)
    expect(await (await fetch(`${origin}/shipment/suggest`, { method: 'POST', body: '{}' })).text()).toBe('passed on')
  })
})
