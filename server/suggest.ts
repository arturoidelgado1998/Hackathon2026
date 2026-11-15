// Asks the model which response it would suggest for one shipment, and returns
// the suggestion only if it passes every check in src/suggestion/suggestion.ts.
//
// The model is given the option facts the dashboard already shows, and
// nothing else. It returns an option, the measures it rests on and one
// sentence. It returns no figures: the dashboard prints those from its data.

import {
  MAX_REASONS,
  NOTE_TARGET_CHARS,
  WEIGHING,
  parseShipmentFacts,
  suggestionSchema,
  validateSuggestion,
  type CheckedSuggestion,
  type ShipmentFacts,
} from '../src/suggestion/suggestion.ts'
import type { Served } from './interpret.ts'
import { askModel, type ModelConfig, type ModelFailure, type ModelRequest } from './model.ts'

/** The name of the answer; the function name where the provider answers through a function call. */
export const SUGGEST_FUNCTION = 'suggest_response'

const INSTRUCTIONS = `You help a port dispatcher weigh the response options for one delayed shipment.

You suggest; the dispatcher decides. Your suggestion is shown as a suggestion, next to what it gives up.

What to weigh:
${WEIGHING.map((line) => `- ${line}`).join('\n')}

Rules:
- Use only the facts given below. They are simulated estimates from the dashboard. Do not add facts, places, causes or figures of your own.
- suggested_option is one available option, or null to make no suggestion. Never suggest an option marked unavailable.
- request_slot is a pending request, not a solution. Suggest it only when no other option is on track.
- because lists up to ${MAX_REASONS} measures on which your suggested option is better than the other option. Each one is checked against the facts; a measure that is not really better makes the whole answer invalid.
- note is one plain sentence to the dispatcher, at most ${NOTE_TARGET_CHARS} characters. Write no numbers or times in it, and do not call any option best or recommended.
- For every measure, less is better: less lateness, lower risk, earlier arrival, lower cost, shorter driver duty, fewer schools and disadvantaged tracts passed, fewer miles, less CO2.`

/** The question put to the model for one shipment. */
export function buildSuggestRequest(facts: ShipmentFacts, model: string): ModelRequest {
  return {
    model,
    system: INSTRUCTIONS,
    user: `Facts for one shipment (JSON, simulated estimates):\n${JSON.stringify(facts)}`,
    answer: {
      name: SUGGEST_FUNCTION,
      description: 'Give your suggestion for this shipment.',
      schema: suggestionSchema(facts),
    },
  }
}

export type SuggestFailure =
  | { code: 'bad_request'; message: string }
  | { code: 'not_configured'; message: string }
  | (ModelFailure & { details?: string[]; served?: Served })

export type SuggestResult =
  | { ok: true; suggestion: CheckedSuggestion; served?: Served }
  | ({ ok: false } & SuggestFailure)

export interface SuggestDeps {
  config: ModelConfig | null
  configProblem?: string
  fetchImpl?: typeof fetch
}

export async function suggestResponse(input: unknown, deps: SuggestDeps): Promise<SuggestResult> {
  const parsed = parseShipmentFacts(input)
  if (!parsed.ok) return { ok: false, code: 'bad_request', message: parsed.error }
  if (!deps.config) {
    return { ok: false, code: 'not_configured', message: deps.configProblem ?? 'The AI service is not set up on this server.' }
  }

  const reply = await askModel(deps.config, buildSuggestRequest(parsed.facts, deps.config.model), deps.fetchImpl)
  if (!reply.ok) return reply

  const checked = validateSuggestion(reply.answer, parsed.facts)
  if (!checked.ok) {
    return {
      ok: false,
      code: 'invalid_model_response',
      message: 'The AI\'s suggestion failed the checks, so it was discarded. Compare the options yourself.',
      details: checked.errors,
      served: { model: reply.model, ...(reply.usage ? { usage: reply.usage } : {}) },
    }
  }
  return {
    ok: true,
    suggestion: checked.suggestion,
    served: { model: reply.model, ...(reply.usage ? { usage: reply.usage } : {}) },
  }
}
