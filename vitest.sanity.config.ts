import { defineConfig } from 'vitest/config'

// Sanity checks: is the project, as a whole, still in working order?
// They run in Node against the repository and the built app, so they are kept
// apart from the unit tests in vite.config.ts.
//
//   npm run sanity        build, then run every sanity check
//   npm run test:sanity   run them against an existing dist/
export default defineConfig({
  test: {
    environment: 'node',
    include: ['sanity/**/*.sanity.test.ts'],
    // The browser check starts a server and a browser, and waits on the map.
    testTimeout: 90_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
})
