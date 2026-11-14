// Does the built app actually work in a browser? The unit tests run in jsdom
// with the ArcGIS map replaced by a stand-in, so this is the only check that
// loads the real bundle, the real map chunk and the real styles.
//
// It serves dist/ and drives headless Chromium through the main flow.
// Needs dist/ (`npm run build`) and a browser
// (`npx playwright install --only-shell chromium`).
//
// The map needs WebGL and Esri's servers, which a test runner may not have.
// So the dashboard checks hold the map chunk back (which also exercises the
// pane's fallback), and one check at the end loads the real map.

import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import type { Browser, Locator, Page } from 'playwright'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ROOT, fromRoot, readJson } from './helpers.ts'

interface ScenarioEntry {
  summary: { affected: boolean }
  options: { kind: string }[]
}

// What the page should show is read from the app's own data, so refreshing
// the data from the feature service does not break these checks.
const shipmentIds = readJson<{ items: { id: string }[] }>('src', 'data', 'shipments.json').items.map(
  (s) => s.id,
)
const responses = readJson<{
  reference_shipment_id: string
  incident: { segment_id: string }
  scenarios: { disrupted: Record<string, ScenarioEntry> }
}>('src', 'data', 'sample-responses.json')
const disrupted = responses.scenarios.disrupted
const affectedIds = shipmentIds.filter((id) => disrupted[id].summary.affected)
const referenceId = responses.reference_shipment_id

let server: PreviewServer
let browser: Browser
let origin = ''
let page: Page
/** Uncaught errors thrown in the page. */
let pageErrors: string[] = []
/** The app's own files that failed to load. */
let failedLoads: string[] = []

const region = (name: string) => page.getByRole('region', { name, exact: true })
const card = (shipmentId: string) => page.locator(`[data-shipment-id="${shipmentId}"]`)
const scenarioButton = (name: 'Normal' | 'Disrupted') => page.getByRole('button', { name, exact: true })
const text = async (locator: Locator) => (await locator.textContent()) ?? ''

beforeAll(async () => {
  if (!existsSync(fromRoot('dist', 'index.html'))) {
    throw new Error('dist/index.html is missing. Run `npm run build` first, or use `npm run sanity`.')
  }
  server = await preview({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 4173, strictPort: false },
  })
  const address = server.httpServer.address()
  if (address === null || typeof address === 'string') throw new Error('The preview server did not start.')
  origin = `http://127.0.0.1:${address.port}`

  try {
    // Lets the map use software WebGL on machines with no graphics card.
    browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
  } catch (error) {
    throw new Error(
      'Could not start Chromium. Run `npx playwright install --only-shell chromium` once, then try again.',
      { cause: error },
    )
  }
})

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

/** A fresh page on the app for each check. `realMap` lets the ArcGIS map load. */
async function openApp({ realMap = false } = {}) {
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  page.setDefaultTimeout(10_000)
  pageErrors = []
  failedLoads = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      failedLoads.push(`${response.status()} ${response.url()}`)
    }
  })
  if (!realMap) await page.route('**/assets/ArcgisMap-*.js', (route) => route.abort())
  await page.goto(origin)
  await page.getByRole('heading', { level: 1, name: 'PortPlan' }).waitFor()
}

afterEach(async () => {
  await page?.close()
})

describe('built app in a browser', () => {
  it('starts with no errors and shows every shipment', async () => {
    await openApp()

    await page.getByText('SIMULATED').first().waitFor()
    await expect(page.title()).resolves.toBe('PortPlan')
    expect(await page.locator('[data-shipment-id]').count()).toBe(shipmentIds.length)
    for (const id of shipmentIds) expect(await card(id).count(), id).toBe(1)

    // The dashboard opens on the simulated closure, so there is work to triage.
    expect(await scenarioButton('Disrupted').getAttribute('aria-pressed')).toBe('true')
    expect(await text(page.getByTestId('count-needs_review'))).toBe(String(affectedIds.length))
    expect(await text(region('Current situation'))).toContain(responses.incident.segment_id)

    // Normal operations stay one click away.
    await scenarioButton('Normal').click()
    expect(await text(page.getByTestId('count-monitoring'))).toBe(String(shipmentIds.length))
    expect(await text(region('Current situation'))).toContain('No active incident')
    await scenarioButton('Disrupted').click()

    // The stylesheet applied: the three panes sit side by side on a wide screen.
    const board = await region('Triage board').boundingBox()
    const options = await region('Response options').boundingBox()
    expect(board && options && options.x >= board.x + board.width - 1).toBe(true)

    // With the map held back, the pane says so and the dashboard carries on.
    await region('Map panel').getByText('The map could not load.').waitFor()

    expect(failedLoads).toEqual([])
    expect(pageErrors).toEqual([])
  })

  it('moves the affected shipments to Needs review when the closure starts', async () => {
    await openApp()
    await scenarioButton('Disrupted').click()

    expect(await scenarioButton('Disrupted').getAttribute('aria-pressed')).toBe('true')
    expect(await text(page.getByTestId('count-needs_review'))).toBe(String(affectedIds.length))
    expect(await text(page.getByTestId('count-monitoring'))).toBe(
      String(shipmentIds.length - affectedIds.length),
    )
    expect(await text(region('Current situation'))).toContain(responses.incident.segment_id)
    expect(pageErrors).toEqual([])
  })

  it('compares the responses for the reference shipment', async () => {
    await openApp()
    await scenarioButton('Disrupted').click()
    await card(referenceId).click()

    expect(await card(referenceId).getAttribute('aria-pressed')).toBe('true')
    const options = region('Response options')
    for (const title of ['Wait', 'Reroute', 'Request later slot']) {
      await options.getByRole('columnheader', { name: title, exact: true }).waitFor()
    }
    // Options are shown for comparison, never ranked.
    expect(await text(options)).not.toMatch(/\b(best|recommended)\b/i)

    const routes = await text(region('Map panel'))
    expect(routes).toContain('Original route')
    expect(routes).toContain('Alternative route')
    expect(routes).toContain('Closed')
    expect(pageErrors).toEqual([])
  })

  it('opens every shipment in both scenarios without breaking the page', async () => {
    await openApp()
    for (const scenario of ['Normal', 'Disrupted'] as const) {
      await scenarioButton(scenario).click()
      for (const id of shipmentIds) {
        await card(id).click()
        // Checked first, so a crash is reported as the error and not as a timeout.
        expect(pageErrors, `errors after opening ${id} (${scenario})`).toEqual([])
        expect(await card(id).getAttribute('aria-pressed'), `${id} ${scenario}`).toBe('true')
        expect(await text(region('Map panel')), `${id} ${scenario}`).toContain(`Shipment ${id}`)
        const options = await text(region('Response options'))
        expect(options, `${id} ${scenario}`).toContain(id)
        const hasTable = (await region('Response options').getByRole('table').count()) > 0
        const expectTable = scenario === 'Disrupted' && disrupted[id].options.length > 0
        expect(hasTable, `${id} ${scenario} comparison table`).toBe(expectTable)
      }
    }
    await page.getByRole('heading', { level: 1, name: 'PortPlan' }).waitFor()
    expect(pageErrors).toEqual([])
  })

  it('goes back to the starting state with nothing selected on Reset', async () => {
    await openApp()
    await scenarioButton('Normal').click()
    await card(referenceId).click()
    await page.getByRole('button', { name: 'Reset', exact: true }).click()

    // Reset returns to the simulated closure the dashboard opens on.
    expect(await scenarioButton('Disrupted').getAttribute('aria-pressed')).toBe('true')
    expect(await card(referenceId).getAttribute('aria-pressed')).toBe('false')
    expect(await text(page.getByTestId('count-needs_review'))).toBe(String(affectedIds.length))
    expect(await text(region('Map panel'))).toContain('Select a shipment to see its routes')
    expect(pageErrors).toEqual([])
  })

  it('loads the real map chunk, and starts the map where the browser can', async () => {
    await openApp({ realMap: true })
    await scenarioButton('Disrupted').click()
    await card(referenceId).click()
    const routes = region('Map panel')

    // The lazy chunk with the ArcGIS SDK must load and run from the build.
    await routes.locator('arcgis-map').waitFor({ state: 'attached', timeout: 60_000 })
    expect(await routes.getByText('The map could not load.').count()).toBe(0)
    expect(failedLoads).toEqual([])

    // Whether the view itself starts depends on WebGL and on reaching Esri's
    // servers. Where it can start, it must start cleanly.
    const hasWebgl = await page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null)
    const started =
      hasWebgl &&
      (await page
        .waitForFunction(
          () => (document.querySelector('arcgis-map') as { ready?: boolean } | null)?.ready === true,
          undefined,
          { timeout: 30_000 },
        )
        .then(() => true)
        .catch(() => false))
    if (started) {
      expect(pageErrors).toEqual([])
      console.info('Routes pane: the ArcGIS map view started.')
    } else {
      console.warn(
        hasWebgl
          ? 'Routes pane: the map chunk loaded, but the view did not start within 30 s (is Esri reachable?). Map view not checked.'
          : 'Routes pane: the map chunk loaded, but this browser has no WebGL. Map view not checked.',
      )
    }

    // Either way the route list is there and the dashboard still responds.
    const list = await text(routes)
    expect(list).toContain('Original route')
    expect(list).toContain('Closed')
    const last = shipmentIds[shipmentIds.length - 1]
    await card(last).click()
    expect(await text(routes)).toContain(`Shipment ${last}`)
  })
})
