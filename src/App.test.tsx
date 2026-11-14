import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'
import type { RiskLabel, Shipment } from './types.ts'

describe('App', () => {
  it('renders the PortPlan heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'PortPlan' })).toBeInTheDocument()
  })

  it('renders the shell regions with placeholders', () => {
    render(<App />)
    expect(screen.getByRole('region', { name: 'Triage board' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Map panel' })).toHaveTextContent(
      'Select a shipment to see its routes',
    )
    expect(screen.getByRole('region', { name: 'Response options' })).toBeInTheDocument()
    expect(screen.getByText('SIMULATED')).toBeInTheDocument()
  })

  it('toggles the scenario and resets it', () => {
    render(<App />)
    const normal = screen.getByRole('button', { name: 'Normal' })
    const disrupted = screen.getByRole('button', { name: 'Disrupted' })
    expect(normal).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(disrupted)
    expect(disrupted).toHaveAttribute('aria-pressed', 'true')
    expect(normal).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(normal).toHaveAttribute('aria-pressed', 'true')
  })

  it('imports the shared types', () => {
    const risk: RiskLabel = 'UNKNOWN'
    const shipment: Shipment = {
      id: 'S1',
      destination_id: 'W1',
      cargo_ready: '07:00',
      truck_available: '07:15',
      appt_start: '09:00',
      appt_end: '10:00',
      assigned_route_id: 'R1',
    }
    expect(risk).toBe('UNKNOWN')
    expect(shipment.appt_end).toBe('10:00')
  })
})
