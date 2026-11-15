// Who may use the demo's network endpoints.
//
// The dev server can be started with `--host` so a teammate's laptop or a
// driver's phone on the same network can open the pages. That also puts the
// relays on the network. This module is the gate in front of them:
//
// - A request from this computer is always allowed.
// - A request from another device must carry the server's access key, which
//   is made fresh each time the server starts and travels in the links the
//   dispatcher's screen shows (`?k=...`).
//
// DEMO ONLY. A shared key in a link keeps a stranger on the same Wi-Fi out;
// it is not a sign-in, and everyone with the link has the same access.

import { randomInt, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const ACCESS_KEY_PARAM = 'k'
export const ACCESS_KEY_HEADER = 'x-routeripple-key'
const KEY_SHAPE = /^[A-Za-z0-9]{6,64}$/
// No 0/O or 1/l/I, so a key read aloud or typed from a screen is not mistaken.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

export interface Access {
  /** The key another device must send. Shown only to this computer's pages. */
  key: string
  allows(req: IncomingMessage): boolean
}

export interface AccessOptions {
  /** A fixed key, for example from RELAY_KEY. Ignored unless 6 to 64 letters and digits. */
  key?: string
  /** Whether the request comes from this computer. Tests pass their own. */
  isLocal?: (req: IncomingMessage) => boolean
}

/** True for 127.0.0.0/8 and ::1, including IPv4 addresses mapped into IPv6. */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false
  const plain = address.startsWith('::ffff:') ? address.slice(7) : address
  return plain === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(plain)
}

export function newAccessKey(length = 12): string {
  let key = ''
  for (let i = 0; i < length; i++) key += ALPHABET[randomInt(ALPHABET.length)]
  return key
}

function sameKey(given: string, key: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(key)
  return a.length === b.length && timingSafeEqual(a, b)
}

function givenKey(req: IncomingMessage): string | null {
  const header = req.headers[ACCESS_KEY_HEADER]
  if (typeof header === 'string' && header.length > 0) return header
  try {
    return new URL(req.url ?? '/', 'http://access.invalid').searchParams.get(ACCESS_KEY_PARAM)
  } catch {
    return null
  }
}

export function createAccess(options: AccessOptions = {}): Access {
  const key = options.key !== undefined && KEY_SHAPE.test(options.key) ? options.key : newAccessKey()
  const isLocal = options.isLocal ?? ((req) => isLoopback(req.socket.remoteAddress))
  return {
    key,
    allows(req) {
      if (isLocal(req)) return true
      const given = givenKey(req)
      return given !== null && sameKey(given, key)
    },
  }
}

export const ACCESS_REFUSED = {
  error: 'access_key_required',
  message: 'This server needs its access key. Open the link shown on the dispatcher’s screen.',
} as const

export const LOCAL_ONLY = {
  error: 'local_only',
  message: 'The AI is only available on the dispatcher’s own computer.',
} as const

/**
 * A guard for addresses that must never leave this computer, whatever key a
 * request carries: the AI endpoints, where every call spends the model key.
 * Requests for anything else, and requests from this computer, pass through.
 */
export function createLocalOnlyGuard(
  prefixes: readonly string[],
  isLocal: (req: IncomingMessage) => boolean = (req) => isLoopback(req.socket.remoteAddress),
) {
  return function guard(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    let pathname = '/'
    try {
      pathname = new URL(req.url ?? '/', 'http://guard.invalid').pathname
    } catch {
      // An address that cannot be read is not one of ours.
    }
    const guarded = prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    if (!guarded || isLocal(req)) return next()
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(LOCAL_ONLY))
  }
}
