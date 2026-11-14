import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Facility, Route, RoadSegment } from '../types.ts'
import { MapPanel, type MapPanelProps } from './MapPanel.tsx'

const facilities: Facility[] = [
  { id: 'P1', name: 'Test Port', type: 'port', lat: 0, lon: 0 },
  { id: 'W1', name: 'Test Warehouse', type: 'warehouse', lat: 1, lon: 1 },
]

function segment(id: string, name: string, miles: number): RoadSegment {
  return {
    id,
    name,
    geometry: null,
    miles,
    minutes_min: 5,
    minutes_max: 10,
    near_sensitive_zone: false,
    sensitive_zone_note: '',
  }
}

const segments: RoadSegment[] = [
  segment('A', 'Harbor Blvd', 2.5),
  segment('B', 'Main St', 4),
  segment('C', 'Bypass Rd', 6.1),
]

function route(id: string, kind: Route['kind'], segment_ids: string[]): Route {
  return {
    id,
    origin: 'P1',
    destination: 'W1',
    segment_ids,
    kind,
    truck_suitability_note: '',
    near_sensitive_zone: false,
    schools_150m: null,
    dac_tracts: null,
    max_diesel_pm_pctl: null,
  }
}

const routes: Route[] = [route('R1', 'original', ['A', 'B']), route('R2', 'alternative', ['A', 'C'])]

function renderPanel(overrides: Partial<MapPanelProps> = {}) {
  const props: MapPanelProps = {
    facilities,
    segments,
    routes,
    selectedShipmentId: null,
    highlightedRouteIds: {},
    incidentSegmentId: null,
    candidateSegmentId: null,
    ...overrides,
  }
  render(<MapPanel {...props} />)
  return props
}

function routeList(name: RegExp) {
  return screen.getByRole('list', { name })
}

describe('MapPanel placeholder', () => {
  it('shows the placeholder badge, note and empty state when nothing is highlighted', () => {
    renderPanel()
    expect(screen.getByText('Map arrives in Phase 5')).toBeInTheDocument()
    expect(screen.getByText(/Illustrative routes/)).toBeInTheDocument()
    expect(screen.getByText('Select a shipment to see its routes')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('shows the selected shipment', () => {
    renderPanel({ selectedShipmentId: 'S7', highlightedRouteIds: { original: 'R1' } })
    expect(screen.getByText('S7')).toBeInTheDocument()
    expect(screen.queryByText('Select a shipment to see its routes')).toBeNull()
  })

  it('renders the original route as an ordered list of segments with miles', () => {
    renderPanel({ selectedShipmentId: 'S1', highlightedRouteIds: { original: 'R1' } })
    const list = routeList(/Original route: R1/)
    expect(list.tagName).toBe('OL')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Harbor Blvd')
    expect(items[0]).toHaveTextContent('2.5 mi')
    expect(items[1]).toHaveTextContent('Main St')
    expect(items[1]).toHaveTextContent('4 mi')
    expect(screen.getByText(/Test Port to Test Warehouse/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /Alternative route/ })).toBeNull()
    expect(screen.queryByRole('list', { name: /Chosen route/ })).toBeNull()
  })

  it('renders the alternative and chosen routes', () => {
    renderPanel({
      selectedShipmentId: 'S1',
      highlightedRouteIds: { alternative: 'R2', chosen: 'R2' },
    })
    expect(screen.queryByRole('list', { name: /Original route/ })).toBeNull()
    for (const name of [/Alternative route: R2/, /Chosen route: R2/]) {
      const items = within(routeList(name)).getAllByRole('listitem')
      expect(items.map((li) => li.textContent)).toEqual([
        expect.stringContaining('Harbor Blvd'),
        expect.stringContaining('Bypass Rd'),
      ])
      expect(items[1]).toHaveTextContent('6.1 mi')
    }
  })

  it.each([
    ['previewed', /Preview route: R2/],
    ['pending_confirmation', /Current route \(slot pending confirmation\): R2/],
  ] as const)('labels a %s highlight without calling it a committed chosen route', (status, heading) => {
    renderPanel({
      selectedShipmentId: 'S1',
      highlightedRouteIds: { chosen: 'R2' },
      highlightedDecision: {
        shipment_id: 'S1',
        option_kind: status === 'previewed' ? 'reroute' : 'request_slot',
        status,
        timestamp: '2026-11-14T19:46:36.081Z',
      },
    })
    expect(routeList(heading)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /Chosen route/ })).toBeNull()
    expect(screen.getByText('Est. 6.1 mi')).toBeInTheDocument()
    expect(screen.getByText(/Distances are simulated estimates/)).toBeInTheDocument()
  })

  it('marks the closed segment with text', () => {
    renderPanel({
      selectedShipmentId: 'S1',
      highlightedRouteIds: { original: 'R1' },
      incidentSegmentId: 'B',
    })
    const items = within(routeList(/Original route/)).getAllByRole('listitem')
    expect(items[1]).toHaveTextContent('Closed')
    expect(items[0]).not.toHaveTextContent('Closed')
    expect(within(screen.getByRole('list', { name: 'Incident segments' })).getByText(/Main St/))
      .toBeInTheDocument()
  })

  it('marks the candidate segment as awaiting confirmation', () => {
    renderPanel({
      selectedShipmentId: 'S1',
      highlightedRouteIds: { original: 'R1' },
      candidateSegmentId: 'A',
    })
    const items = within(routeList(/Original route/)).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Awaiting confirmation')
    expect(items[1]).not.toHaveTextContent('Awaiting confirmation')
    expect(items[0]).not.toHaveTextContent('Closed')
  })

  it('calls onSegmentClick with the segment id', () => {
    const onSegmentClick = vi.fn()
    renderPanel({
      selectedShipmentId: 'S1',
      highlightedRouteIds: { original: 'R1' },
      onSegmentClick,
    })
    fireEvent.click(screen.getByRole('button', { name: /Main St/ }))
    expect(onSegmentClick).toHaveBeenCalledWith('B')
    fireEvent.click(screen.getByRole('button', { name: /Harbor Blvd/ }))
    expect(onSegmentClick).toHaveBeenLastCalledWith('A')
  })

  it('does not offer segments as controls when nothing listens for a click', () => {
    renderPanel({ selectedShipmentId: 'S1', highlightedRouteIds: { original: 'R1' } })
    expect(screen.getByText(/Harbor Blvd/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Harbor Blvd/ })).not.toBeInTheDocument()
  })
})
