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

const table = () => screen.getByRole('table')

/** Cells of the row with this label, in option order. */
function row(label: string): HTMLElement[] {
  const header = screen.getByRole('rowheader', { name: label })
  return within(header.closest('tr') as HTMLElement).getAllByRole('cell')
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
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the no-response state when there are no options', () => {
    render(<ResponsePanel view={makeView({ options: [] })} />)
    expect(
      screen.getByText('No response needed: this shipment is not affected by an incident.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('names the shipment, its appointment and its current status', () => {
    render(
      <ResponsePanel
        view={makeView({
          summary: {
            risk: 'LATE',
            arrival_min: '12:00',
            arrival_max: '12:00',
            lateness_min: 30,
            lateness_max: 30,
            reason: 'Waits at NB-03 until 11:10',
            affected: true,
          },
        })}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Responses for SHP-001 to Inland Warehouse' }),
    ).toBeInTheDocument()
    expect(screen.getByText('10:30–11:30')).toBeInTheDocument()
    expect(screen.getByText('Waits at NB-03 until 11:10')).toBeInTheDocument()
  })

  it('lists the options as columns in the order given', () => {
    render(<ResponsePanel view={makeView()} />)
    const headRow = table().querySelector('thead tr') as HTMLElement
    const headers = within(headRow).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Measure', 'Wait', 'Reroute', 'Request later slot'])
  })

  it('lines the reference values up by measure', () => {
    render(<ResponsePanel view={makeView()} />)
    expect(row('Est. arrival').map((c) => c.textContent)).toEqual(['12:00', '11:15', 'n/a'])
    expect(row('Appointment').map((c) => c.textContent)).toEqual([
      '30 min late',
      'Meets window',
      'Not confirmed yet',
    ])
    expect(row('Risk').map((c) => c.textContent)).toEqual(['LATE', 'ON TRACK', 'LATE'])
    expect(row('Est. cost').map((c) => c.textContent)).toEqual(['$161', '$158', 'n/a'])
  })

  it('shows the reroute increase against normal alongside its benefit', () => {
    render(<ResponsePanel view={makeView()} />)
    const [waitMiles, rerouteMiles] = row('Environment: miles')
    expect(waitMiles).toHaveTextContent('45 mi')
    expect(waitMiles).toHaveTextContent('no change vs. normal')
    expect(rerouteMiles).toHaveTextContent('60 mi')
    expect(rerouteMiles).toHaveTextContent('+15 mi vs. normal')
    const [, rerouteCo2] = row('Environment: est. tailpipe CO2')
    expect(rerouteCo2).toHaveTextContent('94.2 kg')
    expect(rerouteCo2).toHaveTextContent('+23.5 kg vs. normal')
  })

  it('shows who bears each option, with a text warning', () => {
    render(<ResponsePanel view={makeView()} />)
    expect(screen.getByText('Stakeholder impact (SIMULATED)')).toBeInTheDocument()

    const [waitDriver, rerouteDriver, slotDriver] = row('Driver')
    expect(waitDriver).toHaveTextContent('120 min on duty')
    expect(waitDriver).toHaveTextContent('+60 min duty time vs. normal')
    expect(rerouteDriver).toHaveTextContent('+15 min duty time vs. normal')
    expect(slotDriver).toHaveTextContent('n/a until a new slot is confirmed')

    const [waitCommunity, rerouteCommunity, slotCommunity] = row('Community')
    expect(waitCommunity).toHaveTextContent('No flagged zone on this route (placeholder)')
    expect(rerouteCommunity).toHaveTextContent('Passes a flagged zone (placeholder)')
    expect(within(rerouteCommunity).getByRole('img', { name: 'Warning' })).toBeInTheDocument()
    expect(within(waitCommunity).queryByRole('img', { name: 'Warning' })).not.toBeInTheDocument()
    expect(slotCommunity).toHaveTextContent('n/a until a new slot is confirmed')
  })

  it('says what is not modeled once, across all options', () => {
    render(<ResponsePanel view={makeView()} />)
    expect(screen.getAllByText('noise, local air quality, driver pay/hours rules')).toHaveLength(1)
  })

  it('shows real community counts when they exist', () => {
    render(
      <ResponsePanel
        view={makeView({
          community: {
            wait: { schools_150m: 0, dac_tracts: [], max_diesel_pm_pctl: null },
            reroute: { schools_150m: 3, dac_tracts: ['T1', 'T2'], max_diesel_pm_pctl: 91 },
          },
        })}
      />,
    )
    const [waitCommunity, rerouteCommunity] = row('Community')
    expect(rerouteCommunity).toHaveTextContent(
      '3 schools and 2 disadvantaged tracts within 150 m (real locations, illustrative route)',
    )
    expect(within(rerouteCommunity).getByRole('img', { name: 'Warning' })).toBeInTheDocument()
    expect(waitCommunity).toHaveTextContent('0 schools and 0 disadvantaged tracts within 150 m')
    expect(within(waitCommunity).queryByRole('img', { name: 'Warning' })).not.toBeInTheDocument()
  })

  it('keeps a pending slot request from looking solved', () => {
    render(<ResponsePanel view={makeView()} />)
    const [, , slotStatus] = row('Status')
    expect(slotStatus).toHaveTextContent('Pending confirmation; original deadline still applies')
    const [, , slotRisk] = row('Risk')
    expect(slotRisk).toHaveTextContent('LATE')
  })

  it('shows the no-feasible banner when wait and reroute are not on track or tight', () => {
    const lateReroute: ResponseOption = { ...reroute, risk: 'LATE', lateness_min: 15, lateness_max: 15 }
    render(<ResponsePanel view={makeView({ options: [wait, lateReroute, requestSlot] })} />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No currently feasible response: review with warehouse or customer.',
    )
  })

  it('shows the banner when reroute is UNKNOWN', () => {
    const unknownReroute: ResponseOption = {
      ...reroute,
      risk: 'UNKNOWN',
      arrival_min: null,
      arrival_max: null,
      lateness_min: null,
      lateness_max: null,
      miles: null,
      cost: null,
      co2_kg: null,
      driver_duty_min: null,
      passes_sensitive_zone: false,
      status: 'Unavailable: the alternative also uses NB-03',
    }
    render(<ResponsePanel view={makeView({ options: [wait, unknownReroute, requestSlot] })} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    const [, rerouteMiles] = row('Environment: miles')
    expect(rerouteMiles).toHaveTextContent('n/a')
    const [, rerouteStatus] = row('Status')
    expect(rerouteStatus).toHaveTextContent('Unavailable: the alternative also uses NB-03')
  })

  it('does not show the banner for the reference fixture', () => {
    render(<ResponsePanel view={makeView()} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('words a possible lateness range', () => {
    const tight: ResponseOption = { ...wait, risk: 'TIGHT', lateness_min: 0, lateness_max: 5 }
    const range: ResponseOption = { ...reroute, risk: 'LATE', lateness_min: 20, lateness_max: 35 }
    render(<ResponsePanel view={makeView({ options: [tight, range, requestSlot] })} />)
    expect(row('Appointment').map((c) => c.textContent)).toEqual([
      'May be up to 5 min late',
      '20 to 35 min late',
      'Not confirmed yet',
    ])
  })

  it('calls onWhy with the option kind and renders the action slot', () => {
    const onWhy = vi.fn()
    render(
      <ResponsePanel
        view={makeView()}
        onWhy={onWhy}
        renderActions={(o) => <button type="button">Select {o.kind}</button>}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Why? (Reroute)' }))
    expect(onWhy).toHaveBeenCalledWith('reroute')
    expect(screen.getByRole('button', { name: 'Select wait' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select request_slot' })).toBeInTheDocument()
  })

  it('never says best or recommended, and says options are not ranked', () => {
    render(<ResponsePanel view={makeView()} />)
    expect(table().textContent).not.toMatch(/\b(best|recommended|score)\b/i)
    expect(table()).toHaveTextContent('Options are shown in a fixed order and are not ranked.')
  })
})
