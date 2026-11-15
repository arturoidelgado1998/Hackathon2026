// The HTTP side of the AI endpoints: reading an incident report, suggesting a
// response, and reporting health. Kept apart from index.ts so tests can run it
// on any port.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { interpretReport, type InterpretDeps, type InterpretFailure } from './interpret.ts'
import { suggestResponse } from './suggest.ts'

/** A report is at most 2,000 characters and option facts are smaller; this leaves room for JSON. */
const MAX_BODY_BYTES = 16 * 1024

const STATUS: Record<InterpretFailure['code'], number> = {
  bad_request: 400,
  not_configured: 503,
  model_unreachable: 502,
  model_rejected: 502,
  invalid_model_response: 422,
}

/** Every model call spends the key, so the server caps how many it makes. */
export const DEFAULT_MAX_PER_MINUTE = 30

export interface AppDeps extends InterpretDeps {
  /** One line per request: the outcome and how long it took. Never the report, never the key. */
  log?: (line: string) => void
  /** Most model calls in any 60 seconds, across both routes. Defaults to 30. */
  maxPerMinute?: number
  /** The clock, for tests. */
  now?: () => number
}

function send(response: ServerResponse, status: number, body: object, headers: Record<string, string> = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

function readBody(request: IncomingMessage): Promise<{ ok: true; text: string } | { ok: false }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) tooLarge = true
      else chunks.push(chunk)
    })
    request.on('end', () => resolve(tooLarge ? { ok: false } : { ok: true, text: Buffer.concat(chunks).toString('utf8') }))
    request.on('error', () => resolve({ ok: false }))
  })
}

/** The request handler for `http.createServer`. */
export function createApp(deps: AppDeps) {
  const log = deps.log ?? (() => {})
  const limit = deps.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE
  const now = deps.now ?? Date.now
  /** When each recent model call was let through. */
  let recent: number[] = []

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname

    if (path === '/health') {
      if (request.method !== 'GET') return send(response, 405, { error: 'method_not_allowed' }, { Allow: 'GET' })
      return send(response, 200, {
        ok: true,
        ai_configured: deps.config !== null,
        provider: deps.config?.provider ?? null,
        model: deps.config?.model ?? null,
      })
    }

    const route = path === '/incident/interpret' ? 'interpret' : path === '/shipment/suggest' ? 'suggest' : null
    if (route === null) return send(response, 404, { error: 'not_found', message: 'No such route.' })
    if (request.method !== 'POST') {
      return send(response, 405, { error: 'method_not_allowed', message: 'Use POST.' }, { Allow: 'POST' })
    }

    // A runaway page or script must not be able to run up the model bill.
    const at = now()
    recent = recent.filter((time) => at - time < 60_000)
    if (recent.length >= limit) {
      const wait = Math.max(1, Math.ceil((60_000 - (at - recent[0])) / 1000))
      log(`${route} rate_limited`)
      request.resume()
      return send(
        response,
        429,
        { error: 'rate_limited', message: `Too many AI requests in a minute. Try again in ${wait} seconds.` },
        { 'Retry-After': String(wait) },
      )
    }
    recent.push(at)

    const started = Date.now()
    const body = await readBody(request)
    if (!body.ok) {
      log(`${route} bad_request (body too large)`)
      return send(response, 413, { error: 'bad_request', message: 'The request is too large.' })
    }
    let sent: { report?: unknown; facts?: unknown } | null
    try {
      sent = JSON.parse(body.text) as { report?: unknown; facts?: unknown } | null
    } catch {
      log(`${route} bad_request (not JSON)`)
      const shape = route === 'interpret' ? '{ "report": "..." }' : '{ "facts": { ... } }'
      return send(response, 400, { error: 'bad_request', message: `Send JSON: ${shape}.` })
    }

    const result = route === 'interpret' ? await interpretReport(sent?.report, deps) : await suggestResponse(sent?.facts, deps)
    const took = `${Date.now() - started} ms`
    if (result.ok) {
      log(`${route} ok (${took})`)
      return send(
        response,
        200,
        'interpretation' in result ? { interpretation: result.interpretation } : { suggestion: result.suggestion },
      )
    }
    log(`${route} ${result.code} (${took})`)
    return send(response, STATUS[result.code], {
      error: result.code,
      message: result.message,
      ...('details' in result && result.details ? { details: result.details } : {}),
    })
  }
}
