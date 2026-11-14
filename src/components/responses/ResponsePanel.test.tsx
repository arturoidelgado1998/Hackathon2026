import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ResponseOption } from '../../types'
import type { ResponsePanelView } from '../../viewModels'
import { delta, deltaOneDecimal } from './deltas'
import { ResponsePanel } from './index'

// Inline reference fixture (mirrors the D2 reference shipment).
const wait: ResponseOption = {
  kind: 'wait',
  arrival_min: '12:00',
  arrival_max: '12:00',
  lateness_min: 30,
  lateness_max: 30,
  risk: 'LATE',
  miles: 45,
  cost: 161,
  co2_kg: 70.7,
  requires_confirmation: false,
  status: 'Waits for reopening',
  explanation_inputs: [],
  driver_duty_min: 120,
  passes_sensitive_zone: false,
  stakeholder_notes: [],
}

const reroute: ResponseOption = {
  kind: 'reroute',
  arrival_min: '11:15',
  arrival_max: '11:15',
  lateness_min: 0,
  lateness_max: 0,
  risk: 'ON_TRACK',
  miles: 60,
  cost: 158,
  co2_kg: 94.2,
  requires_confirmation: false,
  status: 'Alternative route available',
  explanation_inputs: [],
  driver_duty_min: 75,
  passes_sensitive_zone: true,
  stakeholder_notes: [],
}

const requestSlot: ResponseOption = {
  kind: 'request_slot',
  arrival_min: null,
  arrival_max: null,
  lateness_min: null,
  lateness_max: null,
  risk: 'LATE',
  miles: null,
  cost: null,
  co2_kg: null,
  requires_confirmation: true,
  status: 'Pending confirmation; original deadline still applies',
  explanation_inputs: [],
  driver_duty_min: null,
  passes_sensitive_zone: false,
  stakeholder_notes: [],
}

function makeView(overrides: Partial<ResponsePanelView> = {}): ResponsePanelView {
  return {
    shipment: {
      id: 'SHP-001',
      destination_id: 'W1',
      cargo_ready: '08:00',
      truck_available: '08:15',
      appt_start: '10:30',
      appt_end: '11:30',
      assigned_route_id: 'R1',
    },
    destinationName: 'Inland Warehouse',
    options: [wait, reroute, requestSlot],
    baseline: { miles: 45, cost: 121, co2_kg: 70.7, driver_duty_min: 60 },
    community: {},
    ...overrides,
  }
}

function card(title: string): HTMLElement {
  return screen.getByRole('article', { name: title })
}

describe('deltas', () => {
  it('subtracts the baseline and rounds CO2 to one decimal', () => {
    expect(delta(60, 45)).toBe(15)
    expect(delta(null, 45)).toBeNull()
    expect(deltaOneDecimal(94.2, 70.7)).toBe(23.5)
    expect(deltaOneDecimal(70.7, 70.7)).toBe(0)
  })
})

describe('ResponsePanel', () => {
  it('shows the empty state when no shipment is selected', () => {
    render(<ResponsePanel view={null} />)
    expect(screen.getByText('Select a shipment to compare responses.')).toBeInTheDocument()
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })

  it('shows the no-response state when there are no options', () => {
    render(<ResponsePanel view={makeView({ options: [] })} />)
    expect(
      screen.getByText('No response needed: this shipment is not affected by the current incident.'),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })

  it('renders three cards in the given order with the reference values', () => {
    render(<ResponsePanel view={makeView()} />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('SHP-001')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Inland Warehouse')

    const titles = screen.getAllByRole('article').map((a) => within(a).getByRole('heading', { level: 3 }).textContent)
    expect(titles).toEqual(['Wait', 'Reroute', 'Request later slot'])

    const w = card('Wait')
    expect(w).toHaveTextContent('Est. arrival12:00')
    expect(w).toHaveTextContent('30 min late')
    expect(w).toHaveTextContent('45 mi (no change vs. normal)')
    expect(w).toHaveTextContent('Est. cost$161')
    expect(w).toHaveTextContent('70.7 kg (no change vs. normal)')
    expect(w).toHaveTextContent('Late')

    const r = card('Reroute')
    expect(r).toHaveTextContent('Est. arrival11:15')
    expect(r).toHaveTextContent('Meets window')
    expect(r).toHaveTextContent('Est. cost$158')
    expect(r).toHaveTextContent('On track')

    const s = card('Request later slot')
    expect(s).toHaveTextContent('Pending confirmation; original deadline still applies')
    expect(s).toHaveTextContent('Est. arrivaln/a')
    expect(s).toHaveTextContent('Est. costn/a')
    expect(s).toHaveTextContent('Est. tailpipe CO2n/a')
    expect(s).not.toHaveTextContent('Meets window')
  })

  it('shows the reroute increase against normal', () => {
    render(<ResponsePanel view={makeView()} />)
    const r = card('Reroute')
    expect(r).toHaveTextContent('60 mi (+15 mi vs. normal)')
    expect(r).toHaveTextContent('94.2 kg (+23.5 kg vs. normal)')
    expect(r).toHaveTextContent('+15 mi, +23.5 kg est. tailpipe CO2')
    expect(r.textContent).not.toContain('23.500000')
  })

  it('puts the stakeholder strip on every card, with a text warning', () => {
    render(<ResponsePanel view={makeView()} />)
    const strips = screen.getAllByRole('heading', { name: 'Stakeholder impact (SIMULATED)' })
    expect(strips).toHaveLength(3)
    for (const a of screen.getAllByRole('article')) {
      expect(a).toHaveTextContent('Not modeled:noise, local air quality, driver pay/hours rules')
    }

    expect(card('Wait')).toHaveTextContent('Driver:+60 min duty time vs. normal')
    expect(card('Wait')).toHaveTextContent('No flagged zone on this route (placeholder)')
    expect(card('Wait')).toHaveTextContent('Environment:no added miles or CO2')

    const r = card('Reroute')
    expect(r).toHaveTextContent('Driver:+15 min duty time vs. normal')
    const warning = within(r).getByText(/Passes a flagged zone \(placeholder\)/)
    expect(within(warning).getByRole('img', { name: 'Warning' })).toBeInTheDocument()

    const s = card('Request later slot')
    expect(within(s).getAllByText('n/a until a new slot is confirmed')).toHaveLength(3)
  })

  it('shows real community counts when they exist', () => {
    const view = makeView({
      community: {
        reroute: { schools_150m: 3, dac_tracts: ['T1', 'T2'], max_diesel_pm_pctl: 90 },
        wait: { schools_150m: 0, dac_tracts: [], max_diesel_pm_pctl: null },
      },
    })
    render(<ResponsePanel view={view} />)
    const line = within(card('Reroute')).getByText(
      /3 schools and 2 disadvantaged tracts within 150 m \(real locations, illustrative route\)/,
    )
    expect(within(line).getByRole('img', { name: 'Warning' })).toBeInTheDocument()

    const waitCard = card('Wait')
    expect(waitCard).toHaveTextContent('0 schools and 0 disadvantaged tracts within 150 m')
    expect(within(waitCard).queryByRole('img', { name: 'Warning' })).toBeNull()
  })

  it('shows the no-feasible banner when wait and reroute are not on track or tight', () => {
    const view = makeView({
      options: [wait, { ...reroute, risk: 'LATE', lateness_min: 10, lateness_max: 25 }, requestSlot],
    })
    render(<ResponsePanel view={view} />)
    expect(
      screen.getByText(/No currently feasible response: review with warehouse or customer\./),
    ).toBeInTheDocument()
    expect(card('Reroute')).toHaveTextContent('10 to 25 min late')
  })

  it('shows the banner when reroute is UNKNOWN', () => {
    const view = makeView({
      options: [wait, { ...reroute, risk: 'UNKNOWN', lateness_min: null, lateness_max: null }, requestSlot],
    })
    render(<ResponsePanel view={view} />)
    expect(screen.getByText(/No currently feasible response/)).toBeInTheDocument()
    expect(card('Reroute')).toHaveTextContent('AppointmentUnknown')
  })

  it('does not show the banner for the reference fixture', () => {
    render(<ResponsePanel view={makeView()} />)
    expect(screen.queryByText(/No currently feasible response/)).toBeNull()
  })

  it('words a possible lateness range', () => {
    const view = makeView({ options: [{ ...wait, lateness_min: 0, lateness_max: 20, arrival_max: '12:20' }] })
    render(<ResponsePanel view={view} />)
    expect(card('Wait')).toHaveTextContent('May be up to 20 min late')
    expect(card('Wait')).toHaveTextContent('12:00 to 12:20')
  })

  it('calls onWhy with the option kind and renders the action slot', () => {
    const onWhy = vi.fn()
    render(
      <ResponsePanel
        view={makeView()}
        onWhy={onWhy}
        renderActions={(o) => <button type="button">Preview {o.kind}</button>}
      />,
    )
    fireEvent.click(within(card('Reroute')).getByRole('button', { name: /Why\?/ }))
    expect(onWhy).toHaveBeenCalledWith('reroute')
    expect(screen.getByRole('button', { name: 'Preview request_slot' })).toBeInTheDocument()
  })

  it('never says best or recommended', () => {
    const { container } = render(<ResponsePanel view={makeView()} />)
    for (const el of container.querySelectorAll('*')) {
      expect(el.textContent ?? '').not.toMatch(/\b(best|recommended)\b/i)
      for (const attr of el.getAttributeNames()) {
        expect(el.getAttribute(attr) ?? '').not.toMatch(/\b(best|recommended)\b/i)
      }
    }
  })
})
