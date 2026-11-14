import { AlertIcon } from '../components/icons.tsx'
import type { DriverNoticeBody } from './types.ts'
import './driver.css'

export const NOT_MODELED_FOR_DRIVER = 'Not modeled: pay, legal driving hours.'

/**
 * The notice text. The dispatcher's preview and the driver page both render
 * this component from the same object, so the two cannot differ.
 */
export function NoticeBody({ body }: { body: DriverNoticeBody }) {
  return (
    <dl className="driver-notice">
      <div className="driver-notice__item">
        <dt>Delivery</dt>
        <dd>
          {body.destination_name}
          <br />
          Appointment <span className="pp-num">{body.appt_start}</span> to{' '}
          <span className="pp-num">{body.appt_end}</span>
        </dd>
      </div>
      <div className="driver-notice__item">
        <dt>What changed</dt>
        <dd>{body.what_changed}</dd>
      </div>
      <div className="driver-notice__item driver-notice__item--instruction">
        <dt>What to do</dt>
        <dd>
          <p className="driver-notice__instruction">{body.instruction}</p>
          {body.route_steps.length > 0 && (
            <ol className="driver-notice__steps" aria-label="Alternative route, in order">
              {body.route_steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
          {body.caution && (
            <p className="driver-notice__caution">
              <AlertIcon size={16} label="Caution" /> {body.caution}
            </p>
          )}
        </dd>
      </div>
      <div className="driver-notice__item">
        <dt>Why</dt>
        <dd>{body.reason}</dd>
      </div>
      {body.estimated_arrival && (
        <div className="driver-notice__item">
          <dt>Estimated arrival</dt>
          <dd>
            <span className="pp-num">{body.estimated_arrival}</span> (estimate)
          </dd>
        </div>
      )}
      <div className="driver-notice__item">
        <dt>Effect on you (SIMULATED)</dt>
        <dd>
          {body.driver_impact}
          <br />
          <span className="driver-notice__muted">{NOT_MODELED_FOR_DRIVER}</span>
        </dd>
      </div>
    </dl>
  )
}
