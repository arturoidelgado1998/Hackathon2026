import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'
import type { RiskLabel, Shipment } from './types.ts'

describe('scaffold', () => {
  it('renders the PortPlan heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'PortPlan' })).toBeInTheDocument()
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
