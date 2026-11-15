import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { createAccess, createLocalOnlyGuard } from './server/access.ts'
import { createDriverNoticeRelay } from './server/driverNotices.ts'
import { createSimRelay } from './server/simRelay.ts'

// One gate for everything this server offers other devices. A request from
// this computer is always allowed; another device needs the key, which is new
// each time the server starts unless RELAY_KEY sets it.
const access = createAccess({ key: process.env.RELAY_KEY })

/**
 * Serves the driver notice relay (issue #35) from the dev and the preview
 * server, so a phone on the same network gets the dispatcher's updates.
 * Start either with `--host` to make it reachable from another device.
 */
function driverNoticeRelay(): Plugin {
  const shipments = JSON.parse(
    readFileSync(new URL('./src/data/shipments.json', import.meta.url), 'utf8'),
  ) as { items: { id: string }[] }
  const known = new Set(shipments.items.map((shipment) => shipment.id))
  const isKnownShipment = (id: string) => known.has(id)
  return {
    name: 'portplan-driver-notice-relay',
    configureServer(server) {
      const relay = createDriverNoticeRelay({
        isKnownShipment,
        listening: () => server.httpServer?.address() ?? null,
        access,
      })
      server.middlewares.use(relay)
      server.httpServer?.once('close', relay.close)
    },
    configurePreviewServer(server) {
      const relay = createDriverNoticeRelay({
        isKnownShipment,
        listening: () => server.httpServer.address(),
        access,
      })
      server.middlewares.use(relay)
      server.httpServer.once('close', relay.close)
    },
  }
}

/**
 * Serves the simulation relay from the dev and the preview server, so the
 * simulation page can drive dashboards on this computer and, with `--host`,
 * on other devices on the same network.
 */
function simRelay(): Plugin {
  return {
    name: 'routeripple-sim-relay',
    configureServer(server) {
      const relay = createSimRelay({ listening: () => server.httpServer?.address() ?? null, access })
      server.middlewares.use(relay)
      server.httpServer?.once('close', relay.close)
    },
    configurePreviewServer(server) {
      const relay = createSimRelay({ listening: () => server.httpServer.address(), access })
      server.middlewares.use(relay)
      server.httpServer.once('close', relay.close)
    },
  }
}

// The AI server (npm run server) holds the model key. The browser calls it
// through this proxy, so it only ever talks to its own origin.
const aiServer = { target: 'http://127.0.0.1:8787', changeOrigin: false }
const aiProxy = { '/incident': aiServer, '/shipment': aiServer }

/**
 * Keeps the AI on this computer. The proxy below would otherwise hand the AI
 * endpoints to every device that can reach a server started with `--host`,
 * and each call spends the model key. Other devices get the pages and the
 * relays; only the dispatcher's own browser gets the AI. No key opens this.
 */
function aiLocalOnly(): Plugin {
  const guard = createLocalOnlyGuard(Object.keys(aiProxy))
  return {
    name: 'routeripple-ai-local-only',
    configureServer(server) {
      server.middlewares.use(guard)
    },
    configurePreviewServer(server) {
      server.middlewares.use(guard)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), aiLocalOnly(), driverNoticeRelay(), simRelay()],
  server: { proxy: aiProxy },
  preview: { proxy: aiProxy },
  build: {
    // Three pages: the dashboard, the driver notice page (issue #34) and the simulation page.
    rolldownOptions: {
      input: { main: 'index.html', driver: 'driver.html', simulation: 'simulation.html' },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.{ts,tsx}'],
  },
})
