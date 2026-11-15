import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App.tsx'

const region = (name: string) => screen.getByRole('region', { name })
const card = (shipmentId: string) => document.querySelector(`[data-shipment-id="${shipmentId}"]`) as HTMLElement

const suggestion = {
  suggested_option: 'reroute',
  because: [{ measure: 'risk', against: 'wait' }],
  gives_up: [],
  pending: false,
  note: 'Rerouting keeps the appointment, at a cost to the people along the alternative route.',
}

afterEach(() => vi.unstubAllGlobals())

describe('AI suggestion in the dashboard', () => {
  it('is never requested unasked: opening shipments calls nothing', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    for (const id of ['S-01', 'S-07', 'S-03']) fireEvent.click(card(id))
    expect(screen.getByRole('region', { name: 'AI suggestion' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('selects nothing and changes no card, total or button when a suggestion arrives', async () => {
    const fetchMock = vi.fn(async () => Response.json({ suggestion }))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    fireEvent.click(card('S-07'))
    const totals = region('Indicators').textContent
    const queue = region('Triage board').textContent

    fireEvent.click(screen.getByRole('button', { name: 'Ask the AI for a suggestion' }))
    expect(await screen.findByText(/The AI leans towards/)).toHaveTextContent('Reroute')

    // One request, to this origin, and nothing on the board moved.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]).toEqual(['/shipment/suggest', expect.objectContaining({ method: 'POST' })])
    expect(region('Indicators').textContent).toBe(totals)
    expect(region('Triage board').textContent).toBe(queue)
    expect(within(region('Needs review')).getByText('S-07')).toBeInTheDocument()

    // No option is pressed, previewed or recorded: the dispatcher has chosen nothing.
    const options = region('Response options')
    for (const name of ['Preview Wait', 'Preview Reroute', 'Preview Request later slot', 'Choose wait', 'Use reroute', 'Request slot']) {
      expect(within(options).getByRole('button', { name })).not.toHaveAttribute('aria-pressed', 'true')
    }
    expect(options).not.toHaveTextContent('recorded for S-07')
    expect(options).not.toHaveTextContent('Preview only')

    // The dispatcher can still choose the other option, and that is what is recorded.
    fireEvent.click(within(options).getByRole('button', { name: 'Choose wait' }))
    expect(options).toHaveTextContent('Wait recorded for S-07.')
  })

  it('is cleared when another shipment is opened', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ suggestion })))
    render(<App />)
    fireEvent.click(card('S-07'))
    fireEvent.click(screen.getByRole('button', { name: 'Ask the AI for a suggestion' }))
    await screen.findByText(/The AI leans towards/)
    fireEvent.click(card('S-01'))
    expect(screen.queryByText(/The AI leans towards/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask the AI for a suggestion' })).toBeInTheDocument()
  })
})
