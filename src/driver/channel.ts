// How a sent notice gets from the dashboard to the driver page.
// This first channel works between windows of ONE browser on one machine:
// BroadcastChannel for live updates, localStorage so a driver page opened
// after Send still shows the latest notice. A phone on another device is
// reached by relayChannel.ts (issue #35), which wraps this channel.

import { isDriverNotice, isDriverReply, type DriverNotice, type DriverReply } from './types.ts'

/** Called with the latest notice for a shipment, or null when it is cleared. */
export type NoticeListener = (notice: DriverNotice | null) => void

/** Called with each reply a driver sends, for any shipment. */
export type ReplyListener = (reply: DriverReply) => void

export interface NoticeChannel {
  /** Send or replace the notice for its shipment. */
  publish(notice: DriverNotice): void
  /** Remove every notice (Reset). */
  clear(): void
  latest(shipmentId: string): DriverNotice | null
  all(): DriverNotice[]
  subscribe(shipmentId: string, listener: NoticeListener): () => void
  /** The driver answers a notice (issue #36). */
  reply(reply: DriverReply): void
  latestReply(shipmentId: string): DriverReply | null
  /** Replies for every shipment: the dashboard listens to all of them. */
  subscribeReplies(listener: ReplyListener): () => void
}

export const STORAGE_PREFIX = 'portplan.driver-notice.'
export const REPLY_PREFIX = 'portplan.driver-reply.'
const BROADCAST_NAME = 'portplan-driver-notices'

type Message =
  | { type: 'notice'; notice: DriverNotice }
  | { type: 'reply'; reply: DriverReply }
  | { type: 'clear' }

function parseReply(raw: string | null): DriverReply | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isDriverReply(value) ? value : null
  } catch {
    return null
  }
}

function parseNotice(raw: string | null): DriverNotice | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isDriverNotice(value) ? value : null
  } catch {
    return null
  }
}

/** Same-browser channel. Storage errors (private mode, quota) are ignored. */
export function createBrowserChannel(storage: Storage = window.localStorage): NoticeChannel {
  const listeners = new Map<string, Set<NoticeListener>>()
  const replyListeners = new Set<ReplyListener>()
  const notifyReply = (reply: DriverReply) => replyListeners.forEach((listener) => listener(reply))
  const broadcast =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(BROADCAST_NAME)

  function notify(shipmentId: string, notice: DriverNotice | null): void {
    listeners.get(shipmentId)?.forEach((listener) => listener(notice))
  }

  function notifyAllCleared(): void {
    listeners.forEach((set) => set.forEach((listener) => listener(null)))
  }

  function storedKeys(prefix: string = STORAGE_PREFIX): string[] {
    try {
      return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
        (key): key is string => key !== null && key.startsWith(prefix),
      )
    } catch {
      return []
    }
  }

  function latest(shipmentId: string): DriverNotice | null {
    try {
      return parseNotice(storage.getItem(STORAGE_PREFIX + shipmentId))
    } catch {
      return null
    }
  }

  if (broadcast) {
    broadcast.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data as Partial<Message> | null
      if (message?.type === 'clear') notifyAllCleared()
      else if (message?.type === 'notice' && isDriverNotice(message.notice)) {
        notify(message.notice.shipment_id, message.notice)
      } else if (message?.type === 'reply' && isDriverReply(message.reply)) {
        notifyReply(message.reply)
      }
    }
  }

  // Fallback for browsers without BroadcastChannel: other windows get a
  // storage event for every write. A repeat of the same notice is harmless.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.storageArea !== storage) return
      if (event.key === null) notifyAllCleared()
      else if (event.key.startsWith(STORAGE_PREFIX)) {
        notify(event.key.slice(STORAGE_PREFIX.length), parseNotice(event.newValue))
      } else if (event.key.startsWith(REPLY_PREFIX)) {
        const reply = parseReply(event.newValue)
        if (reply) notifyReply(reply)
      }
    })
  }

  return {
    publish(notice) {
      try {
        storage.setItem(STORAGE_PREFIX + notice.shipment_id, JSON.stringify(notice))
      } catch {
        // Live delivery below still works without storage.
      }
      notify(notice.shipment_id, notice)
      broadcast?.postMessage({ type: 'notice', notice } satisfies Message)
    },
    clear() {
      for (const key of [...storedKeys(), ...storedKeys(REPLY_PREFIX)]) {
        try {
          storage.removeItem(key)
        } catch {
          // Nothing else to do: the live message below still clears open pages.
        }
      }
      notifyAllCleared()
      broadcast?.postMessage({ type: 'clear' } satisfies Message)
    },
    latest,
    all() {
      return storedKeys()
        .map((key) => latest(key.slice(STORAGE_PREFIX.length)))
        .filter((notice): notice is DriverNotice => notice !== null)
    },
    subscribe(shipmentId, listener) {
      const set = listeners.get(shipmentId) ?? new Set<NoticeListener>()
      listeners.set(shipmentId, set)
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    reply(reply) {
      try {
        storage.setItem(REPLY_PREFIX + reply.shipment_id, JSON.stringify(reply))
      } catch {
        // Live delivery below still works without storage.
      }
      notifyReply(reply)
      broadcast?.postMessage({ type: 'reply', reply } satisfies Message)
    },
    latestReply(shipmentId) {
      try {
        return parseReply(storage.getItem(REPLY_PREFIX + shipmentId))
      } catch {
        return null
      }
    },
    subscribeReplies(listener) {
      replyListeners.add(listener)
      return () => {
        replyListeners.delete(listener)
      }
    },
  }
}
