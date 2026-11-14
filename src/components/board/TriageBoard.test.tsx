import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Shipment } from '../../types.ts'
import type { BoardColumn, ShipmentCardView, ShipmentSummary } from '../../viewModels.ts'
import { defaultColumn, RiskBadge, ShipmentCard, TriageBoard } from './index.ts'

function shipment(id: string, appt_start: string, appt_end: string): Shipment {
  return {
    id,
    destination_id: `W-${id}`,
    cargo_ready: '06:00',
    truck_available: '06:15',
    appt_start,
    appt_end,
    assigned_route_id: `R-${id}`,
  }
}

function summary(overrides: Partial<ShipmentSummary>): ShipmentSummary {
  return {
    risk: 'ON_TRACK',
    arrival_min: '08:10',
    arrival_max: '08:10',
    lateness_min: 0,
    lateness_max: 0,
    reason: 'Route clear',
    affected: false,
    ...overrides,
  }
}

function card(
  id: string,
  column: BoardColumn,
  s: Partial<ShipmentSummary>,
  appt: [string, string] = ['08:00', '09:00'],
): ShipmentCardView {
  return {
    shipment: shipment(id, appt[0], appt[1]),
    destinationName: `Warehouse ${id}`,
    summary: summary(s),
    column,
  }
}

const FIXTURE: ShipmentCardView[] = [
  card('SH-101', 'monitoring', { risk: 'ON_TRACK', reason: 'Route clear' }),
  card('SH-102', 'monitoring', { risk: 'TIGHT', arrival_min: '08:40', arrival_max: '08:55', reason: 'Little slack before window' }),
  card('SH-103', 'needs_review', {
    risk: 'LATE',
    arrival_min: '09:30',
    arrival_max: '10:15',
    reason: 'Route uses closed segment NB-03',
    affected: true,
  }, ['07:30', '09:00']),
  card('SH-104', 'needs_review', {
    risk: 'UNKNOWN',
    arrival_min: null,
    arrival_max: null,
    reason: 'Reopen time not reported',
    affected: true,
  }),
  card('SH-105', 'awaiting_confirmation', {
    risk: 'LATE',
    arrival_min: '10:05',
    arrival_max: '10:40',
    reason: 'Later slot requested, not yet confirmed',
    affected: true,
  }),
  card('SH-106', 'decision_recorded', { risk: 'TIGHT', arrival_min: '08:50', arrival_max: '08:50', reason: 'Reroute via SR-47' }),
]

function column(title: string) {
  return screen.getByRole('region', { name: title })
}

describe('TriageBoard', () => {
  it('renders the four groups most urgent first, with a count in each header', () => {
    render(<TriageBoard cards={FIXTURE} />)
    const regions = screen.getAllByRole('region')
    expect(regions.map((r) => within(r).getByRole('heading').textContent)).toEqual([
      'Needs review 2',
      'Awaiting confirmation 1',
      'Decision recorded 1',
      'Monitoring 2',
    ])
    expect(screen.getByTestId('count-monitoring')).toHaveTextContent('2')
    expect(screen.getByTestId('count-decision_recorded')).toHaveTextContent('1')
  })

  it('words "Decision recorded" as the dispatcher\'s choice', () => {
    render(<TriageBoard cards={FIXTURE} />)
    const col = column('Decision recorded')
    expect(within(col).getByText('Dispatcher chose a response')).toBeInTheDocument()
    expect(col.textContent).not.toMatch(/delivered|solved|resolved/i)
  })

  it('shows an empty note in columns with no cards', () => {
    render(<TriageBoard cards={FIXTURE.filter((c) => c.column === 'monitoring')} />)
    expect(within(column('Needs review')).getByText('No shipments')).toBeInTheDocument()
    expect(within(column('Monitoring')).queryByText('No shipments')).not.toBeInTheDocument()
    expect(screen.getByTestId('count-needs_review')).toHaveTextContent('0')
  })

  it('renders every card field', () => {
    render(<TriageBoard cards={FIXTURE} />)
    const btn = screen.getByRole('button', { name: /SH-103/ })
    const c = within(btn)
    expect(c.getByText('SH-103')).toBeInTheDocument()
    expect(c.getByText('Warehouse SH-103')).toBeInTheDocument()
    expect(c.getByText('07:30–09:00')).toBeInTheDocument()
    expect(c.getByText('Est. arrival')).toBeInTheDocument()
    expect(c.getByText('09:30–10:15')).toBeInTheDocument()
    expect(c.getByText('LATE')).toBeInTheDocument()
    expect(c.getByText('Route uses closed segment NB-03')).toBeInTheDocument()
  })

  it('places cards by column only, independent of risk', () => {
    render(<TriageBoard cards={FIXTURE} />)
    const awaiting = column('Awaiting confirmation')
    const btn = within(awaiting).getByRole('button', { name: /SH-105/ })
    expect(within(btn).getByText('LATE')).toBeInTheDocument()
    // The same risk appears in different columns; the column follows card.column.
    expect(within(column('Needs review')).getByText('LATE')).toBeInTheDocument()
    expect(within(column('Monitoring')).queryByText('LATE')).not.toBeInTheDocument()
  })

  it('renders an unaffected card identically in normal and disrupted states', () => {
    const base = FIXTURE[1]
    const normal: ShipmentCardView = { ...base, column: defaultColumn(base.summary, 'normal') }
    const disrupted: ShipmentCardView = { ...base, column: defaultColumn(base.summary, 'disrupted') }
    expect(normal.column).toBe(disrupted.column)

    const { unmount } = render(<TriageBoard cards={[normal]} />)
    const normalHtml = screen.getByRole('button', { name: /SH-102/ }).outerHTML
    const normalCol = screen.getByRole('button').closest('section')?.dataset.column
    unmount()
    render(<TriageBoard cards={[disrupted]} />)
    expect(screen.getByRole('button', { name: /SH-102/ }).outerHTML).toBe(normalHtml)
    expect(screen.getByRole('button').closest('section')?.dataset.column).toBe(normalCol)
  })

  it('calls onSelectShipment with the card id and marks the selected card', () => {
    const onSelect = vi.fn()
    render(<TriageBoard cards={FIXTURE} selectedShipmentId="SH-104" onSelectShipment={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /SH-102/ }))
    expect(onSelect).toHaveBeenCalledWith('SH-102')

    const selected = screen.getByRole('button', { pressed: true })
    expect(selected).toHaveTextContent('SH-104')
    expect(within(selected).getByText(/Selected/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(FIXTURE.length - 1)
  })
})

describe('ShipmentCard arrival', () => {
  function arrivalText(min: string | null, max: string | null) {
    const view = card('SH-1', 'monitoring', { arrival_min: min, arrival_max: max })
    const { unmount } = render(<ShipmentCard card={view} />)
    const row = screen.getByText('Est. arrival').parentElement
    const text = row?.textContent
    unmount()
    return text
  }

  it('shows a single time when min equals max', () => {
    expect(arrivalText('08:10', '08:10')).toBe('Est. arrival 08:10')
  })

  it('shows a range when min and max differ', () => {
    expect(arrivalText('08:10', '08:35')).toBe('Est. arrival 08:10–08:35')
  })

  it('shows Unknown when arrival is null', () => {
    expect(arrivalText(null, null)).toBe('Est. arrival Unknown')
  })
})

describe('RiskBadge', () => {
  it.each([
    ['ON_TRACK', 'ON TRACK'],
    ['TIGHT', 'TIGHT'],
    ['LATE', 'LATE'],
    ['UNKNOWN', 'UNKNOWN'],
  ] as const)('%s shows a text label and a decorative icon', (risk, label) => {
    const { container } = render(<RiskBadge risk={risk} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    const icon = container.querySelector('.risk-badge__icon svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses a different icon for each risk value', () => {
    const shapes = (['ON_TRACK', 'TIGHT', 'LATE', 'UNKNOWN'] as const).map((risk) => {
      const { container, unmount } = render(<RiskBadge risk={risk} />)
      const shape = container.querySelector('.risk-badge__icon svg')?.innerHTML
      unmount()
      return shape
    })
    expect(new Set(shapes).size).toBe(4)
  })
})

describe('defaultColumn', () => {
  it('sends affected shipments to Needs review only in the disrupted scenario', () => {
    expect(defaultColumn(summary({ affected: true }), 'disrupted')).toBe('needs_review')
    expect(defaultColumn(summary({ affected: true }), 'normal')).toBe('monitoring')
    expect(defaultColumn(summary({ affected: false }), 'disrupted')).toBe('monitoring')
    expect(defaultColumn(summary({ affected: false }), 'normal')).toBe('monitoring')
  })

  it('ignores risk', () => {
    expect(defaultColumn(summary({ risk: 'LATE', affected: false }), 'disrupted')).toBe('monitoring')
  })
})
