import { AlertIcon, CheckIcon } from '../components/icons.tsx'
import { keyedLink } from '../relayKey.ts'
import { NoticeBody } from './NoticeBody.tsx'
import type { RelayStatus } from './relayChannel.ts'
import {
  REPLY_LABELS,
  formatSentTime,
  type DriverNotice,
  type DriverNoticeBody,
  type DriverReply,
} from './types.ts'
import './driver.css'

export interface DriverNoticePanelProps {
  shipmentId: string
  /** The text Send would deliver now; null when there is nothing to send. */
  draft: DriverNoticeBody | null
  /** The last notice sent for this shipment, if any. */
  sent?: DriverNotice
  /** True when `sent` matches the decision that stands now. */
  isCurrent: boolean
  onSend?: () => void
  /** Whether a notice also reaches other devices (issue #35). */
  phone?: RelayStatus
  /** The driver's answer to the notice that stands now (issue #36). */
  reply?: DriverReply | null
  /** Why there is nothing to send, when it is not for want of a chosen response. */
  nothingToSend?: string
}

/** What the driver said. It informs the dispatcher and changes nothing by itself. */
function DriverReplyLine({ reply }: { reply: DriverReply }) {
  const time = <span className="pp-num">{formatSentTime(reply.replied_at)}</span>
  if (reply.kind === 'received') {
    return (
      <p className="driver-panel__reply" data-testid="driver-reply">
        <CheckIcon size={14} /> Driver replied <q>{REPLY_LABELS.received}</q> at {time}
      </p>
    )
  }
  return (
    <p className="driver-panel__reply driver-panel__reply--concern" data-testid="driver-reply">
      <AlertIcon size={14} />
      <span>
        <strong>Driver flagged a concern</strong> at {time}:{' '}
        <q>{REPLY_LABELS.cannot_do_safely}</q>. The decision is unchanged; you decide what to do.
      </span>
    </p>
  )
}

function Status({ sent, isCurrent }: Pick<DriverNoticePanelProps, 'sent' | 'isCurrent'>) {
  if (!sent) return <>Not sent</>
  const time = <span className="pp-num">{formatSentTime(sent.sent_at)}</span>
  if (isCurrent) {
    return (
      <>
        <CheckIcon size={14} /> Sent {time} (version {sent.version})
      </>
    )
  }
  return (
    <>
      <AlertIcon size={14} /> Changed since sent at {time}: the driver sees "being revised"
    </>
  )
}

function PhoneDelivery({ phone, shipmentId }: { phone: RelayStatus; shipmentId: string }) {
  if (phone.state === 'checking') return null
  if (phone.state !== 'live') {
    return (
      <p className="driver-panel__note" data-testid="phone-delivery">
        <AlertIcon size={12} /> Phone delivery unavailable: same browser only.
      </p>
    )
  }
  if (phone.lanUrls.length === 0) {
    return (
      <p className="driver-panel__note" data-testid="phone-delivery">
        Phone delivery: this computer only. Start the server with <code>--host</code> to reach a
        phone on the same network.
      </p>
    )
  }
  return (
    <p className="driver-panel__note" data-testid="phone-delivery">
      Phone delivery is on. On a phone on the same network, open{' '}
      {phone.lanUrls.map((url, index) => (
        <span key={url}>
          {index > 0 && ' or '}
          <code className="driver-panel__url">
            {keyedLink(`${url}/driver.html`, '', encodeURIComponent(shipmentId), phone.key ?? null)}
          </code>
        </span>
      ))}
    </p>
  )
}

/**
 * The dispatcher's control for one shipment's driver notice. Sending is its
 * own step: choosing or previewing a response never notifies the driver.
 */
export function DriverNoticePanel({
  shipmentId,
  draft,
  sent,
  isCurrent,
  onSend,
  phone,
  reply,
  nothingToSend,
}: DriverNoticePanelProps) {
  const canSend = draft !== null && onSend !== undefined && !isCurrent
  return (
    <section className="driver-panel" aria-label="Driver notice">
      <div className="driver-panel__row">
        <div className="driver-panel__heading">
          <h3 className="driver-panel__title">Driver notice for {shipmentId}</h3>
          <p className="driver-panel__status" aria-live="polite" data-testid="driver-notice-status">
            <Status sent={sent} isCurrent={isCurrent} />
          </p>
        </div>
        <div className="driver-panel__actions">
          <a
            className="driver-panel__link"
            href={`driver.html#${encodeURIComponent(shipmentId)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open driver page
          </a>
          <button
            type="button"
            className="pp-button pp-button--primary"
            disabled={!canSend}
            onClick={onSend}
          >
            {sent ? 'Send update to driver' : 'Send to driver'}
          </button>
        </div>
      </div>
      {reply && <DriverReplyLine reply={reply} />}
      {draft ? (
        <details className="driver-panel__preview">
          <summary>
            Text the driver will get: <q>{draft.instruction}</q>
          </summary>
          <NoticeBody body={draft} />
        </details>
      ) : (
        <p className="driver-panel__note">
          {nothingToSend ??
            'No response is chosen for this shipment, so there is nothing new to send.'}
        </p>
      )}
      {phone && <PhoneDelivery phone={phone} shipmentId={shipmentId} />}
      <p className="driver-panel__note">
        Nothing goes to the driver on Preview or when a
        response is chosen, only on Send.
      </p>
    </section>
  )
}
