// The call to the language model. The team's provider is AI Squared's Bolt,
// reached through an OpenAI-compatible chat completions endpoint, so this is a
// plain HTTPS request with no SDK.
//
// The API key is read from the server's environment, sent only in the
// Authorization header, and never logged, returned or put in an error message.


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

export type ModelAnswer = { ok: true; answer: unknown } | ({ ok: false } & ModelFailure)

/** Reasoning models can take a while; past this the dispatcher is better served by manual entry. */
export const MODEL_TIMEOUT_MS = 60_000

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The model settings from the environment, or the reason they cannot be used.
 * The key is only ever sent over HTTPS, except to a server on this machine.
 */
export function readModelConfig(
  env: Record<string, string | undefined>,
): { ok: true; config: ModelConfig } | { ok: false; message: string } {
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

/** A chat completions request that offers the model one function and asks it to call it. */
export interface ModelRequest {
  model: string
  messages: { role: 'system' | 'user'; content: string }[]
  temperature: number
  tools: { type: 'function'; function: { name: string; description: string; parameters: object } }[]
  tool_choice: { type: 'function'; function: { name: string } }
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
  let response: Response
  try {
    response = await post(config, request, fetchImpl)
    // Some OpenAI-compatible servers do not accept a forced function call or
    // a temperature. Ask once more without them; the validator still applies.
    if (response.status === 400 || response.status === 422) {
      const { model, messages, tools } = request
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

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, code: 'invalid_model_response', message: 'The AI service did not answer in JSON.' }
  }
  const answer = answerFrom(body, request.tool_choice.function.name)
  if (answer === undefined) {
    return { ok: false, code: 'invalid_model_response', message: 'The AI did not return a structured answer.' }
  }
  return { ok: true, answer }
}
