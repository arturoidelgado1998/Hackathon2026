import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'
import { REFERENCE_SHIPMENT_ID } from './data/index.ts'

const region = (name: string) => screen.getByRole('region', { name })
const cardFor = (shipmentId: string) => {
  const card = document.querySelector(`[data-shipment-id="${shipmentId}"]`)
  if (!(card instanceof HTMLElement)) throw new Error(`No card for ${shipmentId}`)
  return card
}

describe('App', () => {
  it('renders the PortPlan heading and the SIMULATED badge', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'PortPlan' })).toBeInTheDocument()
    expect(screen.getByText('SIMULATED')).toBeInTheDocument()
  })

  it('starts in the normal scenario with all ten shipments in Monitoring', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('count-monitoring')).toHaveTextContent('10')
    expect(screen.getByTestId('count-needs_review')).toHaveTextContent('0')
    expect(region('Map panel')).toHaveTextContent('Select a shipment to see its routes')
    expect(region('Response options')).toHaveTextContent('Select a shipment to compare responses.')
  })

  it('moves only affected shipments to Needs review in the disrupted scenario', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    // Six of the ten sample shipments are affected by the NB-03 closure.
    expect(screen.getByTestId('count-needs_review')).toHaveTextContent('6')
    expect(screen.getByTestId('count-monitoring')).toHaveTextContent('4')
    const needsReview = region('Needs review')
    expect(within(needsReview).getByText(REFERENCE_SHIPMENT_ID)).toBeInTheDocument()
    // An unaffected shipment stays in Monitoring.
    expect(within(region('Monitoring')).getByText('SHP-002')).toBeInTheDocument()
  })

  it('shows the reference shipment trade-off when it is selected', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor(REFERENCE_SHIPMENT_ID))

    expect(cardFor(REFERENCE_SHIPMENT_ID)).toHaveAttribute('aria-pressed', 'true')

    const responses = region('Response options')
    for (const title of ['Wait', 'Reroute', 'Request later slot']) {
      expect(within(responses).getByRole('heading', { name: title })).toBeInTheDocument()
    }
    // Reference values from the team plan, section 4.4.
    expect(responses).toHaveTextContent('30 min late')
    expect(responses).toHaveTextContent('$161')
    expect(responses).toHaveTextContent('$158')
    expect(responses).toHaveTextContent('+15 mi')
    expect(responses).toHaveTextContent('+23.5 kg')
    expect(responses).toHaveTextContent('Passes a flagged zone (placeholder)')
    expect(responses).toHaveTextContent('Pending confirmation; original deadline still applies')

    const map = region('Map panel')
    expect(map).toHaveTextContent('Original route')
    expect(map).toHaveTextContent('Alternative route')
    expect(map).toHaveTextContent('Closed')
  })

  it('shows no options for an unaffected shipment', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor('SHP-002'))
    expect(region('Response options')).toHaveTextContent(
      'No response needed: this shipment is not affected by the current incident.',
    )
  })

  it('shows the no-feasible banner for a shipment nothing fixes', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor('SHP-008'))
    expect(region('Response options')).toHaveTextContent(
      'No currently feasible response: review with warehouse or customer.',
    )
  })

  it('resets to the normal scenario with nothing selected', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor(REFERENCE_SHIPMENT_ID))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('count-monitoring')).toHaveTextContent('10')
    expect(cardFor(REFERENCE_SHIPMENT_ID)).toHaveAttribute('aria-pressed', 'false')
    expect(region('Response options')).toHaveTextContent('Select a shipment to compare responses.')
  })
})
