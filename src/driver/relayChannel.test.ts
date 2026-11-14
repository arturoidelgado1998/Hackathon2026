import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserChannel, type NoticeChannel } from './channel.ts'
import { createRelayedChannel, RELAY_PATH, type RelayedNoticeChannel } from './relayChannel.ts'
import type { DriverNotice } from './types.ts'

const notice: DriverNotice = {
  shipment_id: 'S-01',
  destination_name: 'Summit Ridge Distribution (fictional)',
  appt_start: '11:00',
  appt_end: '11:30',
  option_kind: 'reroute',
  what_changed: 'NB-03 is closed from 10:00.',
  instruction: 'Use the alternative route R-A-ALT.',
  route_steps: [],
  caution: null,
  reason: 'Dispatch chose the alternative route.',
  estimated_arrival: '11:15 to 11:28',
  driver_impact: '88 min on duty: +14 min duty time vs. normal.',
  state: 'active',
  version: 1,
  sent_at: '2026-11-14T10:31:00Z',
  replaces_sent_at: null,
}

/** Stands in for EventSource. */
class FakeStream {
  static opened: FakeStream[] = []
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  closed = false
  readonly url: string
  private handlers = new Map<string, (event: MessageEvent<string>) => void>()
  constructor(url: string) {
    this.url = url
    FakeStream.opened.push(this)
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.handlers.set(type, listener)
  }
  close() {
    this.closed = true
  }
  emit(type: string, data: unknown) {
    this.handlers.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>)
  }
}

type Call = { url: string; method: string; body: string | null }

function setup(options: { relayUp?: boolean; lanUrls?: string[] } = {}) {
  let up = options.relayUp ?? true
  const calls: Call[] = []
  const fetchFake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    })
    if (!up) throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify({ lan_urls: options.lanUrls ?? [] }), { status: 200 })
  }) as unknown as typeof fetch
  const local: NoticeChannel = createBrowserChannel()
  const channel: RelayedNoticeChannel = createRelayedChannel(local, {
    fetch: fetchFake,
    openStream: (url) => new FakeStream(url),
    now: () => '2026-11-14T10:44:00Z',
  })
  return { channel, local, calls, setUp: (value: boolean) => (up = value) }
}

/** Lets the fetch promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  window.localStorage.clear()
  FakeStream.opened = []
})

describe('relayed notice channel: dashboard side', () => {
  it('learns that the relay is there and where a phone can reach it', async () => {
    const { channel } = setup({ lanUrls: ['http://192.168.1.20:5195'] })
    expect(channel.relay.getStatus().state).toBe('checking')
    await settle()
    expect(channel.relay.getStatus()).toEqual({
      state: 'live',
      lostAt: null,
      lanUrls: ['http://192.168.1.20:5195'],
    })
  })

  it('sends each notice to this browser and to the relay', async () => {
    const { channel, local, calls } = setup()
    await settle()
    channel.publish(notice)
    expect(local.latest('S-01')).toEqual(notice)
    expect(calls.at(-1)).toEqual({
      url: `${RELAY_PATH}/S-01`,
      method: 'PUT',
      body: JSON.stringify(notice),
    })
  })

  it('clears both on Reset', async () => {
    const { channel, local, calls } = setup()
    channel.publish(notice)
    channel.clear()
    expect(local.all()).toEqual([])
    expect(calls.at(-1)).toMatchObject({ url: RELAY_PATH, method: 'DELETE' })
  })

  it('keeps the same-browser path working with no relay, and says so', async () => {
    const { channel, local } = setup({ relayUp: false })
    await settle()
    expect(channel.relay.getStatus().state).toBe('off')
    const seen: (DriverNotice | null)[] = []
    channel.subscribe('S-01', (n) => seen.push(n))
    channel.publish(notice)
    await settle()
    expect(seen).toEqual([notice])
    expect(local.latest('S-01')).toEqual(notice)
    expect(channel.relay.getStatus().state).toBe('off')
  })

  it('reports an outage, then resends what the phone missed when the relay returns', async () => {
    const { channel, calls, setUp } = setup()
    await settle()
    let changes = 0
    channel.relay.subscribe(() => changes++)

    setUp(false)
    channel.publish(notice)
    await settle()
    expect(channel.relay.getStatus()).toMatchObject({ state: 'lost', lostAt: '2026-11-14T10:44:00Z' })

    setUp(true)
    const update = { ...notice, version: 2 }
    channel.publish(update)
    await settle()
    expect(channel.relay.getStatus().state).toBe('live')
    expect(changes).toBe(2)
    // After recovery the latest notice is PUT again.
    await settle()
    const puts = calls.filter((call) => call.method === 'PUT').map((call) => call.body)
    expect(puts.filter((body) => body === JSON.stringify(update)).length).toBeGreaterThanOrEqual(2)
  })
})

describe('relayed notice channel: driver page side', () => {
  function follow(shipmentId = 'S-01') {
    const context = setup()
    const seen: (DriverNotice | null)[] = []
    const unsubscribe = context.channel.subscribe(shipmentId, (n) => seen.push(n))
    const stream = FakeStream.opened.at(-1)!
    return { ...context, seen, unsubscribe, stream }
  }

  it('follows the stream for its own shipment', () => {
    const { stream } = follow()
    expect(stream.url).toBe(`${RELAY_PATH}/S-01/stream`)
  })

  it('shows the notice the relay holds on connect, then each update and Reset', () => {
    const { seen, stream } = follow()
    stream.emit('snapshot', { notice })
    const update = { ...notice, version: 2, state: 'under_revision' }
    stream.emit('notice', update)
    stream.emit('clear', {})
    expect(seen).toEqual([notice, update, null])
  })

  it('treats an empty relay as Reset only when this browser holds nothing either', () => {
    const phone = follow()
    phone.stream.emit('snapshot', { notice: null })
    expect(phone.seen).toEqual([null])

    // On the laptop the notice is still in this browser: a restarted relay
    // that has forgotten it must not wipe the page.
    const laptop = follow()
    laptop.local.publish(notice)
    laptop.seen.length = 0
    laptop.stream.emit('snapshot', { notice: null })
    expect(laptop.seen).toEqual([])
  })

  it('ignores anything that is not a notice for this shipment', () => {
    const { seen, stream } = follow()
    stream.emit('notice', { instruction: '<img src=x onerror=alert(1)>' })
    stream.emit('notice', { ...notice, shipment_id: 'S-02' })
    stream.emit('snapshot', { notice: { ...notice, version: 0 } })
    expect(seen).toEqual([null])
  })

  it('ignores a relay notice older than the one this browser holds', () => {
    const { seen, stream, local } = follow()
    local.publish({ ...notice, version: 3 })
    seen.length = 0
    stream.emit('snapshot', { notice: { ...notice, version: 2 } })
    stream.emit('notice', { ...notice, version: 1 })
    expect(seen).toEqual([])
  })

  it('says when the connection is lost and when it is back', async () => {
    const { channel, stream } = follow()
    await settle()
    stream.onopen?.(new Event('open'))
    expect(channel.relay.getStatus().state).toBe('live')
    stream.onerror?.(new Event('error'))
    expect(channel.relay.getStatus()).toMatchObject({ state: 'lost', lostAt: '2026-11-14T10:44:00Z' })
    stream.onopen?.(new Event('open'))
    expect(channel.relay.getStatus()).toMatchObject({ state: 'live', lostAt: null })
  })

  it('closes the stream when the last listener leaves', () => {
    const { channel, unsubscribe, stream } = follow()
    const second = channel.subscribe('S-01', () => {})
    expect(FakeStream.opened).toHaveLength(1)
    unsubscribe()
    expect(stream.closed).toBe(false)
    second()
    expect(stream.closed).toBe(true)
  })

  it('works without streams, for example in an old browser', () => {
    const local = createBrowserChannel()
    const channel = createRelayedChannel(local, {
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      openStream: null,
    })
    const seen: (DriverNotice | null)[] = []
    channel.subscribe('S-01', (n) => seen.push(n))
    channel.publish(notice)
    expect(seen).toEqual([notice])
  })
})
