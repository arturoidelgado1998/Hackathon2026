// The Claude API, through Anthropic's official SDK.
//
// Claude answers in the required shape through structured outputs: the JSON
// schema is sent as the output format, so the reply is one JSON object. The
// server's validator still checks it; nothing from here is trusted.
//
// The address is always api.anthropic.com and the key is always the one in
// this server's settings. Neither is taken from the surrounding environment.

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_TIMEOUT_MS, type ModelAnswer, type ModelConfig, type ModelRequest } from './model.ts'

/**
 * Structured outputs need `additionalProperties: false` on every object and do
 * not take a list of types. A field that may be null is written as a choice
 * between its type and null.
 */
export function toStrictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStrictSchema)
  if (typeof schema !== 'object' || schema === null) return schema
  const node = { ...(schema as Record<string, unknown>) }
  if (node.properties && typeof node.properties === 'object') {
    node.properties = Object.fromEntries(
      Object.entries(node.properties as Record<string, unknown>).map(([key, value]) => [key, toStrictSchema(value)]),
    )
  }
  if (node.items) node.items = toStrictSchema(node.items)
  if (Array.isArray(node.type) && node.type.includes('null')) {
    const { type, enum: allowed, description, ...rest } = node
    const others = (type as string[]).filter((t) => t !== 'null')
    const values = Array.isArray(allowed) ? allowed.filter((v) => v !== null) : undefined
    return {
      ...(typeof description === 'string' ? { description } : {}),
      anyOf: [
        { ...rest, type: others.length === 1 ? others[0] : others, ...(values ? { enum: values } : {}) },
        { type: 'null' },
      ],
    }
  }
  return node
}

export async function askClaude(
  config: ModelConfig,
  request: ModelRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelAnswer> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: MODEL_TIMEOUT_MS,
    maxRetries: 1,
    fetch: fetchImpl,
  })

  let response: Anthropic.Beta.BetaMessage
  try {
    response = await client.beta.messages.create({
      model: request.model,
      max_tokens: 16000,
      // If the model declines for a policy reason, the API retries on its
      // default fallback model within the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: `${request.system}\n\nAnswer with one JSON object in the required format.`,
      messages: [{ role: 'user', content: request.user }],
      output_config: {
        // Reading a short report or weighing three options is a small task.
        effort: 'low',
        format: { type: 'json_schema', schema: toStrictSchema(request.answer.schema) as Record<string, unknown> },
      },
    })
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, code: 'model_rejected', message: 'The AI service rejected the server\'s key.' }
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, code: 'model_rejected', message: 'The AI service is limiting requests. Try again shortly.' }
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return { ok: false, code: 'model_unreachable', message: 'The AI service did not answer in time.' }
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return { ok: false, code: 'model_unreachable', message: 'The AI service could not be reached from this network.' }
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, code: 'model_rejected', message: `The AI service answered with an error (HTTP ${error.status}).` }
    }
    return { ok: false, code: 'model_unreachable', message: 'The AI service could not be reached from this network.' }
  }

  if (response.stop_reason === 'refusal') {
    return { ok: false, code: 'model_rejected', message: 'The AI declined to answer this request.' }
  }
  if (response.stop_reason === 'max_tokens') {
    return { ok: false, code: 'invalid_model_response', message: 'The AI\'s answer was cut off before it finished.' }
  }

  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
  let answer: unknown
  try {
    answer = JSON.parse(text)
  } catch {
    return { ok: false, code: 'invalid_model_response', message: 'The AI did not return a structured answer.' }
  }
  return {
    ok: true,
    answer,
    // The model that actually answered, which differs from the one asked for after a fallback.
    model: response.model,
    usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
  }
}
