// How a sent notice gets from the dashboard to the driver page.
// This first channel works between windows of ONE browser on one machine:
// BroadcastChannel for live updates, localStorage so a driver page opened
// after Send still shows the latest notice. A phone on another device needs
// the relay channel from issue #35 (N2), which implements the same interface.

import { isDriverNotice, type DriverNotice } from './types.ts'

/** Called with the latest notice for a shipment, or null when it is cleared. */
export type NoticeListener = (notice: DriverNotice | null) => void

export interface NoticeChannel {
  /** Send or replace the notice for its shipment. */
  publish(notice: DriverNotice): void
  /** Remove every notice (Reset). */
  clear(): void
  latest(shipmentId: string): DriverNotice | null
  all(): DriverNotice[]
  subscribe(shipmentId: string, listener: NoticeListener): () => void
}

export const STORAGE_PREFIX = 'portplan.driver-notice.'
const BROADCAST_NAME = 'portplan-driver-notices'

type Message = { type: 'notice'; notice: DriverNotice } | { type: 'clear' }

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
  const broadcast =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(BROADCAST_NAME)

  function notify(shipmentId: string, notice: DriverNotice | null): void {
    listeners.get(shipmentId)?.forEach((listener) => listener(notice))
  }

  function notifyAllCleared(): void {
    listeners.forEach((set) => set.forEach((listener) => listener(null)))
  }

  function storedKeys(): string[] {
    try {
      return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
        (key): key is string => key !== null && key.startsWith(STORAGE_PREFIX),
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
      for (const key of storedKeys()) {
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
  }
}

let shared: NoticeChannel | null = null

/** The one channel a page uses. Created on first use. */
export function getNoticeChannel(): NoticeChannel {
  shared ??= createBrowserChannel()
  return shared
}
