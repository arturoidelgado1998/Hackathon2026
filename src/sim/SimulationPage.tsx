import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { RiskBadge } from '../components/board/RiskBadge.tsx'
import { Brand } from '../components/brand/Brand.tsx'
import { facilities, getSegment, routes, segments } from '../data/index.ts'
import { formatTime, parseTime } from '../engine/time.ts'
import { MapBoundary } from '../map/MapPanel.tsx'
import { runSimulation, type SimRow } from '../state/simulation.ts'
import { SimClock } from './SimClock.tsx'
import type { SimBroadcast } from './live.ts'
import { fetchLanUrls, publishSim } from './liveChannel.ts'
import {
  parseSettings,
  serializeSettings,
  type SimResponse,
  type SimSettings,
} from './settings.ts'
import { describeTruck, simWindow, truckStateAt, type TimingCase } from './trucks.ts'
import { useSimClock } from './useSimClock.ts'
import './SimulationPage.css'

// Loaded on demand, as on the dashboard. If it cannot load, the table still
// says where every truck is.
const ArcgisMap = lazy(() => import('../map/ArcgisMap.tsx'))

const segmentIds = segments.map((segment) => segment.id)

// One id per open simulation page, and a counter that keeps rising across reloads.
const SENDER = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
let sequence = Date.now()
const segmentName = (id: string) => getSegment(id)?.name ?? id

function arrival(row: SimRow): string {
  if (row.arrival_min === null && row.arrival_max === null) return 'Unknown'
  if (row.arrival_min === row.arrival_max) return row.arrival_max!
  return `${row.arrival_min ?? 'unknown'} to ${row.arrival_max ?? 'unknown'}`
}

function lateness(row: SimRow): string {
  if (row.lateness_max === null) return 'Unknown'
  if (row.lateness_max === 0) return 'Meets window'
  return row.lateness_min === row.lateness_max
    ? `${row.lateness_max} min late`
    : `${row.lateness_min ?? 0} to ${row.lateness_max} min late`
}

/** The truck simulation on its own page: settings, Start, map and outcomes. */
export function SimulationPage() {
  const [settings, setSettings] = useState<SimSettings>(() =>
    parseSettings(window.location.search, segmentIds),
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mapFailed, setMapFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  const run = useMemo(() => runSimulation(settings), [settings])
  const range = useMemo(() => simWindow(run.plans), [run.plans])
  const clock = useSimClock(range.start, range.end, settings.speed)
  const states = useMemo(
    () => run.plans.map((plan) => truckStateAt(plan, clock.time, segments)),
    [run.plans, clock.time],
  )

  // The address bar always holds a link to the current setup.
  const query = serializeSettings({ ...settings, speed: clock.speed })
  useEffect(() => {
    window.history.replaceState(null, '', `?${query}`)
  }, [query])

  // A teammate cannot open "localhost", so the link uses this computer's
  // network address when the server is reachable from other devices.
  const [lanUrl, setLanUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetchLanUrls().then((urls) => {
      if (!cancelled && urls.length > 0) setLanUrl(urls[0])
    })
    return () => {
      cancelled = true
    }
  }, [])
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  const origin = local && lanUrl ? lanUrl : window.location.origin
  const link = `${origin}${window.location.pathname}?${query}`

  // Broadcast the setup and the clock so every open dashboard follows this page:
  // at once on any change, and once a second while the clock runs.
  const canRun = run.error === null
  // The run has begun once the clock has moved off the start of the day.
  const started = clock.running || Math.floor(clock.time) > range.start
  const latest = useRef<Omit<SimBroadcast, 'seq'> | null>(null)
  useEffect(() => {
    latest.current = canRun
      ? { v: 1, sender: SENDER, query, time: clock.time, running: clock.running, started, speed: clock.speed }
      : null
  })
  const publish = () => {
    if (latest.current) publishSim({ ...latest.current, seq: ++sequence })
  }
  const pausedAt = clock.running ? 'running' : String(Math.floor(clock.time))
  useEffect(publish, [query, canRun, clock.running, pausedAt])
  useEffect(() => {
    if (!clock.running) return
    const id = setInterval(publish, 1000)
    return () => clearInterval(id)
  }, [clock.running])

  const update = (change: Partial<SimSettings>) => {
    setCopied(false)
    setSettings((current) => ({ ...current, ...change }))
  }

  // The road is drawn closed only between the closing and reopening times.
  const closedNow =
    run.incident !== null &&
    clock.time >= parseTime(run.incident.start_time) &&
    clock.time < parseTime(run.incident.reported_reopen_time!)
  const selectedRow = run.rows.find((row) => row.shipment.id === selectedId)
  const highlightedRouteIds = useMemo(
    () =>
      selectedRow
        ? {
            original: selectedRow.shipment.assigned_route_id,
            ...(selectedRow.rerouted ? { chosen: selectedRow.route_id } : {}),
          }
        : {},
    [selectedRow],
  )

  const late = run.rows.filter((row) => row.risk === 'LATE').length
  const tight = run.rows.filter((row) => row.risk === 'TIGHT' || row.risk === 'UNKNOWN').length
  const affected = run.rows.filter((row) => row.affected).length
  const noAlternative = run.rows.filter((row) => row.rerouteUnavailable).length

  return (
    <div className="sim-page">
      <header className="sim-page__header">
        <div>
          <h1 className="sim-page__title"><Brand /> simulation</h1>
          <p className="sim-page__lede">
            Set up a day and press Start. Until then the dashboard shows only the day’s schedule.
            Once it runs, the dashboard receives trucks and the closure as they happen.
          </p>
        </div>
        <div className="sim-page__header-side">
          <span className="sim-page__badge">SIMULATED</span>
          <a className="pp-button" href="index.html">
            Back to dashboard
          </a>
        </div>
      </header>

      <main className="sim-page__main">
        <form
          className="sim-page__settings"
          aria-labelledby="sim-settings-title"
          onSubmit={(event) => {
            event.preventDefault()
            if (!run.error) clock.start()
          }}
        >
          <h2 id="sim-settings-title" className="sim-page__h2">
            Settings
          </h2>

          <fieldset className="sim-page__field">
            <legend>Day</legend>
            <label className="sim-page__choice">
              <input
                type="radio"
                name="closure"
                checked={!settings.closure}
                onChange={() => update({ closure: false })}
              />
              Normal day, no closure
            </label>
            <label className="sim-page__choice">
              <input
                type="radio"
                name="closure"
                checked={settings.closure}
                onChange={() => update({ closure: true })}
              />
              Road closure
            </label>
          </fieldset>

          <fieldset className="sim-page__field" disabled={!settings.closure}>
            <legend>Closure</legend>
            <label className="sim-page__label">
              Closed segment
              <select
                value={settings.segmentId}
                onChange={(event) => update({ segmentId: event.target.value })}
              >
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.id}: {segment.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="sim-page__times">
              <label className="sim-page__label">
                Closes at
                <input
                  type="time"
                  required
                  value={settings.start}
                  onChange={(event) => update({ start: event.target.value })}
                />
              </label>
              <label className="sim-page__label">
                Reopens at
                <input
                  type="time"
                  required
                  value={settings.reopen}
                  onChange={(event) => update({ reopen: event.target.value })}
                />
              </label>
            </div>
            <label className="sim-page__label">
              Trucks the closure delays
              <select
                value={settings.response}
                onChange={(event) => update({ response: event.target.value as SimResponse })}
              >
                <option value="wait">Wait until it reopens</option>
                <option value="reroute">Take the alternative route, where one avoids it</option>
              </select>
            </label>
            <p className="sim-page__hint">
              One rule for every delayed truck on this page, to compare outcomes. It is not a
              recommendation. On the dashboard, trucks follow the dispatcher’s choices.
            </p>
          </fieldset>

          <fieldset className="sim-page__field">
            <legend>Travel times</legend>
            <label className="sim-page__label">
              Draw trucks at
              <select
                value={settings.timingCase}
                onChange={(event) => update({ timingCase: event.target.value as TimingCase })}
              >
                <option value="slow">The slow end of each range</option>
                <option value="fast">The fast end of each range</option>
              </select>
            </label>
          </fieldset>

          {run.error && (
            <p className="sim-page__error" role="alert">
              {run.error}
            </p>
          )}

          <button type="submit" className="pp-button pp-button--primary sim-page__start" disabled={!!run.error}>
            Start simulation
          </button>

          <div className="sim-page__share">
            <label className="sim-page__label" htmlFor="sim-link">
              Link to this setup
            </label>
            <div className="sim-page__share-row">
              <input id="sim-link" type="text" readOnly value={link} onFocus={(event) => event.target.select()} />
              <button
                type="button"
                className="pp-button"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(link)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false))
                }}
              >
                Copy link
              </button>
            </div>
            <p className="sim-page__hint" role="status">
              {copied
                ? 'Link copied.'
                : local && !lanUrl
                  ? 'This server only answers on this computer. Start it with --host so a teammate can open the link.'
                  : 'A teammate who opens this link gets the same settings and can run the simulation.'}
            </p>
          </div>
        </form>

        <section className="sim-page__stage" aria-labelledby="sim-stage-title">
          <h2 id="sim-stage-title" className="sim-page__h2">
            {run.incident
              ? `${run.incident.segment_id} closed ${run.incident.start_time} to ${run.incident.reported_reopen_time}`
              : 'Normal day'}
          </h2>
          {!run.error && (
            <p className="sim-page__summary">
              <strong className="pp-num">{affected}</strong> of{' '}
              <strong className="pp-num">{run.rows.length}</strong> shipments delayed by the closure
              {' · '}
              <strong className="pp-num">{late}</strong> late{' · '}
              <strong className="pp-num">{tight}</strong> tight or unknown
              {noAlternative > 0 && (
                <>
                  {' · '}
                  <strong className="pp-num">{noAlternative}</strong> with no alternative that avoids it
                </>
              )}
            </p>
          )}

          {mapFailed ? (
            <p className="sim-page__fallback" role="status">
              The map could not load. The table below says where every truck is.
            </p>
          ) : (
            <div className="sim-page__map">
              <MapBoundary onError={() => setMapFailed(true)}>
                <Suspense fallback={<p className="sim-page__loading">Loading map…</p>}>
                  <ArcgisMap
                    facilities={facilities}
                    segments={segments}
                    routes={routes}
                    highlightedRouteIds={highlightedRouteIds}
                    incidentSegmentId={closedNow ? run.incident!.segment_id : null}
                    candidateSegmentId={null}
                    trucks={states}
                    selectedShipmentId={selectedId}
                    onError={() => setMapFailed(true)}
                  />
                </Suspense>
              </MapBoundary>
            </div>
          )}
          <p className="sim-page__hint">
            Triangle: truck moving. Red square: truck caught at the closure. Trucks not yet sent
            when the road closes are held at the port. Lines are schematic and routes are not
            verified for trucks.
          </p>

          {!run.error && (
            <SimClock
              clock={clock}
              start={range.start}
              end={range.end}
              plans={run.plans}
              states={states}
              segmentName={segmentName}
              timingCase={settings.timingCase}
            />
          )}
        </section>

        {!run.error && (
          <section className="sim-page__results" aria-labelledby="sim-results-title">
            <h2 id="sim-results-title" className="sim-page__h2">
              Shipments at {formatTime(Math.floor(clock.time))}
            </h2>
            <div className="sim-page__table-wrap">
              <table className="sim-page__table">
                <thead>
                  <tr>
                    <th scope="col">Shipment</th>
                    <th scope="col">Route</th>
                    <th scope="col">Now</th>
                    <th scope="col">Appointment</th>
                    <th scope="col">Est. arrival</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {run.rows.map((row, i) => (
                    <tr key={row.shipment.id} className={row.shipment.id === selectedId ? 'is-selected' : undefined}>
                      <th scope="row">
                        <button
                          type="button"
                          className="sim-page__row-button"
                          aria-pressed={row.shipment.id === selectedId}
                          onClick={() =>
                            setSelectedId((current) => (current === row.shipment.id ? null : row.shipment.id))
                          }
                        >
                          {row.shipment.id}
                        </button>
                        <span className="sim-page__destination">{row.destinationName}</span>
                      </th>
                      <td>
                        {row.route_id}
                        {row.rerouted && <span className="sim-page__tag">Rerouted</span>}
                        {row.rerouteUnavailable && <span className="sim-page__tag">No alternative</span>}
                      </td>
                      <td>{describeTruck(run.plans[i], states[i], segmentName)}</td>
                      <td className="pp-num">
                        {row.shipment.appt_start}–{row.shipment.appt_end}
                      </td>
                      <td className="pp-num">{arrival(row)}</td>
                      <td>
                        <RiskBadge risk={row.risk} /> <span className="sim-page__lateness">{lateness(row)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="sim-page__hint">
              Select a shipment to highlight its route on the map. Arrivals are estimates from
              simulated data, not measured outcomes.
            </p>
          </section>
        )}
      </main>
    </div>
  )
}
