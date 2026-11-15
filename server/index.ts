// Starts the incident-interpretation server.
//
//   npm run server        reads .env if it exists, listens on 127.0.0.1:8787
//
// The dashboard reaches it through the dev server's proxy (vite.config.ts), so
// the browser never talks to the model and never sees the key.

import { createServer } from 'node:http'
import segmentsJson from '../src/data/segments.json' with { type: 'json' }
import { createApp } from './app.ts'
import { readModelConfig } from './model.ts'

const port = Number(process.env.PORT) || 8787
const settings = readModelConfig(process.env)
const segments = segmentsJson.items.map(({ id, name }) => ({ id, name }))

const server = createServer(
  createApp({
    config: settings.ok ? settings.config : null,
    configProblem: settings.ok ? undefined : settings.message,
    segments,
    maxPerMinute: Number(process.env.AI_MAX_PER_MINUTE) > 0 ? Number(process.env.AI_MAX_PER_MINUTE) : undefined,
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  }),
)

// This machine only: the endpoint has no sign-in, so it is not offered to the network.
server.listen(port, '127.0.0.1', () => {
  console.log(`Incident server on http://127.0.0.1:${port}`)
  console.log(
    settings.ok
      ? `AI: ${settings.config.provider}, model ${settings.config.model}`
      : `AI: off. ${settings.message} Manual entry still works.`,
  )
})
