// Driver notice relay (issue #35, N2). Passes a sent notice from the
// dashboard to a driver page on another device, such as a phone.
//
// A plain Node handler with no library, so the Vite dev and preview servers
// mount it today and the incident server (issue #15) can mount it later.
// It keeps the latest notice per shipment in memory only: nothing is
// written to disk or logged, and a restart forgets everything.
//
// DEMO ONLY. There is no sign-in: anyone who can reach the server can read
// or post a notice. Notices carry synthetic data and no personal data.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import {
  isDriverNotice,
  isDriverReply,
  replyAnswers,
  type DriverNotice,
  type DriverReply,
} from '../src/driver/types.ts'

export const RELAY_PATH = '/api/driver-notices'
export const MAX_BODY_BYTES = 8 * 1024

export interface RelayOptions {
  /** Only shipments the app knows can have a notice. */
  isKnownShipment: (shipmentId: string) => boolean
  /** Where the server listens, to tell the dashboard what a phone should open. */
  listening?: () => AddressInfo | string | null
  /** Keep-alive interval for open streams. */
  heartbeatMs?: number
}

export interface RelayHandler {
  (req: IncomingMessage, res: ServerResponse, next: () => void): void
  /** End every open stream and stop the keep-alive timer. */
  close(): void
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'Cache-Control': 'no-store' })
  res.end()
}

function sendEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/** Reads a request body up to the cap. Resolves null when it is too large. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) tooLarge = true
      else chunks.push(chunk)
    })
    req.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Addresses another device on the network can use; [] on a local-only server. */
export function lanUrls(listening: AddressInfo | string | null): string[] {
  if (listening === null || typeof listening === 'string') return []
  const { address, port } = listening
  const wildcard = address === '::' || address === '0.0.0.0'
  const loopback = address === '::1' || address.startsWith('127.')
  if (loopback) return []
  if (!wildcard) return [`http://${address}:${port}`]
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((net) => net.family === 'IPv4' && !net.internal)
    .map((net) => `http://${net.address}:${port}`)
}

export function createDriverNoticeRelay(options: RelayOptions): RelayHandler {
  const notices = new Map<string, DriverNotice>()
  const streams = new Map<string, Set<ServerResponse>>()
  /** The driver's answer to the notice that stands now, per shipment (issue #36). */
  const replies = new Map<string, DriverReply>()
  /** Dashboards, which hear replies for every shipment. */
  const replyStreams = new Set<ServerResponse>()

  const heartbeat = setInterval(() => {
    streams.forEach((set) => set.forEach((res) => res.write(': keep-alive\n\n')))
    replyStreams.forEach((res) => res.write(': keep-alive\n\n'))
  }, options.heartbeatMs ?? 15_000)
  heartbeat.unref()

  function openStream(shipmentId: string, req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('retry: 2000\n\n')
    // The current state first, so a page that connects or reconnects is
    // never left showing something older than what dispatch last sent.
    sendEvent(res, 'snapshot', { notice: notices.get(shipmentId) ?? null })
    const set = streams.get(shipmentId) ?? new Set<ServerResponse>()
    streams.set(shipmentId, set)
    set.add(res)
    req.on('close', () => set.delete(res))
  }

  function openReplyStream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('retry: 2000\n\n')
    sendEvent(res, 'snapshot', { replies: [...replies.values()] })
    replyStreams.add(res)
    req.on('close', () => replyStreams.delete(res))
  }

  /** Reads a JSON body. Answers the request itself and resolves undefined on failure. */
  async function readJson(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
      sendJson(res, 415, { error: 'Send the body as application/json.' })
      return undefined
    }
    const raw = await readBody(req)
    if (raw === null) {
      sendJson(res, 413, { error: 'Body is larger than 8 KB.' })
      return undefined
    }
    try {
      return JSON.parse(raw) as unknown
    } catch {
      sendJson(res, 400, { error: 'Body is not valid JSON.' })
      return undefined
    }
  }

  async function putReply(
    shipmentId: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJson(req, res)
    if (body === undefined) return
    if (!isDriverReply(body)) return sendJson(res, 400, { error: 'Body is not a driver reply.' })
    if (body.shipment_id !== shipmentId) {
      return sendJson(res, 400, { error: 'Reply is for a different shipment.' })
    }
    // A reply to an earlier version, or to a notice being revised, is refused.
    if (!replyAnswers(body, notices.get(shipmentId))) {
      return sendJson(res, 409, { error: 'That notice is no longer the current one.' })
    }
    replies.set(shipmentId, body)
    replyStreams.forEach((stream) => sendEvent(stream, 'reply', body))
    sendEmpty(res, 204)
  }

  async function putNotice(
    shipmentId: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJson(req, res)
    if (body === undefined) return
    if (!isDriverNotice(body)) return sendJson(res, 400, { error: 'Body is not a driver notice.' })
    if (body.shipment_id !== shipmentId) {
      return sendJson(res, 400, { error: 'Notice is for a different shipment.' })
    }
    notices.set(shipmentId, body)
    if (!replyAnswers(replies.get(shipmentId), body)) replies.delete(shipmentId)
    streams.get(shipmentId)?.forEach((stream) => sendEvent(stream, 'notice', body))
    sendEmpty(res, 204)
  }

  const handler = ((req, res, next) => {
    const { pathname } = new URL(req.url ?? '/', 'http://relay.invalid')
    if (pathname !== RELAY_PATH && !pathname.startsWith(`${RELAY_PATH}/`)) return next()

    const parts = pathname
      .slice(RELAY_PATH.length)
      .split('/')
      .filter(Boolean)
      .map((part) => {
        try {
          return decodeURIComponent(part)
        } catch {
          return part
        }
      })
    const method = req.method ?? 'GET'

    if (parts.length === 0) {
      if (method === 'GET') {
        return sendJson(res, 200, {
          relay: 'portplan-driver-notices',
          notices: notices.size,
          // Driver pages following each shipment right now. Counts only.
          connected: Object.fromEntries(
            [...streams].filter(([, set]) => set.size > 0).map(([id, set]) => [id, set.size]),
          ),
          lan_urls: lanUrls(options.listening?.() ?? null),
        })
      }
      if (method === 'DELETE') {
        notices.clear()
        replies.clear()
        streams.forEach((set) => set.forEach((stream) => sendEvent(stream, 'clear', {})))
        return sendEmpty(res, 204)
      }
      return sendJson(res, 405, { error: 'Method not allowed.' })
    }

    // Every shipment's replies, for the dashboard. No shipment is named "stream".
    if (parts.length === 1 && parts[0] === 'stream') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' })
      return openReplyStream(req, res)
    }

    const [shipmentId, tail, ...rest] = parts
    if (rest.length > 0 || (tail !== undefined && tail !== 'stream' && tail !== 'reply')) {
      return sendJson(res, 404, { error: 'Not found.' })
    }
    if (!options.isKnownShipment(shipmentId)) {
      return sendJson(res, 404, { error: 'Unknown shipment.' })
    }

    if (tail === 'stream') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' })
      return openStream(shipmentId, req, res)
    }
    if (tail === 'reply') {
      if (method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed.' })
      putReply(shipmentId, req, res).catch(() => {
        if (!res.headersSent) sendJson(res, 400, { error: 'Could not read the reply.' })
      })
      return
    }
    if (method === 'GET') return sendJson(res, 200, { notice: notices.get(shipmentId) ?? null })
    if (method === 'PUT') {
      putNotice(shipmentId, req, res).catch(() => {
        if (!res.headersSent) sendJson(res, 400, { error: 'Could not read the notice.' })
      })
      return
    }
    return sendJson(res, 405, { error: 'Method not allowed.' })
  }) as RelayHandler

  handler.close = () => {
    clearInterval(heartbeat)
    streams.forEach((set) => set.forEach((stream) => stream.end()))
    streams.clear()
    replyStreams.forEach((stream) => stream.end())
    replyStreams.clear()
  }
  return handler
}
