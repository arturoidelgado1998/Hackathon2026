// Sends and receives the live simulation state in the browser: through the
// relay on the app's own server (other devices) and a BroadcastChannel (other
// tabs in this browser, even when the relay is not there).

import { isSimBroadcast, SIM_CHANNEL, SIM_RELAY_PATH, takesControl, type SimBroadcast } from './live.ts'

function openChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SIM_CHANNEL)
  } catch {
    return null
  }
}

let outgoing: BroadcastChannel | null | undefined

export function publishSim(state: SimBroadcast): void {
  if (outgoing === undefined) {
    outgoing = openChannel()
    // In tests a channel must not keep the process alive.
    ;(outgoing as unknown as { unref?: () => void } | null)?.unref?.()
  }
  try {
    outgoing?.postMessage(state)
  } catch {
    // A closed channel only loses same-browser delivery.
  }
  if (typeof fetch !== 'function') return
  try {
    void fetch(SIM_RELAY_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // No relay (for example a static copy of the app): same-browser tabs still follow.
  }
}

/** Calls back with each new state. Returns a function that stops listening. */
export function subscribeSim(onState: (state: SimBroadcast) => void): () => void {
  const latest = new Map<string, number>()
  let controller: string | null = null
  const accept = (value: unknown) => {
    if (!isSimBroadcast(value)) return
    if (!takesControl(value, controller)) return
    // The same message can arrive by both paths; an older one must never win.
    if ((latest.get(value.sender) ?? -Infinity) >= value.seq) return
    latest.set(value.sender, value.seq)
    controller = value.sender
    onState(value)
  }

  const channel = openChannel()
  const onMessage = (event: MessageEvent) => accept(event.data)
  channel?.addEventListener('message', onMessage)

  let source: EventSource | null = null
  if (typeof EventSource !== 'undefined') {
    const onEvent = (event: MessageEvent) => {
      try {
        accept((JSON.parse(event.data as string) as { state?: unknown }).state)
      } catch {
        // Ignore a malformed event.
      }
    }
    source = new EventSource(`${SIM_RELAY_PATH}/stream`)
    source.addEventListener('snapshot', onEvent)
    source.addEventListener('state', onEvent)
  }

  return () => {
    channel?.removeEventListener('message', onMessage)
    channel?.close()
    source?.close()
  }
}

/** Addresses a teammate on the same network can open; [] when the server is local-only. */
export async function fetchLanUrls(): Promise<string[]> {
  try {
    const response = await fetch(SIM_RELAY_PATH, { headers: { Accept: 'application/json' } })
    if (!response.ok) return []
    const body = (await response.json()) as { lan_urls?: unknown }
    return Array.isArray(body.lan_urls) ? body.lan_urls.filter((u): u is string => typeof u === 'string') : []
  } catch {
    return []
  }
}
