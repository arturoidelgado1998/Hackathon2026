// Asks the incident server for an AI suggestion. The browser only ever talks to
// its own origin; the server holds the model key.
//
// What comes back is checked again here against the facts that were sent, and
// what the suggestion gives up is worked out here from those facts, so the
// panel never shows a reason or a downside it cannot verify itself.

import {
  MEASURES,
  advantagesOf,
  givesUp,
  noteHasFigures,
  type CheckedSuggestion,
  type Difference,
  type Measure,
  type ShipmentFacts,
} from './suggestion.ts'
import type { ResponseOptionKind } from '../types.ts'

export type SuggestionOutcome = { ok: true; suggestion: CheckedSuggestion } | { ok: false; message: string }

const UNAVAILABLE = 'The AI suggestion service did not answer.'

export async function requestSuggestion(
  facts: ShipmentFacts,
  fetchImpl: typeof fetch = fetch,
): Promise<SuggestionOutcome> {
  let body: { suggestion?: unknown; message?: unknown }
  let ok: boolean
  try {
    const response = await fetchImpl('/shipment/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facts }),
    })
    ok = response.ok
    body = (await response.json()) as typeof body
  } catch {
    return { ok: false, message: UNAVAILABLE }
  }
  if (!ok) return { ok: false, message: typeof body?.message === 'string' ? body.message : UNAVAILABLE }

  const received = body?.suggestion as Partial<CheckedSuggestion> | undefined
  const kind = received?.suggested_option ?? null
  const option = kind === null ? undefined : facts.options.find((o) => o.kind === kind)
  if (
    !received ||
    typeof received.note !== 'string' ||
    noteHasFigures(received.note, facts) ||
    !Array.isArray(received.because) ||
    (kind !== null && !option?.available)
  ) {
    return { ok: false, message: 'The AI suggestion could not be verified, so it is not shown.' }
  }

  const comparable = option !== undefined && option.kind !== 'request_slot'
  const real = comparable ? advantagesOf(option.kind, facts) : []
  const because: Difference[] = []
  for (const claimed of received.because as Partial<Difference>[]) {
    const proof = real.find((d) => d.measure === claimed?.measure && d.against === claimed?.against)
    if (!proof || !MEASURES.includes(claimed.measure as Measure)) {
      return { ok: false, message: 'The AI suggestion could not be verified, so it is not shown.' }
    }
    because.push(proof)
  }
  return {
    ok: true,
    suggestion: {
      suggested_option: (option?.kind ?? null) as ResponseOptionKind | null,
      because,
      gives_up: comparable ? givesUp(option.kind, facts) : [],
      pending: option?.kind === 'request_slot',
      note: received.note.trim(),
    },
  }
}
