import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimulationPage } from './SimulationPage.tsx'

// A stand-in for the ArcGIS map that reports what it was asked to draw.
vi.mock('../map/ArcgisMap.tsx', () => ({
  default: (props: {
    incidentSegmentId: string | null
    highlightedRouteIds: object
    trucks?: { status: string }[]
  }) => (
    <div
      data-testid="arcgis-map"
      data-incident={props.incidentSegmentId ?? ''}
      data-routes={JSON.stringify(props.highlightedRouteIds)}
      data-trucks={props.trucks?.length ?? 0}
    />
  ),
}))

const open = async (search = '') => {
  window.history.replaceState(null, '', `/simulation.html${search}`)
  render(<SimulationPage />)
  return screen.findByTestId('arcgis-map')
}
const slider = () => screen.getByRole('slider', { name: 'Simulated time of day' })
const rowFor = (id: string) => screen.getByRole('button', { name: id }).closest('tr')!
const link = () => (screen.getByLabelText('Link to this setup') as HTMLInputElement).value

beforeEach(() => vi.useRealTimers())
afterEach(() => vi.useRealTimers())

describe('SimulationPage', () => {
  it('opens on the sample closure, paused, with every shipment listed', async () => {
    const map = await open()
    const title = screen.getByRole('heading', { level: 1, name: 'RouteRipple simulation' })
    expect(title.querySelector('img')).toHaveAttribute('alt', '')
    expect(screen.getByRole('heading', { name: 'NB-03 closed 10:00 to 11:10' })).toBeInTheDocument()
    expect(map).toHaveAttribute('data-incident', 'NB-03')
    expect(map).toHaveAttribute('data-trucks', '10')
    expect(screen.getAllByRole('row')).toHaveLength(11)
    expect(within(rowFor('S-01')).getByText('30 to 42 min late')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('Start simulation plays from the start of the day', async () => {
    await open()
    vi.useFakeTimers()
    fireEvent.change(slider(), { target: { value: '700' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start simulation' }))
    act(() => void vi.advanceTimersByTime(2000))
    expect(slider()).toHaveAttribute('aria-valuetext', '08:55')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('changing a setting reruns the engine and updates the link', async () => {
    const map = await open()
    fireEvent.change(screen.getByLabelText('Trucks the closure delays'), { target: { value: 'reroute' } })
    expect(within(rowFor('S-01')).getByText('Rerouted')).toBeInTheDocument()
    expect(within(rowFor('S-01')).getByText('11:15 to 11:28')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Closed segment'), { target: { value: 'WEST-405' } })
    expect(map).toHaveAttribute('data-incident', 'WEST-405')
    expect(link()).toContain('segment=WEST-405')
    expect(link()).toContain('response=reroute')
    expect(window.location.search).toContain('segment=WEST-405')
  })

  it('a teammate’s link restores the same setup', async () => {
    const map = await open('?closure=1&segment=EB-405&start=09%3A30&reopen=10%3A15&response=wait&case=fast&speed=15')
    expect(screen.getByRole('heading', { name: 'EB-405 closed 09:30 to 10:15' })).toBeInTheDocument()
    expect(map).toHaveAttribute('data-incident', 'EB-405')
    expect(screen.getByLabelText('Draw trucks at')).toHaveValue('fast')
    expect(screen.getByRole('combobox', { name: 'Speed' })).toHaveValue('15')
  })

  it('a normal day has no closure and the closure settings are switched off', async () => {
    const map = await open('?closure=0')
    expect(screen.getByRole('heading', { name: 'Normal day' })).toBeInTheDocument()
    expect(map).toHaveAttribute('data-incident', '')
    expect(screen.getByLabelText('Closed segment')).toBeDisabled()
  })

  it('explains a setup that cannot run and blocks Start', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Reopens at'), { target: { value: '09:00' } })
    expect(screen.getByRole('alert')).toHaveTextContent('must not be before')
    expect(screen.getByRole('button', { name: 'Start simulation' })).toBeDisabled()
  })

  it('selecting a shipment highlights its route on the map', async () => {
    const map = await open()
    fireEvent.click(screen.getByRole('button', { name: 'S-04' }))
    expect(JSON.parse(map.getAttribute('data-routes')!)).toEqual({ original: 'R-B-ORIG' })
  })
})
