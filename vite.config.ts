import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
// The incident server (npm run server) holds the model key. The browser calls
// it through this proxy, so it only ever talks to its own origin.
const aiServer = { target: 'http://127.0.0.1:8787', changeOrigin: false }
const incidentProxy = { '/incident': aiServer, '/shipment': aiServer }

export default defineConfig({
  plugins: [react()],
  server: { proxy: incidentProxy },
  preview: { proxy: incidentProxy },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.{ts,tsx}'],
  },
})
