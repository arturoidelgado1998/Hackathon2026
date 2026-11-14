// The one notice channel a page uses, created on first use.
// In the app it is the same-browser channel plus the relay (issue #35).
// Under test it is the same-browser channel alone, so no test makes a
// network call by accident; the relay channel has its own tests.

import { useSyncExternalStore } from 'react'
import { createBrowserChannel, type NoticeChannel } from './channel.ts'
import {
  createRelayedChannel,
  type RelayStatus,
  type RelayStatusSource,
} from './relayChannel.ts'

let shared: NoticeChannel | null = null
let relay: RelayStatusSource | null = null

export function getNoticeChannel(): NoticeChannel {
  if (!shared) {
    if (import.meta.env.MODE === 'test') {
      shared = createBrowserChannel()
    } else {
      const relayed = createRelayedChannel(createBrowserChannel())
      shared = relayed
      relay = relayed.relay
    }
  }
  return shared
}

const NO_RELAY: RelayStatus = { state: 'off', lostAt: null, lanUrls: [] }
const subscribeToNothing = () => () => {}

/** Whether notices also reach other devices. `off` when there is no relay. */
export function useRelayStatus(source: RelayStatusSource | null = sharedRelay()): RelayStatus {
  return useSyncExternalStore(
    source ? source.subscribe : subscribeToNothing,
    source ? source.getStatus : () => NO_RELAY,
  )
}

function sharedRelay(): RelayStatusSource | null {
  getNoticeChannel()
  return relay
}
