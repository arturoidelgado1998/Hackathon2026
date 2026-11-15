import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.tsx'
import { getActiveIncident, sampleIncident, setActiveIncident } from '../data/index.ts'
import { isSimBroadcast, SIM_CHANNEL, type SimBroadcast } from './live.ts'
import { DEFAULT_SETTINGS, serializeSettings, type SimSettings } from './settings.ts'

// What a simulation page in another tab would send.
let seq = 0
const sender = new BroadcastChannel(SIM_CHANNEL)
;(sender as unknown as { unref?: () => void }).unref?.()

async function broadcast(settings: Partial<SimSettings>, clock: Partial<SimBroadcast> = {}) {
  const state: SimBroadcast = {
    v: 1,
    sender: 'test-page',
    seq: ++seq,
    query: serializeSettings({ ...DEFAULT_SETTINGS, ...settings }),
    time: 645,
    running: false,
    started: true,
    speed: 5,
    ...clock,
  }
  await act(async () => {
    sender.postMessage(state)
    // BroadcastChannel delivers on a later task.
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

// A stand-in for the ArcGIS map that reports the trucks it was asked to draw.
vi.mock('../map/ArcgisMap.tsx', () => ({
  default: (props: { trucks?: { status: string }[]; incidentSegmentId: string | null }) => {
    const count = (status: string) => props.trucks?.filter((t) => t.status === status).length ?? 0
    return (
      <div
        data-testid="arcgis-map"
        data-incident={props.incidentSegmentId ?? ''}
        data-trucks={
          props.trucks
            ? `${count('at_port')} at port, ${count('moving')} moving, ${count('waiting')} waiting, ${count('arrived')} arrived`
            : 'none'
        }
      />
    )
  },
}))

const map = () => screen.findByTestId('arcgis-map')
const trucks = async () => (await map()).getAttribute('data-trucks')

afterEach(() => setActiveIncident(null))

describe('isSimBroadcast', () => {
  it('accepts a well-formed state and refuses anything else', () => {
    const good = { v: 1, sender: 'a', seq: 1, query: 'closure=1', time: 600, running: true, started: true, speed: 5 }
    expect(isSimBroadcast(good)).toBe(true)
    for (const bad of [null, 'x', { ...good, v: 2 }, { ...good, time: 1440 }, { ...good, sender: '' }, { ...good, speed: 0 }, { ...good, running: 'yes' }, { ...good, started: undefined }]) {
      expect(isSimBroadcast(bad)).toBe(false)
    }
  })
})

const card = (id: string) => document.querySelector(`[data-shipment-id="${id}"]`) as HTMLElement
const updates = () => screen.getByRole('region', { name: 'Live updates' })

describe('the prefilled sample', () => {
  it('ignores live updates and keeps its scenario switch', async () => {
    render(<App />)
    await broadcast({ closure: false }, { time: 645 })
    expect(screen.getByRole('button', { name: 'Disrupted' })).toHaveAttribute('aria-pressed', 'true')
    expect(await trucks()).toBe('none')
    expect(screen.queryByRole('region', { name: 'Live updates' })).toBeNull()
  })
})

describe('the live dashboard', () => {
  it('starts with only the day’s schedule: nothing is prefilled', async () => {
    const { container } = render(<App live />)
    expect(screen.getByText('Waiting for live updates.')).toBeInTheDocument()
    const schedule = screen.getByRole('group', { name: /schedule/ })
    expect(within(schedule).getAllByRole('listitem')).toHaveLength(10)
    expect(within(card('S-01')).getByText('11:00–11:30')).toBeInTheDocument()
    // No estimates, risk, closure, totals, trucks or choices yet.
    expect(container.querySelector('.risk-badge')).toBeNull()
    expect(container.textContent).not.toMatch(/Est\. arrival|Closure on|Needs review/)
    expect(within(screen.getByRole('region', { name: 'Indicators' })).getAllByText('—')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Disrupted' })).toBeNull()
    expect(within(schedule).queryByRole('button')).toBeNull()
    expect(screen.getByText(/Nothing to compare yet/)).toBeInTheDocument()
    expect(await trucks()).toBe('none')
    expect(await map()).toHaveAttribute('data-incident', '')
  })

  it('stays on the schedule while a run is set up but not started', async () => {
    render(<App live />)
    await broadcast({}, { time: 525, started: false })
    expect(screen.getByText('Waiting for live updates.')).toBeInTheDocument()
    expect(await trucks()).toBe('none')
  })

  it('fills in once the run starts, with no closure before it is reported', async () => {
    render(<App live />)
    await broadcast({}, { time: 570, running: false })
    expect(screen.getByText('No active incident.')).toBeInTheDocument()
    expect(await map()).toHaveAttribute('data-incident', '')
    expect(await trucks()).toBe('9 at port, 1 moving, 0 waiting, 0 arrived')
    expect(within(card('S-01')).getByText('At the port. Leaves 10:00.')).toBeInTheDocument()
    expect(within(card('S-01')).getByText('11:00–11:14')).toBeInTheDocument()
    expect(within(updates()).getByText('Now 09:30')).toBeInTheDocument()
    expect(within(updates()).getByText('S-08 left the port.')).toBeInTheDocument()
    expect(within(updates()).queryByText(/Closure reported/)).toBeNull()
  })

  it('reports the closure when its start time is reached, and annotates each shipment', async () => {
    render(<App live />)
    await broadcast({}, { time: 599 })
    expect(screen.getByText('No active incident.')).toBeInTheDocument()
    await broadcast({}, { time: 645 })
    expect(screen.getByText(/Closure on NB-03/)).toBeInTheDocument()
    expect(await map()).toHaveAttribute('data-incident', 'NB-03')
    expect(screen.getByTestId('count-needs_review')).toHaveTextContent('6')
    // Trucks not yet sent when the road closed are held at the port, not sent to queue.
    expect(await trucks()).toBe('8 at port, 1 moving, 0 waiting, 1 arrived')
    expect(within(card('S-01')).getByText('Held at the port: NB-03 is closed. Leaves 10:58.')).toBeInTheDocument()
    expect(within(card('S-08')).getByText('Arrived 09:35.')).toBeInTheDocument()
    expect(within(updates()).getByText(/Closure reported on NB-03/)).toBeInTheDocument()
    expect(within(updates()).getByText('S-01 is held at the port: NB-03 is closed.')).toBeInTheDocument()
  })

  it('draws the road open again once it has reopened', async () => {
    render(<App live />)
    await broadcast({}, { time: 669 })
    expect(await map()).toHaveAttribute('data-incident', 'NB-03')
    await broadcast({}, { time: 680 })
    expect(await map()).toHaveAttribute('data-incident', '')
    expect(screen.getByText(/NB-03, .* reopened/)).toBeInTheDocument()
    expect(within(updates()).getByText('NB-03 reopened.')).toBeInTheDocument()
    // The six trucks that were held are now on their way; S-06 and S-10 are not due yet.
    expect(await trucks()).toBe('2 at port, 6 moving, 0 waiting, 2 arrived')
  })

  it('the person at the dashboard makes the choice, and the truck follows it', async () => {
    render(<App live />)
    await broadcast({}, { time: 645 })
    fireEvent.click(card('S-01'))
    fireEvent.click(screen.getByRole('button', { name: 'Use reroute' }))
    expect(await trucks()).toBe('7 at port, 2 moving, 0 waiting, 1 arrived')
    expect(within(card('S-01')).getByText(/^Left 10:00\. On /)).toBeInTheDocument()
    // The next update keeps the choice.
    await broadcast({}, { time: 650 })
    expect(screen.getByTestId('count-decision_recorded')).toHaveTextContent('1')
  })

  it('follows a normal day and a different closure', async () => {
    render(<App live />)
    await broadcast({ closure: false }, { time: 645 })
    expect(screen.getByText('No active incident.')).toBeInTheDocument()
    expect(await trucks()).toBe('2 at port, 7 moving, 0 waiting, 1 arrived')
    await broadcast({ segmentId: 'WEST-405', start: '09:00', reopen: '09:40' }, { time: 560 })
    expect(getActiveIncident()).toMatchObject({ segment_id: 'WEST-405', start_time: '09:00' })
    expect(screen.getByText(/Closure on WEST-405/)).toBeInTheDocument()
    // S-08 is the one shipment that needs WEST-405 while it is closed: it is held at the port.
    expect(await trucks()).toBe('10 at port, 0 moving, 0 waiting, 0 arrived')
    expect(within(card('S-08')).getByText('Held at the port: WEST-405 is closed. Leaves 09:28.')).toBeInTheDocument()
  })

  it('goes back to the schedule when the run is restarted', async () => {
    render(<App live />)
    await broadcast({}, { time: 645 })
    await broadcast({}, { time: 525, started: false })
    expect(screen.getByText('Waiting for live updates.')).toBeInTheDocument()
    expect(getActiveIncident()).toBe(sampleIncident)
    expect(await trucks()).toBe('none')
  })

  it('never mentions the simulation or offers a way to run it', async () => {
    const { container } = render(<App live />)
    const clean = () => {
      expect(container.textContent).not.toMatch(/simulation/i)
      expect(container.querySelector('a[href*="simulation"]')).toBeNull()
      expect(screen.queryByRole('slider')).toBeNull()
      expect(container.textContent).not.toMatch(/Paused|min per second/)
    }
    clean()
    await broadcast({}, { time: 645, running: true })
    clean()
  })

  it('ignores an older update that arrives late', async () => {
    render(<App live />)
    await broadcast({ closure: false }, { time: 700 })
    const before = await trucks()
    seq -= 2
    await broadcast({ closure: false }, { time: 500 })
    seq += 2
    expect(await trucks()).toBe(before)
  })
})
