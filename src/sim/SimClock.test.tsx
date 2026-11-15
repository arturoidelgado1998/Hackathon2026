import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSegment, segments } from '../data/index.ts'
import { parseTime } from '../engine/time.ts'
import { buildTruckPlans } from '../state/trucks.ts'
import { SimClock } from './SimClock.tsx'
import { simWindow, truckStateAt } from './trucks.ts'
import { useSimClock } from './useSimClock.ts'

const plans = buildTruckPlans('disrupted')
const range = simWindow(plans)

function Harness() {
  const clock = useSimClock(range.start, range.end)
  const states = plans.map((plan) => truckStateAt(plan, clock.time, segments))
  return (
    <SimClock
      clock={clock}
      start={range.start}
      end={range.end}
      plans={plans}
      states={states}
      segmentName={(id) => getSegment(id)?.name ?? id}
    />
  )
}

const slider = () => screen.getByRole('slider', { name: 'Simulated time of day' })
const counts = () => within(screen.getByRole('list', { name: /^Trucks at/ })).getAllByRole('listitem').map((li) => li.textContent)

afterEach(() => vi.useRealTimers())

describe('SimClock', () => {
  it('starts paused at the start of the window with every truck at the port', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(slider()).toHaveAttribute('aria-valuetext', '08:45')
    expect(counts()).toEqual(['10 at the port', '0 on the road', '0 waiting at a closure', '0 arrived'])
  })

  it('dragging the slider moves every truck to that time', () => {
    render(<Harness />)
    fireEvent.change(slider(), { target: { value: String(parseTime('10:45')) } })
    expect(slider()).toHaveAttribute('aria-valuetext', '10:45')
    // S-06 and S-10 have not left; S-05 and S-09 are on the first segment; S-08 has arrived.
    expect(counts()).toEqual(['2 at the port', '2 on the road', '5 waiting at a closure', '1 arrived'])
    expect(screen.getByText(/Waiting at I-710 northbound to SR-60 east \(shared corridor\) until 11:10/, {
      selector: 'li:first-child',
    })).toBeInTheDocument()
  })

  it('Play advances the clock at the chosen speed and Pause stops it', () => {
    vi.useFakeTimers()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    act(() => void vi.advanceTimersByTime(2000))
    // 5 simulated minutes per second by default.
    expect(slider()).toHaveAttribute('aria-valuetext', '08:55')
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    act(() => void vi.advanceTimersByTime(2000))
    expect(slider()).toHaveAttribute('aria-valuetext', '08:55')
  })

  it('stops at the end of the window, and Restart returns to the start', () => {
    vi.useFakeTimers()
    render(<Harness />)
    fireEvent.change(slider(), { target: { value: String(range.end - 1) } })
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    act(() => void vi.advanceTimersByTime(3000))
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(counts()[3]).toBe('10 arrived')
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    expect(slider()).toHaveAttribute('aria-valuetext', '08:45')
  })
})
