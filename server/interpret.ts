// Turns one report into a validated interpretation, or a clear error.
// There is no third outcome: a model answer that fails any check is rejected
// whole, so the dispatcher never sees a partial or guessed incident.

import {
  validateInterpretation,
  type AllowedSegment,
  type IncidentInterpretation,
} from '../src/incident/interpretation.ts'
import { askModel, type ModelConfig, type ModelFailure } from './model.ts'
import { buildModelRequest } from './prompt.ts'

/** Long enough for a real incident report; short enough that nothing else fits. */
export const MAX_REPORT_CHARS = 2000

export type InterpretFailure =
  | { code: 'bad_request'; message: string }
  | { code: 'not_configured'; message: string }
  | (ModelFailure & { details?: string[] })

export type InterpretResult =
  | { ok: true; interpretation: IncidentInterpretation }
  | ({ ok: false } & InterpretFailure)

export interface InterpretDeps {
  /** Null when the server has no usable model settings. */
  config: ModelConfig | null
  /** Why `config` is null, for the error message. */
  configProblem?: string
  segments: AllowedSegment[]
  fetchImpl?: typeof fetch
}

export async function interpretReport(report: unknown, deps: InterpretDeps): Promise<InterpretResult> {
  if (typeof report !== 'string' || report.trim() === '') {
    return { ok: false, code: 'bad_request', message: 'Send the incident report as text in "report".' }
  }
  if (report.length > MAX_REPORT_CHARS) {
    return {
      ok: false,
      code: 'bad_request',
      message: `The report is too long: ${report.length} characters, and the limit is ${MAX_REPORT_CHARS}.`,
    }
  }
  if (!deps.config) {
    return {
      ok: false,
      code: 'not_configured',
      message: deps.configProblem ?? 'The AI service is not set up on this server.',
    }
  }

  const text = report.trim()
  const reply = await askModel(deps.config, buildModelRequest(text, deps.segments, deps.config.model), deps.fetchImpl)
  if (!reply.ok) return reply

  const checked = validateInterpretation(reply.answer, text, deps.segments)
  if (!checked.ok) {
    return {
      ok: false,
      code: 'invalid_model_response',
      message: 'The AI\'s reading of the report failed the checks, so it was discarded. Enter the incident manually.',
      details: checked.errors,
    }
  }
  return { ok: true, interpretation: checked.interpretation }
}
