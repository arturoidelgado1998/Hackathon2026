// Simulation relay. Passes the simulation page's setup and clock to every
// dashboard, on this computer or another device on the same network.
//
// Same shape as the driver notice relay: a plain Node handler mounted on the
// Vite dev and preview servers. It keeps only the latest state, in memory.
//
// DEMO ONLY. There is no sign-in. A request from another device must carry the
// server's access key (see access.ts); this computer needs none. The state is
// synthetic settings and a clock, nothing else.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { isSimBroadcast, SIM_RELAY_PATH, takesControl, type SimBroadcast } from '../src/sim/live.ts'
import { ACCESS_REFUSED, type Access } from './access.ts'
import { lanUrls } from './driverNotices.ts'

export const SIM_MAX_BODY_BYTES = 2 * 1024

export interface SimRelayOptions {
  /** Where the server listens, to tell the page what a teammate should open. */
  listening?: () => AddressInfo | string | null
  heartbeatMs?: number
  /** The gate for requests from other devices. Without it every request is allowed. */
  access?: Access
}

export interface SimRelayHandler {
  (req: IncomingMessage, res: ServerResponse, next: () => void): void
  close(): void
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= SIM_MAX_BODY_BYTES) chunks.push(chunk)
    })
    req.on('end', () => resolve(size > SIM_MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function createSimRelay(options: SimRelayOptions = {}): SimRelayHandler {
  let state: SimBroadcast | null = null
  /** The simulation page the dashboards follow. */
  let controller: string | null = null
  const streams = new Set<ServerResponse>()
  const send = (res: ServerResponse, event: string) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify({ state })}\n\n`)

  const heartbeat = setInterval(() => {
    streams.forEach((res) => res.write(': keep-alive\n\n'))
  }, options.heartbeatMs ?? 15_000)
  heartbeat.unref()

  async function put(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return sendJson(res, 415, { error: 'Send the body as application/json.' })
    }
    const raw = await readBody(req)
    if (raw === null) return sendJson(res, 413, { error: 'Body is larger than 2 KB.' })
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return sendJson(res, 400, { error: 'Body is not valid JSON.' })
    }
    if (!isSimBroadcast(body)) return sendJson(res, 400, { error: 'Body is not a simulation state.' })
    // Heard, but not followed: another running page's repeats do not take over.
    if (takesControl(body, controller)) {
      controller = body.sender
      state = body
      streams.forEach((stream) => send(stream, 'state'))
    }
    res.writeHead(204, { 'Cache-Control': 'no-store' })
    res.end()
  }

  const handler = ((req, res, next) => {
    const { pathname } = new URL(req.url ?? '/', 'http://relay.invalid')
    const method = req.method ?? 'GET'
    if (pathname !== SIM_RELAY_PATH && pathname !== `${SIM_RELAY_PATH}/stream`) return next()
    if (options.access && !options.access.allows(req)) return sendJson(res, 401, ACCESS_REFUSED)
    if (pathname === SIM_RELAY_PATH) {
      if (method === 'GET') {
        return sendJson(res, 200, {
          state,
          lan_urls: lanUrls(options.listening?.() ?? null),
          // For the links a teammate opens. Only an allowed caller gets this far.
          ...(options.access ? { key: options.access.key } : {}),
        })
      }
      if (method === 'PUT') {
        put(req, res).catch(() => {
          if (!res.headersSent) sendJson(res, 400, { error: 'Could not read the simulation state.' })
        })
        return
      }
      return sendJson(res, 405, { error: 'Method not allowed.' })
    }
    if (pathname === `${SIM_RELAY_PATH}/stream`) {
      if (method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' })
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.write('retry: 2000\n\n')
      // The current state first, so a dashboard that connects late catches up.
      send(res, 'snapshot')
      streams.add(res)
      req.on('close', () => streams.delete(res))
      return
    }
    return next()
  }) as SimRelayHandler

  handler.close = () => {
    clearInterval(heartbeat)
    streams.forEach((stream) => stream.end())
    streams.clear()
  }
  return handler
}
