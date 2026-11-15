import { formatTime } from '../engine/time.ts'
import { SIM_SPEEDS, type SimClock as Clock, type SimSpeed } from './useSimClock.ts'
import { countTrucks, describeTruck, type TimingCase, type TruckPlan, type TruckState } from './trucks.ts'
import './SimClock.css'

const hhmm = (minutes: number) => formatTime(Math.floor(minutes))

interface TruckSummaryProps {
  time: number
  plans: TruckPlan[]
  states: TruckState[]
  segmentName: (segmentId: string) => string
  timingCase: TimingCase
}

/** Where the trucks are, in text: counts and one sentence per truck. */
function TruckSummary({ time, plans, states, segmentName, timingCase }: TruckSummaryProps) {
  const counts = countTrucks(states)
  const now = hhmm(time)
  return (
    <>
      <ul className="pp-sim__counts" aria-label={`Trucks at ${now}`}>
        <li>
          <strong className="pp-num">{counts.at_port}</strong> at the port
        </li>
        <li>
          <strong className="pp-num">{counts.moving}</strong> on the road
        </li>
        <li className={counts.waiting > 0 ? 'pp-sim__count--waiting' : undefined}>
          <strong className="pp-num">{counts.waiting}</strong> waiting at a closure
        </li>
        <li>
          <strong className="pp-num">{counts.arrived}</strong> arrived
        </li>
      </ul>
      <details className="pp-sim__details">
        <summary>Where each truck is at {now}</summary>
        <ul className="pp-sim__trucks">
          {plans.map((plan, i) => (
            <li key={plan.shipment_id}>
              <strong>{plan.shipment_id}</strong> {describeTruck(plan, states[i], segmentName)}
            </li>
          ))}
        </ul>
      </details>
      <p className="pp-sim__note">
        Positions come from the engine’s travel times, drawn at the {timingCase} end of each range.
      </p>
    </>
  )
}

export interface SimClockProps {
  clock: Clock
  /** Clock window, minutes since midnight. */
  start: number
  end: number
  plans: TruckPlan[]
  states: TruckState[]
  segmentName: (segmentId: string) => string
  /** Which end of the travel-time range the trucks are drawn at. */
  timingCase?: TimingCase
}

/** The simulation page's clock: play, pause and scrub the simulated day. */
export function SimClock({
  clock,
  start,
  end,
  plans,
  states,
  segmentName,
  timingCase = 'slow',
}: SimClockProps) {
  const now = hhmm(clock.time)
  return (
    <section className="pp-sim" aria-label="Truck simulation">
      <div className="pp-sim__controls">
        <button type="button" className="pp-button pp-button--primary pp-sim__play" onClick={clock.toggle}>
          {clock.running ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="pp-button" onClick={clock.restart}>
          Restart
        </button>
        <span className="pp-sim__time pp-num" aria-hidden="true">
          {now}
        </span>
        <label className="pp-sim__speed">
          Speed
          <select
            value={clock.speed}
            onChange={(event) => clock.setSpeed(Number(event.target.value) as SimSpeed)}
          >
            {SIM_SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {speed} min per second
              </option>
            ))}
          </select>
        </label>
      </div>
      <input
        className="pp-sim__slider"
        type="range"
        min={start}
        max={end}
        step={1}
        value={Math.floor(clock.time)}
        aria-label="Time of day"
        aria-valuetext={now}
        onChange={(event) => clock.seek(Number(event.target.value))}
      />
      <div className="pp-sim__range pp-num" aria-hidden="true">
        <span>{hhmm(start)}</span>
        <span>{hhmm(end)}</span>
      </div>
      <TruckSummary time={clock.time} plans={plans} states={states} segmentName={segmentName} timingCase={timingCase} />
    </section>
  )
}
