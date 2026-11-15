import { useEffect, useState, useSyncExternalStore } from 'react'
import { Brand } from '../components/brand/Brand.tsx'
import { AlertIcon, CheckIcon } from '../components/icons.tsx'
import { getShipment, shipments } from '../data/index.ts'
import type { NoticeChannel } from './channel.ts'
import { NoticeBody } from './NoticeBody.tsx'
import type { RelayStatus, RelayStatusSource } from './relayChannel.ts'
import { getNoticeChannel, useRelayStatus } from './sharedChannel.ts'
import {
  REPLY_LABELS,
  formatSentTime,
  replyAnswers,
  type DriverNotice,
  type DriverReply,
  type DriverReplyKind,
} from './types.ts'
import './driver.css'

export const SIMULATED_NOTICE_TEXT = 'SIMULATED notice: demo only, no real message was sent.'
export const REVISION_TEXT = 'Dispatch is revising this notice. A new one will follow.'

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function readHash(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1))
  } catch {
    return window.location.hash.slice(1)
  }
}

function ShipmentLinks() {
  return (
    <nav aria-label="Shipments">
      <ul className="driver-page__links">
        {shipments.map((shipment) => (
          <li key={shipment.id}>
            <a href={`#${shipment.id}`}>{shipment.id}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function NoticeStatus({ notice }: { notice: DriverNotice }) {
  if (notice.state === 'under_revision') {
    return (
      <div className="driver-page__status driver-page__status--revision">
        <AlertIcon size={18} />
        <p>
          <strong>Being revised.</strong> {REVISION_TEXT}
        </p>
      </div>
    )
  }
  return (
    <div className="driver-page__status driver-page__status--active">
      <CheckIcon size={18} />
      <p>
        <strong>Notice from dispatch.</strong> Version {notice.version}, sent{' '}
        <span className="pp-num">{formatSentTime(notice.sent_at)}</span>.
        {notice.replaces_sent_at && (
          <>
            {' '}
            Updated: replaces the notice sent at{' '}
            <span className="pp-num">{formatSentTime(notice.replaces_sent_at)}</span>.
          </>
        )}
      </p>
    </div>
  )
}

const REPLY_KINDS: DriverReplyKind[] = ['received', 'cannot_do_safely']

/**
 * Two fixed answers and no free text (issue #36). A reply tells dispatch
 * something; it never changes the plan by itself.
 */
function ReplyToDispatch({
  reply,
  onReply,
}: {
  reply: DriverReply | null
  onReply: (kind: DriverReplyKind) => void
}) {
  return (
    <section className="driver-page__reply" aria-label="Reply to dispatch">
      <h2 className="driver-page__reply-title">Reply to dispatch</h2>
      <div className="driver-page__reply-buttons">
        {REPLY_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="pp-button"
            aria-pressed={reply?.kind === kind}
            onClick={() => onReply(kind)}
          >
            {kind === 'received' ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
            {REPLY_LABELS[kind]}
          </button>
        ))}
      </div>
      <p className="driver-page__reply-status" role="status">
        {reply ? (
          <>
            You replied <q>{REPLY_LABELS[reply.kind]}</q> at{' '}
            <span className="pp-num">{formatSentTime(reply.replied_at)}</span>.
          </>
        ) : (
          'No reply sent yet.'
        )}
      </p>
      <p className="driver-page__reply-note">
        A reply does not change the plan. Dispatch decides what happens next.
      </p>
    </section>
  )
}

/** Mounted once per shipment id, so the first read happens in the initializer. */
function ShipmentNotice({ shipmentId, channel }: { shipmentId: string; channel: NoticeChannel }) {
  const [notice, setNotice] = useState(() => channel.latest(shipmentId))
  const [lastReply, setLastReply] = useState(() => channel.latestReply(shipmentId))
  useEffect(() => channel.subscribe(shipmentId, setNotice), [channel, shipmentId])
  // Only a reply to the notice on screen counts; an older one is not shown.
  const reply = replyAnswers(lastReply, notice) ? lastReply : null

  function sendReply(kind: DriverReplyKind) {
    if (!notice || notice.state !== 'active') return
    const next: DriverReply = {
      shipment_id: shipmentId,
      notice_version: notice.version,
      notice_sent_at: notice.sent_at,
      kind,
      replied_at: new Date().toISOString(),
    }
    channel.reply(next)
    setLastReply(next)
  }

  return (
    <div aria-live="polite">
      {notice === null ? (
        <p className="driver-page__empty">No notice from dispatch for {shipmentId}.</p>
      ) : (
        <>
          <NoticeStatus notice={notice} />
          <section
            className={
              notice.state === 'under_revision'
                ? 'driver-page__card driver-page__card--revision'
                : 'driver-page__card'
            }
            aria-label={
              notice.state === 'under_revision' ? 'Earlier notice, being revised' : 'Notice'
            }
          >
            {notice.state === 'under_revision' && (
              <p className="driver-page__earlier">
                Earlier notice (being revised), version {notice.version}, sent{' '}
                <span className="pp-num">{formatSentTime(notice.sent_at)}</span>
              </p>
            )}
            <NoticeBody body={notice} />
          </section>
          {notice.state === 'active' && <ReplyToDispatch reply={reply} onReply={sendReply} />}
        </>
      )}
    </div>
  )
}

/** Says in words when the link to dispatch is down, so a stale notice is not trusted. */
function Connection({ status }: { status: RelayStatus }) {
  if (status.state === 'lost') {
    return (
      <p className="driver-page__connection driver-page__connection--lost" role="alert">
        <AlertIcon size={18} />
        <span>
          <strong>Connection lost</strong>
          {status.lostAt && (
            <>
              {' '}
              at <span className="pp-num">{formatSentTime(status.lostAt)}</span>
            </>
          )}
          : this notice may be out of date. Reconnecting.
        </span>
      </p>
    )
  }
  if (status.state === 'live') {
    return <p className="driver-page__connection">Connected to dispatch. Updates appear here.</p>
  }
  return null
}

export interface DriverPageProps {
  /** Defaults to the page's shared channel. Tests pass their own. */
  channel?: NoticeChannel
  /** Defaults to the shared channel's relay. Tests pass their own. */
  relay?: RelayStatusSource | null
}

/** What one driver sees for one shipment: `/driver.html#S-01`. Read-only. */
export function DriverPage({ channel = getNoticeChannel(), relay }: DriverPageProps) {
  const shipmentId = useSyncExternalStore(subscribeToHash, readHash)
  const connection = useRelayStatus(relay)
  const known = shipmentId !== '' && getShipment(shipmentId) !== undefined

  return (
    <div className="driver-page">
      <header className="driver-page__header">
        <p className="driver-page__product"><Brand /></p>
        <h1 className="driver-page__title">
          Driver notice{known && <span className="pp-num"> · {shipmentId}</span>}
        </h1>
      </header>
      <p className="driver-page__simulated">{SIMULATED_NOTICE_TEXT}</p>
      <Connection status={connection} />
      <main className="driver-page__main">
        {known ? (
          <ShipmentNotice key={shipmentId} shipmentId={shipmentId} channel={channel} />
        ) : (
          <div className="driver-page__empty">
            <p>
              {shipmentId === ''
                ? 'No shipment chosen. Pick the shipment you are carrying.'
                : `Unknown shipment "${shipmentId}". Pick the shipment you are carrying.`}
            </p>
            <ShipmentLinks />
          </div>
        )}
      </main>
      <footer className="driver-page__footer">
        <p>Read only when parked.</p>
        <p>This plan does not ask you to make up time.</p>
      </footer>
    </div>
  )
}
