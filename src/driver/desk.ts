// The dispatcher's side of driver notices: what has been sent, for which
// decision, and whether that decision still stands. Lives outside the app
// reducer so src/state/ stays untouched (issue #34).

import type { Decision } from '../types.ts'
import type { Scenario } from '../viewModels.ts'
import { getNoticeChannel, type NoticeChannel } from './channel.ts'
import type { DriverNotice, DriverNoticeBody } from './types.ts'

export interface SentRecord {
  notice: DriverNotice
  /** The decision the notice was sent for; null after a dashboard reload. */
  decisionKey: string | null
}

export type DeskSnapshot = Readonly<Record<string, SentRecord>>

export interface NoticeDesk {
  subscribe(onChange: () => void): () => void
  getSnapshot(): DeskSnapshot
  /** The dispatcher pressed Send. Returns the notice that went out. */
  send(body: DriverNoticeBody, decisionKey: string): DriverNotice
  /**
   * Compare sent notices with the decisions that stand now (shipment id to
   * decision key). A sent notice whose decision changed or went away is
   * marked `under_revision` for the driver at once. Nothing new is sent.
   */
  reconcile(currentKeys: Readonly<Record<string, string>>): void
  /** Reset: remove every notice. */
  clear(): void
}

/** Identifies one committed decision in one scenario. */
export function decisionKey(decision: Decision, scenario: Scenario): string {
  return `${scenario}|${decision.option_kind}|${decision.status}|${decision.timestamp}`
}

export function decisionKeys(
  decisions: Readonly<Record<string, Decision>>,
  scenario: Scenario,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(decisions).map(([id, decision]) => [id, decisionKey(decision, scenario)]),
  )
}

export function createNoticeDesk(
  channel: NoticeChannel,
  now: () => string = () => new Date().toISOString(),
): NoticeDesk {
  // Notices left by an earlier dashboard session have no known decision, so
  // the first reconcile marks them as under revision.
  let snapshot: DeskSnapshot = Object.fromEntries(
    channel.all().map((notice) => [notice.shipment_id, { notice, decisionKey: null }]),
  )
  const subscribers = new Set<() => void>()

  function set(next: DeskSnapshot): void {
    snapshot = next
    subscribers.forEach((onChange) => onChange())
  }

  return {
    subscribe(onChange) {
      subscribers.add(onChange)
      return () => {
        subscribers.delete(onChange)
      }
    },
    getSnapshot: () => snapshot,
    send(body, key) {
      const previous = snapshot[body.shipment_id]?.notice
      const notice: DriverNotice = {
        ...body,
        state: 'active',
        version: (previous?.version ?? 0) + 1,
        sent_at: now(),
        replaces_sent_at: previous?.sent_at ?? null,
      }
      channel.publish(notice)
      set({ ...snapshot, [body.shipment_id]: { notice, decisionKey: key } })
      return notice
    },
    reconcile(currentKeys) {
      const stale = Object.values(snapshot).filter(
        ({ notice, decisionKey: key }) =>
          notice.state === 'active' && key !== (currentKeys[notice.shipment_id] ?? undefined),
      )
      if (stale.length === 0) return
      const next = { ...snapshot }
      for (const record of stale) {
        const notice: DriverNotice = { ...record.notice, state: 'under_revision' }
        channel.publish(notice)
        next[notice.shipment_id] = { ...record, notice }
      }
      set(next)
    },
    clear() {
      channel.clear()
      set({})
    },
  }
}

let shared: NoticeDesk | null = null

/** The dashboard's one desk. Created on first use. */
export function getDriverDesk(): NoticeDesk {
  shared ??= createNoticeDesk(getNoticeChannel())
  return shared
}

/** Reset on the dashboard clears every driver notice. */
export function clearDriverNotices(): void {
  getDriverDesk().clear()
}
