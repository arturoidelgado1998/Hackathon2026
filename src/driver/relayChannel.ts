// Adds delivery to another device (issue #35, N2) on top of the
// same-browser channel. The dashboard also PUTs each notice to the relay in
// server/driverNotices.ts; a driver page also follows the relay's stream.
// The same-browser path keeps working when the relay is not there.

import type { NoticeChannel, NoticeListener } from './channel.ts'
import { isDriverNotice, type DriverNotice } from './types.ts'

export const RELAY_PATH = '/api/driver-notices'

/**
 * `checking`: not known yet. `off`: no relay answered (a static host, or
 * the page was opened from a file). `live`: the relay answers.
 * `lost`: it answered before and has stopped.
 */
export type RelayState = 'checking' | 'off' | 'live' | 'lost'

export interface RelayStatus {
  state: RelayState
  /** ISO time the relay stopped answering; null unless `lost`. */
  lostAt: string | null
  /** Addresses a phone on the same network can open; [] when local only. */
  lanUrls: string[]
}

export interface RelayStatusSource {
  getStatus(): RelayStatus
  subscribe(onChange: () => void): () => void
}

export interface RelayedNoticeChannel extends NoticeChannel {
  relay: RelayStatusSource
}

/** The part of EventSource this channel uses. */
interface StreamLike {
  onopen: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void
  close(): void
}

export interface RelayDeps {
  fetch?: typeof fetch
  /** Pass null where streams are unavailable. */
  openStream?: ((url: string) => StreamLike) | null
  now?: () => string
}

function defaultOpenStream(): RelayDeps['openStream'] {
  return typeof EventSource === 'undefined' ? null : (url) => new EventSource(url)
}

/**
 * Runs `start` once the page has finished loading. A stream opened while a
 * page is still loading keeps some phone browsers showing "loading" for as
 * long as the stream stays open, which is forever.
 */
function afterPageLoad(start: () => void): void {
  if (typeof document === 'undefined' || document.readyState === 'complete') start()
  else window.addEventListener('load', () => setTimeout(start, 0), { once: true })
}

function parse(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

export function createRelayedChannel(
  local: NoticeChannel,
  deps: RelayDeps = {},
): RelayedNoticeChannel {
  const doFetch = deps.fetch ?? ((input, init) => fetch(input, init))
  const openStream = deps.openStream === undefined ? defaultOpenStream() : deps.openStream
  const now = deps.now ?? (() => new Date().toISOString())

  let status: RelayStatus = { state: 'checking', lostAt: null, lanUrls: [] }
  const statusSubscribers = new Set<() => void>()
  /** True once this page has sent a notice, so it knows to resend after an outage. */
  let hasPublished = false

  function setStatus(next: RelayStatus): void {
    status = next
    statusSubscribers.forEach((onChange) => onChange())
  }

  function markLive(lanUrls?: string[]): void {
    const wasLost = status.state === 'lost'
    if (status.state !== 'live' || lanUrls) {
      setStatus({ state: 'live', lostAt: null, lanUrls: lanUrls ?? status.lanUrls })
    }
    // Whatever was sent during the outage reached this browser only.
    if (wasLost && hasPublished) local.all().forEach(put)
  }

  function markFailed(): void {
    if (status.state === 'live') setStatus({ ...status, state: 'lost', lostAt: now() })
    else if (status.state === 'checking') setStatus({ ...status, state: 'off' })
  }

  function request(path: string, init?: RequestInit): Promise<Response | null> {
    return doFetch(RELAY_PATH + path, init).then(
      (response) => {
        if (response.ok) return response
        markFailed()
        return null
      },
      () => {
        markFailed()
        return null
      },
    )
  }

  function put(notice: DriverNotice): void {
    void request(`/${encodeURIComponent(notice.shipment_id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notice),
    }).then((response) => {
      if (response) markLive()
    })
  }

  // Is there a relay at all, and where can a phone reach it?
  void request('').then(async (response) => {
    if (!response) return
    const info = (await response.json().catch(() => null)) as { lan_urls?: unknown } | null
    const lanUrls = Array.isArray(info?.lan_urls)
      ? info.lan_urls.filter((url): url is string => typeof url === 'string')
      : []
    markLive(lanUrls)
  })

  interface Stream {
    /** Null until the page has loaded, and after the last listener leaves. */
    source: StreamLike | null
    closed: boolean
    listeners: Set<NoticeListener>
  }
  const streams = new Map<string, Stream>()

  /** A relay notice older than what this browser already holds is ignored. */
  function isStale(notice: DriverNotice): boolean {
    const held = local.latest(notice.shipment_id)
    return held !== null && notice.version < held.version
  }

  function follow(shipmentId: string): Stream | null {
    const existing = streams.get(shipmentId)
    if (existing) return existing
    if (!openStream) return null
    const stream: Stream = { source: null, closed: false, listeners: new Set() }
    streams.set(shipmentId, stream)
    afterPageLoad(() => {
      if (stream.closed) return
      stream.source = connect(shipmentId, stream, openStream)
    })
    return stream
  }

  function connect(
    shipmentId: string,
    stream: Stream,
    open: NonNullable<RelayDeps['openStream']>,
  ): StreamLike {
    const source = open(`${RELAY_PATH}/${encodeURIComponent(shipmentId)}/stream`)
    const deliver = (notice: DriverNotice | null) =>
      stream.listeners.forEach((listener) => listener(notice))

    source.onopen = () => markLive()
    source.onerror = () => markFailed()
    source.addEventListener('notice', (event) => {
      const notice = parse(event.data)
      if (isDriverNotice(notice) && notice.shipment_id === shipmentId && !isStale(notice)) {
        deliver(notice)
      }
    })
    source.addEventListener('snapshot', (event) => {
      const notice = (parse(event.data) as { notice?: unknown } | null)?.notice
      if (isDriverNotice(notice) && notice.shipment_id === shipmentId) {
        if (!isStale(notice)) deliver(notice)
      } else if (local.latest(shipmentId) === null) {
        // The relay holds nothing and neither does this browser: a Reset
        // happened while this page was disconnected.
        deliver(null)
      }
    })
    source.addEventListener('clear', () => deliver(null))
    return source
  }

  return {
    publish(notice) {
      hasPublished = true
      local.publish(notice)
      put(notice)
    },
    clear() {
      local.clear()
      void request('', { method: 'DELETE' }).then((response) => {
        if (response) markLive()
      })
    },
    latest: (shipmentId) => local.latest(shipmentId),
    all: () => local.all(),
    subscribe(shipmentId, listener) {
      const offLocal = local.subscribe(shipmentId, listener)
      const stream = follow(shipmentId)
      stream?.listeners.add(listener)
      return () => {
        offLocal()
        if (!stream) return
        stream.listeners.delete(listener)
        if (stream.listeners.size === 0) {
          stream.closed = true
          stream.source?.close()
          streams.delete(shipmentId)
        }
      }
    },
    relay: {
      getStatus: () => status,
      subscribe(onChange) {
        statusSubscribers.add(onChange)
        return () => {
          statusSubscribers.delete(onChange)
        }
      },
    },
  }
}
