import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildResponseView } from '../../state/selectors.ts'
import { requestSuggestion, type SuggestionOutcome } from '../../suggestion/client.ts'
import { buildShipmentFacts } from '../../suggestion/facts.ts'
import { WEIGHING, givesUp, type ShipmentFacts } from '../../suggestion/suggestion.ts'
import { SuggestionPanel } from './SuggestionPanel.tsx'

const view = buildResponseView('S-07', 'disrupted')!
const facts = buildShipmentFacts(view)
const NOTE = 'Rerouting keeps the appointment, at a cost to the people along the alternative route.'

const answering = (outcome: SuggestionOutcome) =>
  vi.fn<(facts: ShipmentFacts) => Promise<SuggestionOutcome>>(async () => outcome)
const rerouteOutcome: SuggestionOutcome = {
  ok: true,
  suggestion: {
    suggested_option: 'reroute',
    because: [{ measure: 'appointment', against: 'wait' }],
    gives_up: givesUp('reroute', facts),
    pending: false,
    note: NOTE,
  },
}

async function ask(request: (facts: ShipmentFacts) => Promise<SuggestionOutcome>) {
  render(<SuggestionPanel view={view} request={request} />)
  fireEvent.click(screen.getByRole('button', { name: 'Ask the AI for a suggestion' }))
  return screen.findByRole('status')
}

describe('SuggestionPanel', () => {
  it('shows nothing for a shipment with no options, or with none selected', () => {
    const { container, rerender } = render(<SuggestionPanel view={null} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<SuggestionPanel view={buildResponseView('S-06', 'disrupted')} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('waits to be asked: no suggestion, and no request, until the dispatcher clicks', () => {
    const request = answering(rerouteOutcome)
    render(<SuggestionPanel view={view} request={request} />)
    const panel = screen.getByRole('region', { name: 'AI suggestion' })
    expect(panel).toHaveTextContent('Suggestion only. You decide.')
    expect(panel).toHaveTextContent('it selects nothing')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })

  it('sends the AI the same facts the table shows, and nothing else', async () => {
    const request = answering(rerouteOutcome)
    await ask(request)
    expect(request).toHaveBeenCalledExactlyOnceWith(facts)
  })

  it('shows the suggestion with figures printed from the dashboard, and all it gives up', async () => {
    const result = await ask(answering(rerouteOutcome))
    expect(result).toHaveTextContent('The AI leans towards Reroute for S-07. Nothing has been selected.')

    const [why, cost] = within(result).getAllByRole('list')
    expect(within(why).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Appointment: Meets window, against May be up to 6 min late for Wait',
    ])
    // Four downsides, although the AI named none of them.
    expect(within(cost).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Schools within 150 m: 18, against 5 for Wait',
      'Disadvantaged tracts within 150 m: 79, against 51 for Wait',
      'Miles: 45 mi, against 40 mi for Wait',
      'Est. tailpipe CO2: 67.6 kg, against 60.1 kg for Wait',
    ])
    expect(result).toHaveTextContent(`In the AI's words: ${NOTE}`)
    expect(screen.getByRole('region', { name: 'AI suggestion' })).toHaveTextContent('the AI supplied none of them')
  })

  it('shows what the AI was asked to weigh, word for word', async () => {
    await ask(answering(rerouteOutcome))
    const weighing = screen.getByText('What the AI was asked to weigh').closest('details')!
    expect(within(weighing).getAllByRole('listitem').map((li) => li.textContent)).toEqual([...WEIGHING])
  })

  it('says so when the AI makes no suggestion', async () => {
    const result = await ask(
      answering({
        ok: true,
        suggestion: { suggested_option: null, because: [], gives_up: [], pending: false, note: 'Too close to call.' },
      }),
    )
    expect(result).toHaveTextContent('The AI makes no suggestion for S-07.')
    expect(result).toHaveTextContent("In the AI's words: Too close to call.")
    expect(within(result).queryByText('What it gives up')).not.toBeInTheDocument()
  })

  it('shows a slot request as pending, never as solved', async () => {
    const result = await ask(
      answering({
        ok: true,
        suggestion: { suggested_option: 'request_slot', because: [], gives_up: [], pending: true, note: 'Worth asking.' },
      }),
    )
    expect(result).toHaveTextContent('The AI leans towards Request later slot')
    expect(result).toHaveTextContent('the original deadline still applies and nothing is solved')
  })

  it('falls back to the table when the AI cannot be asked or its answer is refused', async () => {
    const result = await ask(answering({ ok: false, message: 'The AI service could not be reached from this network.' }))
    expect(result).toHaveTextContent(
      'No AI suggestion: The AI service could not be reached from this network. Compare the options in the table yourself.',
    )
    expect(result).not.toHaveTextContent('leans towards')
  })

  it('can be dismissed, which returns to the unasked state', async () => {
    await ask(answering(rerouteOutcome))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss suggestion' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask the AI for a suggestion' })).toBeEnabled()
  })

  it('never uses the words the comparison avoids', async () => {
    await ask(answering(rerouteOutcome))
    expect(screen.getByRole('region', { name: 'AI suggestion' }).textContent).not.toMatch(/\b(best|recommended|ranked|score)\b/i)
  })
})

describe('requestSuggestion', () => {
  const server = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('posts the facts to this origin and returns the suggestion', async () => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) })
      return Response.json({ suggestion: rerouteOutcome.ok && rerouteOutcome.suggestion })
    }) as unknown as typeof fetch
    expect(await requestSuggestion(facts, fetchImpl)).toEqual(rerouteOutcome)
    expect(calls).toEqual([{ url: '/shipment/suggest', body: JSON.stringify({ facts }) }])
  })

  it('works out what the suggestion gives up itself, whatever the server says', async () => {
    const hidden = { suggested_option: 'reroute', because: [{ measure: 'risk', against: 'wait' }], gives_up: [], pending: false, note: NOTE }
    const outcome = await requestSuggestion(facts, server(200, { suggestion: hidden }))
    expect(outcome.ok && outcome.suggestion.gives_up).toEqual(givesUp('reroute', facts))
  })

  it('does not show a suggestion it cannot verify against the facts', async () => {
    const unverifiable = [
      { suggested_option: 'reroute', because: [{ measure: 'schools', against: 'wait' }], note: NOTE },
      { suggested_option: 'reroute', because: [{ measure: 'risk', against: 'wait' }], note: 'Arrives at 11:05.' },
      { suggested_option: 'reassign', because: [], note: NOTE },
      { suggested_option: 'reroute', note: NOTE },
      null,
    ]
    for (const suggestion of unverifiable) {
      expect(await requestSuggestion(facts, server(200, { suggestion }))).toEqual({
        ok: false,
        message: 'The AI suggestion could not be verified, so it is not shown.',
      })
    }
  })

  it('passes on the server\'s reason, or a plain one when there is none', async () => {
    expect(await requestSuggestion(facts, server(503, { error: 'not_configured', message: 'The AI service is not set up.' }))).toEqual({
      ok: false,
      message: 'The AI service is not set up.',
    })
    const down = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await requestSuggestion(facts, down)).toEqual({ ok: false, message: 'The AI suggestion service did not answer.' })
  })
})
