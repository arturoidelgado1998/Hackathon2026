import { useEffect, useState, useSyncExternalStore } from 'react'
import { AlertIcon, CheckIcon } from '../components/icons.tsx'
import { getShipment, shipments } from '../data/index.ts'
import { getNoticeChannel, type NoticeChannel } from './channel.ts'
import { NoticeBody } from './NoticeBody.tsx'
import { formatSentTime, type DriverNotice } from './types.ts'
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

/** Mounted once per shipment id, so the first read happens in the initializer. */
function ShipmentNotice({ shipmentId, channel }: { shipmentId: string; channel: NoticeChannel }) {
  const [notice, setNotice] = useState(() => channel.latest(shipmentId))
  useEffect(() => channel.subscribe(shipmentId, setNotice), [channel, shipmentId])

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
        </>
      )}
    </div>
  )
}

export interface DriverPageProps {
  /** Defaults to the page's shared channel. Tests pass their own. */
  channel?: NoticeChannel
}

/** What one driver sees for one shipment: `/driver.html#S-01`. Read-only. */
export function DriverPage({ channel = getNoticeChannel() }: DriverPageProps) {
  const shipmentId = useSyncExternalStore(subscribeToHash, readHash)
  const known = shipmentId !== '' && getShipment(shipmentId) !== undefined

  return (
    <div className="driver-page">
      <header className="driver-page__header">
        <p className="driver-page__product">PortPlan</p>
        <h1 className="driver-page__title">
          Driver notice{known && <span className="pp-num"> · {shipmentId}</span>}
        </h1>
      </header>
      <p className="driver-page__simulated">{SIMULATED_NOTICE_TEXT}</p>
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
