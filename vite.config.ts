import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { createDriverNoticeRelay } from './server/driverNotices.ts'
import { createSimRelay } from './server/simRelay.ts'

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
      })
      server.middlewares.use(relay)
      server.httpServer?.once('close', relay.close)
    },
    configurePreviewServer(server) {
      const relay = createDriverNoticeRelay({
        isKnownShipment,
        listening: () => server.httpServer.address(),
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
      const relay = createSimRelay({ listening: () => server.httpServer?.address() ?? null })
      server.middlewares.use(relay)
      server.httpServer?.once('close', relay.close)
    },
    configurePreviewServer(server) {
      const relay = createSimRelay({ listening: () => server.httpServer.address() })
      server.middlewares.use(relay)
      server.httpServer.once('close', relay.close)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), driverNoticeRelay(), simRelay()],
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
