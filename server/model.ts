// The call to the language model. Two providers are supported, chosen by
// LLM_PROVIDER in the server's environment:
//
//   anthropic        the Claude API, through the official SDK (anthropic.ts)
//   anything else    an OpenAI-compatible chat completions endpoint, such as
//                    AI Squared's Bolt, through a plain HTTPS request
//
// Either way the key is read from the server's environment, sent only in a
// request header, and never logged, returned or put in an error message.

import { askClaude } from './anthropic.ts'

export interface ModelConfig {
  provider: string
  /** For example https://host/v1, with no trailing slash. */
  baseUrl: string
  model: string
  apiKey: string
}

/** Why the model produced no usable answer. Safe to show: never contains the key. */
export type ModelFailure =
  | { code: 'model_unreachable'; message: string }
  | { code: 'model_rejected'; message: string }
  | { code: 'invalid_model_response'; message: string }

/** Tokens the request used, when the provider reports them. */
export interface ModelUsage {
  input_tokens: number
  output_tokens: number
}

export type ModelAnswer =
  | { ok: true; answer: unknown; model: string; usage?: ModelUsage }
  | ({ ok: false } & ModelFailure)

/** Reasoning models can take a while; past this the dispatcher is better served by manual entry. */
export const MODEL_TIMEOUT_MS = 60_000

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export const ANTHROPIC = 'anthropic'
/** Always this address: the SDK must never pick one up from the surrounding environment. */
export const ANTHROPIC_API = 'https://api.anthropic.com'
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'

/**
 * The model settings from the environment, or the reason they cannot be used.
 * The key is only ever sent over HTTPS, except to a server on this machine.
 */
export function readModelConfig(
  env: Record<string, string | undefined>,
): { ok: true; config: ModelConfig } | { ok: false; message: string } {
  const provider = env.LLM_PROVIDER?.trim().toLowerCase() ?? ''
  if (provider === ANTHROPIC) {
    // Claude has its own variables, so the Bolt settings can stay in .env beside them.
    const apiKey = env.ANTHROPIC_API_KEY?.trim()
    if (!apiKey) {
      return { ok: false, message: 'The AI service is not set up: ANTHROPIC_API_KEY missing from the server\'s environment.' }
    }
    return {
      ok: true,
      config: {
        provider: ANTHROPIC,
        baseUrl: ANTHROPIC_API,
        model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL,
        apiKey,
      },
    }
  }
  const missing = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'].filter((name) => !env[name]?.trim())
  if (missing.length > 0) {
    return { ok: false, message: `The AI service is not set up: ${missing.join(', ')} missing from the server's environment.` }
  }
  let url: URL
  try {
    url = new URL(env.LLM_BASE_URL!.trim())
  } catch {
    return { ok: false, message: 'The AI service is not set up: LLM_BASE_URL is not a valid address.' }
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    return { ok: false, message: 'The AI service is not set up: LLM_BASE_URL must use https.' }
  }
  return {
    ok: true,
    config: {
      provider: env.LLM_PROVIDER?.trim() || 'openai-compatible',
      baseUrl: url.toString().replace(/\/+$/, ''),
      model: env.LLM_MODEL!.trim(),
      apiKey: env.LLM_API_KEY!.trim(),
    },
  }
}

/** The first JSON object in a piece of text, for models that answer in text instead of a function call. */
function jsonObjectIn(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/** One question for the model, with the shape its answer must take. Provider-neutral. */
export interface ModelRequest {
  model: string
  /** The instructions. They say what to do, not how the answer is delivered. */
  system: string
  /** The data to work on. */
  user: string
  answer: {
    /** A short identifier, used as the function name where the provider answers through a function call. */
    name: string
    description: string
    /** JSON schema of the answer. */
    schema: Record<string, unknown>
  }
}

/** The request as an OpenAI-compatible chat completions body: one function, which the model is asked to call. */
export function chatCompletionsBody(request: ModelRequest) {
  const { name, description, schema } = request.answer
  return {
    model: request.model,
    messages: [
      { role: 'system' as const, content: `${request.system}\n\nGive your answer by calling ${name} exactly once.` },
      { role: 'user' as const, content: request.user },
    ],
    temperature: 0,
    tools: [{ type: 'function' as const, function: { name, description, parameters: schema } }],
    tool_choice: { type: 'function' as const, function: { name } },
  }
}

/** Pulls the function's arguments out of a chat completions response, whichever way the model returned them. */
export function answerFrom(body: unknown, functionName: string): unknown {
  const message = (body as { choices?: { message?: Record<string, unknown> }[] })?.choices?.[0]?.message
  if (!message) return undefined
  const calls = message.tool_calls
  if (Array.isArray(calls)) {
    const call = calls.find((c) => c?.function?.name === functionName)
    const args: unknown = call?.function?.arguments
    if (typeof args === 'string') {
      try {
        return JSON.parse(args)
      } catch {
        return undefined
      }
    }
    if (typeof args === 'object' && args !== null) return args
  }
  return typeof message.content === 'string' ? jsonObjectIn(message.content) : undefined
}

async function post(config: ModelConfig, body: object, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  })
}

/**
 * Sends the request and returns the model's raw answer, unchecked.
 * The caller validates it: nothing from here is trusted.
 */
export async function askModel(
  config: ModelConfig,
  request: ModelRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelAnswer> {
  if (config.provider === ANTHROPIC) return askClaude(config, request, fetchImpl)

  const body = chatCompletionsBody(request)
  let response: Response
  try {
    response = await post(config, body, fetchImpl)
    // Some OpenAI-compatible servers do not accept a forced function call or
    // a temperature. Ask once more without them; the validator still applies.
    if (response.status === 400 || response.status === 422) {
      const { model, messages, tools } = body
      response = await post(config, { model, messages, tools }, fetchImpl)
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return {
      ok: false,
      code: 'model_unreachable',
      message: timedOut
        ? 'The AI service did not answer in time.'
        : 'The AI service could not be reached from this network.',
    }
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, code: 'model_rejected', message: 'The AI service rejected the server\'s key.' }
  }
  if (!response.ok) {
    return { ok: false, code: 'model_rejected', message: `The AI service answered with an error (HTTP ${response.status}).` }
  }

  let reply: unknown
  try {
    reply = await response.json()
  } catch {
    return { ok: false, code: 'invalid_model_response', message: 'The AI service did not answer in JSON.' }
  }
  const answer = answerFrom(reply, request.answer.name)
  if (answer === undefined) {
    return { ok: false, code: 'invalid_model_response', message: 'The AI did not return a structured answer.' }
  }
  const used = (reply as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage
  return {
    ok: true,
    answer,
    model: config.model,
    ...(typeof used?.prompt_tokens === 'number' && typeof used.completion_tokens === 'number'
      ? { usage: { input_tokens: used.prompt_tokens, output_tokens: used.completion_tokens } }
      : {}),
  }
}
