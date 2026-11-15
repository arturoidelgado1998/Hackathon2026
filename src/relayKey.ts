// The access key a device on the network needs for the demo's relays.
//
// The dispatcher's own computer needs none. A teammate's laptop or a driver's
// phone opens a link that carries the key (`?k=...`); it is read here once,
// as the page loads and before anything rewrites the address bar, and kept
// for the tab so the page's own links keep working.
// No imports: every page that talks to a relay loads this first.

const PARAM = 'k'
const STORE = 'routeripple-relay-key'
const SHAPE = /^[A-Za-z0-9]{6,64}$/

function read(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const fromLink = new URLSearchParams(window.location.search).get(PARAM)
    if (fromLink !== null && SHAPE.test(fromLink)) {
      window.sessionStorage.setItem(STORE, fromLink)
      return fromLink
    }
    const kept = window.sessionStorage.getItem(STORE)
    return kept !== null && SHAPE.test(kept) ? kept : null
  } catch {
    // No storage (private mode): the key still works for this page load.
    return null
  }
}

const key = read()

/** The key this page was opened with, or null on the dispatcher's own computer. */
export function relayKey(): string | null {
  return key
}

/** A relay address with the key added, when this page has one. */
export function withRelayKey(url: string, withKey: string | null = key): string {
  if (withKey === null) return url
  return `${url}${url.includes('?') ? '&' : '?'}${PARAM}=${encodeURIComponent(withKey)}`
}

/** A link for another device: a page address with the server's key in its query. */
export function keyedLink(base: string, query: string, hash: string, serverKey: string | null): string {
  const parts = [query, serverKey ? `${PARAM}=${encodeURIComponent(serverKey)}` : ''].filter(Boolean)
  return `${base}${parts.length > 0 ? `?${parts.join('&')}` : ''}${hash ? `#${hash}` : ''}`
}
