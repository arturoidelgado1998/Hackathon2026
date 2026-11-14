import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'
import { getShipmentAssessment, REFERENCE_SHIPMENT_ID } from './data/index.ts'

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

  it('starts in Disrupted with affected shipments ready for review', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Disrupted' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('count-needs_review')).toHaveTextContent('6')
    expect(screen.getByTestId('count-monitoring')).toHaveTextContent('4')
    expect(region('Current situation')).toHaveTextContent('Closure on NB-03')
    expect(region('Response options')).toHaveTextContent('Select a shipment to compare responses.')
  })

  it('shows engine deadlines on every affected card and explains shipment urgency order', () => {
    render(<App />)
    const review = region('Needs review')
    expect(review).toHaveTextContent(
      'Earliest reroute deadline first; missing deadlines after known ones. No currently feasible response last. Ties: shipment ID.',
    )
    expect(Array.from(review.querySelectorAll('[data-shipment-id]'), (card) =>
      card.getAttribute('data-shipment-id'),
    )).toEqual(['S-04', 'S-01', 'S-07', 'S-02', 'S-05', 'S-03'])
    expect(cardFor('S-01')).toHaveTextContent('Wait works only if NB-03 reopens by 10:28')
    expect(cardFor('S-01')).toHaveTextContent('Reroute must be chosen by 10:02')
    for (const card of review.querySelectorAll<HTMLElement>('[data-shipment-id]')) {
      const assessment = getShipmentAssessment(card.dataset.shipmentId!, 'disrupted')
      expect(card).toHaveTextContent(`Wait works only if NB-03 reopens by ${assessment.reopen_needed_by}`)
      expect(card).toHaveTextContent(`Reroute must be chosen by ${assessment.reroute_decide_by}`)
    }
    expect(cardFor('S-06')).not.toHaveTextContent('Reroute must be chosen')
    fireEvent.click(cardFor('S-04'))
    expect(region('Response options')).not.toHaveTextContent('No currently feasible response:')
  })

  it('keeps Normal available with all ten shipments in Monitoring', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Normal' }))
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('count-monitoring')).toHaveTextContent('10')
    expect(screen.getByTestId('count-needs_review')).toHaveTextContent('0')
    expect(region('Current situation')).toHaveTextContent('No active incident.')
    expect(region('Map panel')).toHaveTextContent('Select a shipment to see its routes')
    expect(region('Response options')).toHaveTextContent('Select a shipment to compare responses.')
    expect(region('Triage board')).toHaveTextContent('No shipments affected by the current incident')
  })

  it('announces interpretation and AI failure without changing the plan or enabling incident entry', () => {
    const { rerender } = render(<App incidentInterpretationStatus="loading" />)
    const situation = region('Current situation')
    expect(within(situation).getByRole('status')).toHaveTextContent('Interpreting incident…')
    expect(screen.getByRole('button', { name: 'Report incident' })).toBeDisabled()
    fireEvent.click(cardFor(REFERENCE_SHIPMENT_ID))
    const totals = region('Indicators').textContent
    fireEvent.click(screen.getByRole('button', { name: 'Preview Reroute' }))

    rerender(<App incidentInterpretationStatus="unavailable" />)

    expect(within(situation).queryByRole('status')).not.toBeInTheDocument()
    expect(within(situation).getByRole('alert')).toHaveTextContent('AI unavailable: use manual entry')
    expect(cardFor(REFERENCE_SHIPMENT_ID)).toHaveAttribute('aria-pressed', 'true')
    expect(region('Response options')).toHaveTextContent('Preview only: Reroute.')
    expect(region('Indicators').textContent).toBe(totals)
    expect(screen.getByRole('button', { name: 'Report incident' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Use reroute' }))
    expect(region('Response options')).toHaveTextContent('Reroute recorded for S-01.')
    rerender(<App />)
    expect(within(situation).queryByRole('alert')).not.toBeInTheDocument()
    expect(region('Response options')).toHaveTextContent('Reroute recorded for S-01.')
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
    expect(within(region('Monitoring')).getByText('S-06')).toBeInTheDocument()
  })

  it('shows the reference shipment trade-off when it is selected', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor(REFERENCE_SHIPMENT_ID))

    expect(cardFor(REFERENCE_SHIPMENT_ID)).toHaveAttribute('aria-pressed', 'true')

    const responses = region('Response options')
    for (const title of ['Wait', 'Reroute', 'Request later slot']) {
      expect(within(responses).getByRole('columnheader', { name: title })).toBeInTheDocument()
    }
    // Reference shipment values from the team's feature service (max-arrival case).
    expect(responses).toHaveTextContent('30 to 42 min late')
    expect(responses).toHaveTextContent('$169')
    expect(responses).toHaveTextContent('$167')
    expect(responses).toHaveTextContent('+15 mi')
    expect(responses).toHaveTextContent('+23.5 kg')
    expect(responses).toHaveTextContent(
      '9 schools and 31 disadvantaged tracts within 150 m (real locations, illustrative route)',
    )
    expect(responses).toHaveTextContent('Requires confirmation; original deadline still applies')

    expect(region('Current situation')).toHaveTextContent('Closure on NB-03')

    const map = region('Map panel')
    expect(map).toHaveTextContent('Original route')
    expect(map).toHaveTextContent('Alternative route')
    expect(map).toHaveTextContent('Closed')
  })

  it('shows no options for an unaffected shipment', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor('S-06'))
    expect(region('Response options')).toHaveTextContent(
      'No response needed: this shipment is not affected by an incident.',
    )
  })

  it('shows the no-feasible banner for a shipment nothing fixes', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor('S-03'))
    expect(region('Response options')).toHaveTextContent(
      'No currently feasible response: review with warehouse or customer.',
    )
  })

  it('resets to Disrupted with nothing selected', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor(REFERENCE_SHIPMENT_ID))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(screen.getByRole('button', { name: 'Disrupted' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('count-monitoring')).toHaveTextContent('4')
    expect(screen.getByTestId('count-needs_review')).toHaveTextContent('6')
    expect(cardFor(REFERENCE_SHIPMENT_ID)).toHaveAttribute('aria-pressed', 'false')
    expect(region('Response options')).toHaveTextContent('Select a shipment to compare responses.')
  })

  it('previews without committing, then records decisions and keeps pending risk in totals', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor(REFERENCE_SHIPMENT_ID))
    const originalTotals = region('Indicators').textContent

    fireEvent.click(screen.getByRole('button', { name: 'Preview Reroute' }))
    expect(screen.getByRole('status')).toHaveTextContent('Preview only: Reroute.')
    expect(screen.getByRole('status')).toHaveFocus()
    expect(region('Indicators').textContent).toBe(originalTotals)
    expect(within(region('Needs review')).getByText(REFERENCE_SHIPMENT_ID)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use reroute' }))
    expect(screen.getByRole('status')).toHaveTextContent('Reroute recorded for S-01.')
    expect(screen.getByRole('status')).toHaveFocus()
    expect(screen.getByRole('status')).not.toHaveTextContent('Preview only')
    expect(within(region('Decision recorded')).getByText(REFERENCE_SHIPMENT_ID)).toBeInTheDocument()
    expect(within(cardFor(REFERENCE_SHIPMENT_ID)).getByText('ON TRACK')).toBeInTheDocument()
    expect(region('Indicators').textContent).not.toBe(originalTotals)
    const selectedTotals = region('Indicators').textContent

    fireEvent.click(screen.getByRole('button', { name: 'Preview Wait' }))
    expect(region('Indicators').textContent).toBe(selectedTotals)
    expect(within(region('Decision recorded')).getByText(REFERENCE_SHIPMENT_ID)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Request slot' }))
    expect(screen.getByRole('status')).toHaveTextContent('Slot request recorded for S-01.')
    expect(region('Response options')).toHaveTextContent(
      'Awaiting confirmation; original deadline still applies',
    )
    expect(
      within(region('Awaiting confirmation')).getByText(REFERENCE_SHIPMENT_ID),
    ).toBeInTheDocument()
    expect(within(cardFor(REFERENCE_SHIPMENT_ID)).getByText('LATE')).toBeInTheDocument()
    expect(region('Indicators').textContent).toBe(originalTotals)
  })

  it('offers Reject all on each Needs review shipment and leaves a rejection note', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    expect(
      within(region('Needs review')).getAllByRole('button', { name: /Reject all options for/ }),
    ).toHaveLength(6)

    fireEvent.click(
      screen.getByRole('button', { name: `Reject all options for ${REFERENCE_SHIPMENT_ID}` }),
    )
    expect(within(region('Needs review')).getByText(REFERENCE_SHIPMENT_ID)).toBeInTheDocument()
    expect(cardFor(REFERENCE_SHIPMENT_ID).parentElement).toHaveTextContent(
      'Dispatcher rejected all options',
    )
  })

  it('restores a fresh dashboard after decisions, previews and an open explanation', () => {
    const { container } = render(<App />)
    const freshDashboard = container.cloneNode(true)
    fireEvent.click(screen.getByRole('button', { name: /Assumptions & sources.*Expand panel/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor(REFERENCE_SHIPMENT_ID))
    fireEvent.click(screen.getByRole('button', { name: 'Use reroute' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview Wait' }))
    expect(screen.getByRole('button', { name: 'Preview Wait' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Why? (Wait)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(container.isEqualNode(freshDashboard)).toBe(true)
  })

  it('guides first use and resets the compact empty-group disclosure', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Normal' }))
    expect(screen.getByText('Explore the sample disruption:').parentElement).toHaveTextContent(
      'switch to Disrupted, then select a shipment under Needs review to compare responses.',
    )
    const show = screen.getByRole('button', { name: 'Show 3 empty groups' })
    expect(show).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(show)
    expect(screen.getByRole('button', { name: 'Hide 3 empty groups' }))
      .toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    expect(screen.queryByText('Explore the sample disruption:')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 empty groups' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByRole('button', { name: 'Show 2 empty groups' }))
      .toHaveAttribute('aria-expanded', 'false')
  })

  it('undoes a first choice, restores current-plan totals and risk, and leaves focus in context', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor(REFERENCE_SHIPMENT_ID))
    const originalTotals = region('Indicators').textContent
    fireEvent.click(screen.getByRole('button', { name: 'Use reroute' }))

    fireEvent.click(screen.getByRole('button', { name: 'Undo last choice' }))

    expect(within(region('Needs review')).getByText(REFERENCE_SHIPMENT_ID)).toBeInTheDocument()
    expect(within(cardFor(REFERENCE_SHIPMENT_ID)).getByText('LATE')).toBeInTheDocument()
    expect(region('Indicators').textContent).toBe(originalTotals)
    expect(screen.queryByRole('button', { name: 'Undo last choice' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Responses for S-01/ })).toHaveFocus()
  })

  it('undoes a slot request back to a recorded response without changing other shipments', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor(REFERENCE_SHIPMENT_ID))
    fireEvent.click(screen.getByRole('button', { name: 'Use reroute' }))
    fireEvent.click(cardFor('S-02'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose wait' }))
    fireEvent.click(cardFor(REFERENCE_SHIPMENT_ID))
    const previousTotals = region('Indicators').textContent
    fireEvent.click(screen.getByRole('button', { name: 'Request slot' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo last choice' }))

    for (const id of [REFERENCE_SHIPMENT_ID, 'S-02']) {
      expect(within(region('Decision recorded')).getByText(id)).toBeInTheDocument()
    }
    expect(region('Indicators').textContent).toBe(previousTotals)
    expect(region('Response options')).toHaveTextContent(
      'Requires confirmation; original deadline still applies',
    )
    expect(screen.getByRole('status')).toHaveTextContent('Reroute recorded for S-01.')
  })

  it('cancels a preview without losing the recorded choice, totals or available Undo', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    fireEvent.click(cardFor(REFERENCE_SHIPMENT_ID))
    fireEvent.click(screen.getByRole('button', { name: 'Use reroute' }))
    const totals = region('Indicators').textContent
    fireEvent.click(screen.getByRole('button', { name: 'Preview Wait' }))
    expect(screen.getByRole('status')).toHaveTextContent('Preview only: Wait.')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }))

    expect(screen.getByRole('status')).not.toHaveTextContent('Preview only')
    expect(screen.getByRole('status')).toHaveTextContent('Reroute recorded for S-01.')
    expect(region('Indicators').textContent).toBe(totals)
    expect(screen.getByRole('button', { name: 'Use reroute' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Undo last choice' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Responses for S-01/ })).toHaveFocus()
  })

  it('keeps focus in the queue when revisiting a shipment with a recorded choice', () => {
    render(<App />)
    fireEvent.click(cardFor(REFERENCE_SHIPMENT_ID))
    fireEvent.click(screen.getByRole('button', { name: 'Use reroute' }))
    fireEvent.click(cardFor('S-02'))

    const card = cardFor(REFERENCE_SHIPMENT_ID)
    card.focus()
    fireEvent.click(card)

    expect(card).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Reroute recorded for S-01.')
  })
})
