import { AlertIcon, CheckIcon } from '../components/icons.tsx'
import { NoticeBody } from './NoticeBody.tsx'
import { formatSentTime, type DriverNotice, type DriverNoticeBody } from './types.ts'
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
      {draft ? (
        <details className="driver-panel__preview">
          <summary>
            Text the driver will get: <q>{draft.instruction}</q>
          </summary>
          <NoticeBody body={draft} />
        </details>
      ) : (
        <p className="driver-panel__note">
          No response is chosen for this shipment, so there is nothing new to send.
        </p>
      )}
      <p className="driver-panel__note">
        SIMULATED: no real message is sent. Nothing goes to the driver on Preview or when a
        response is chosen, only on Send.
      </p>
    </section>
  )
}
