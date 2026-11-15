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

// The corridor analysis (G3) and the routes it was run on.
interface RouteRecord {
  id: string
  destination: string
  kind: 'original' | 'alternative'
  schools_150m: number
  dac_tracts: string[]
  sensitive_zone_note: string
}
const routeRecords = readJson<{ items: RouteRecord[] }>('src', 'data', 'routes.json').items
const shipmentRecords = readJson<{ items: { id: string; destination_id: string; assigned_route_id: string }[] }>(
  'src', 'data', 'shipments.json',
).items
const corridorSources = readJson<{ sources: { name: string; publisher: string; edition: string; retrieved: string }[] }>(
  'src', 'data', 'corridor.json',
).sources

/** The original and alternative route of a shipment. */
function routesOf(shipmentId: string) {
  const shipment = shipmentRecords.find((s) => s.id === shipmentId)!
  return {
    original: routeRecords.find((r) => r.id === shipment.assigned_route_id)!,
    alternative: routeRecords.find((r) => r.destination === shipment.destination_id && r.kind === 'alternative')!,
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** The community sentence the comparison table shows for a route. */
const communityText = (route: RouteRecord) =>
  `${plural(route.schools_150m, 'school', 'schools')} and ` +
  `${plural(route.dac_tracts.length, 'disadvantaged tract', 'disadvantaged tracts')} within 150 m`
/** The line the map panel shows for the route whose corridor is drawn. */
const corridorLine = (route: RouteRecord) =>
  `Within 150 m of ${route.id}: ${plural(route.schools_150m, 'school', 'schools')} and ` +
  `${route.dac_tracts.length} disadvantaged ${route.dac_tracts.length === 1 ? 'tract' : 'tracts'}.`
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
/** The option cells of one row of the comparison table: Wait, Reroute, Request later slot. */
const rowCells = (label: string) =>
  region('Response options')
    .locator('tr')
    .filter({ has: page.getByRole('rowheader', { name: label, exact: true }) })
    .getByRole('cell')

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
    // This preview runs without the project's Vite config, so it has no
    // simulation relay. The dashboard asks for it once and carries on without.
    const isSimRelay = new URL(response.url()).pathname.startsWith('/api/sim-state')
    if (response.url().startsWith(origin) && response.status() >= 400 && !isSimRelay) {
      failedLoads.push(`${response.status()} ${response.url()}`)
    }
  })
  if (!realMap) await page.route('**/assets/ArcgisMap-*.js', (route) => route.abort())
  // The prefilled sample; without ?sample the page waits for live updates.
  await page.goto(`${origin}/?sample`)
  await page.getByRole('heading', { level: 1, name: 'RouteRipple' }).waitFor()
}

afterEach(async () => {
  await page?.close()
})

describe('built app in a browser', () => {
  it('starts with no errors and shows every shipment', async () => {
    await openApp()

    // The page does not label its data as simulated, fictional or illustrative.
    await page.getByText('Est. cost').first().waitFor()
    expect(await page.getByText(/SIMULATED|fictional|Illustrative/).count()).toBe(0)
    await expect(page.title()).resolves.toBe('RouteRipple')
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
    await page.getByRole('heading', { level: 1, name: 'RouteRipple' }).waitFor()
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

  it('shows the same real community counts in the comparison and beside the map', async () => {
    await openApp()
    await card(referenceId).click()
    const { original, alternative } = routesOf(referenceId)

    // The comparison table: the original route under Wait, the alternative under Reroute.
    const community = rowCells('Community')
    expect(await text(community.nth(0))).toContain(communityText(original))
    expect(await text(community.nth(1))).toContain(communityText(alternative))
    // The script that writes the data and the app that shows it use the same words.
    for (const route of [original, alternative]) {
      // The stored note keeps its label; the page shows the sentence without it.
      if (route.sensitive_zone_note) {
        expect(route.sensitive_zone_note, route.id).toBe(`${communityText(route)} (real locations, illustrative route)`)
      }
    }

    // Beside the map: the original route first, then the route being previewed.
    const near = region('Community near the route')
    expect(await text(near)).toContain(corridorLine(original))
    expect(await text(near)).toContain('proximity, not measured exposure')
    await page.getByRole('button', { name: 'Preview Reroute', exact: true }).click()
    await near.getByText(alternative.id, { exact: true }).waitFor()
    expect(await text(near)).toContain(corridorLine(alternative))

    // Every real layer names its publisher, edition and download date.
    const sources = await text(page.getByRole('list', { name: 'Sources of the real layers', exact: true }))
    for (const source of corridorSources) {
      expect(sources).toContain(`${source.name}: ${source.publisher}, ${source.edition}; downloaded ${source.retrieved}`)
    }
    expect(pageErrors).toEqual([])
  })

  it('shows the Caltrans truck record as a record, never as a verdict', async () => {
    await openApp()
    await card(referenceId).click()

    const trucks = rowCells('Truck network (Caltrans record)')
    expect(await trucks.count()).toBe(3)
    for (const cell of [trucks.nth(0), trucks.nth(1)]) {
      const shown = (await text(cell)).replaceAll('California Legal', '')
      expect(shown.trim()).not.toBe('')
      expect(shown).not.toMatch(/\b(legal|allowed|permitted|suitable|safe)\b/i)
      expect(await cell.getAttribute('title')).toContain('not a check that a truck may use the route')
    }
    expect(pageErrors).toEqual([])
  })

  it('shows an AI suggestion only when asked, and selects nothing when it arrives', async () => {
    await openApp()
    let asked = 0
    await page.route('**/shipment/suggest', (route) => {
      asked += 1
      return route.fulfill({
        json: {
          suggestion: {
            suggested_option: 'reroute',
            because: [{ measure: 'risk', against: 'wait' }],
            gives_up: [],
            pending: false,
            note: 'Rerouting keeps the appointment, at a cost to the people along the alternative route.',
          },
        },
      })
    })
    await card(referenceId).click()
    const options = region('Response options')
    const panel = options.getByRole('region', { name: 'AI suggestion', exact: true })
    await panel.getByText('Suggestion only. You decide.').waitFor()
    expect(asked).toBe(0)
    const totals = await text(region('Indicators'))
    const needsReview = await text(page.getByTestId('count-needs_review'))

    await panel.getByRole('button', { name: 'Ask the AI for a suggestion', exact: true }).click()
    await panel.getByText('The AI leans towards').waitFor()
    expect(asked).toBe(1)

    // The figures are the dashboard's, and the downsides are listed although the reply gave none.
    const shown = await text(panel)
    const { original, alternative } = routesOf(referenceId)
    expect(shown).toContain('What it gives up')
    expect(shown).toContain(`Schools within 150 m: ${alternative.schools_150m}, against ${original.schools_150m} for Wait`)
    expect(shown).toContain('the AI supplied none of them')

    // Nothing is selected, previewed or counted because of the suggestion.
    expect(await options.locator('button[aria-pressed="true"]').count()).toBe(0)
    expect(await text(options)).not.toContain(`recorded for ${referenceId}`)
    expect(await text(region('Indicators'))).toBe(totals)
    expect(await text(page.getByTestId('count-needs_review'))).toBe(needsReview)
    // The comparison still ranks nothing, and neither does the suggestion.
    expect(await text(options)).not.toMatch(/\b(best|recommended)\b/i)
    expect(pageErrors).toEqual([])
  })

  it('carries on without a suggestion when the AI cannot be asked', async () => {
    await openApp()
    await page.route('**/shipment/suggest', (route) => route.abort())
    await card(referenceId).click()
    const panel = region('Response options').getByRole('region', { name: 'AI suggestion', exact: true })
    await panel.getByRole('button', { name: 'Ask the AI for a suggestion', exact: true }).click()
    await panel.getByText('No AI suggestion:').waitFor()
    expect(await text(panel)).toContain('Compare the options in the table yourself.')
    // The dispatcher can still choose.
    await page.getByRole('button', { name: 'Preview Reroute', exact: true }).click()
    await region('Response options').getByText('Preview only: Reroute.').waitFor()
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

  it('draws the counted schools and tracts on the real map, where the browser can', async () => {
    await openApp({ realMap: true })
    await card(referenceId).click()
    const { alternative } = routesOf(referenceId)
    const routes = region('Map panel')
    await routes.locator('arcgis-map').waitFor({ state: 'attached', timeout: 60_000 })
    await page.getByRole('button', { name: 'Preview Reroute', exact: true }).click()
    await region('Community near the route').getByText(alternative.id, { exact: true }).waitFor()

    // The map's own drawing layer must hold one graphic per counted place.
    const drawn = () =>
      page.evaluate(() => {
        interface Drawing {
          title?: string
          graphics: { filter: (test: (g: { attributes?: Record<string, unknown> }) => boolean) => { length: number } }
        }
        const map = document.querySelector('arcgis-map') as
          | { ready?: boolean; map?: { layers: { find: (test: (l: Drawing) => boolean) => Drawing | undefined } } }
          | null
        const layer = map?.ready ? map.map?.layers.find((l) => l.title === 'RouteRipple routes') : undefined
        if (!layer) return null
        const count = (key: string) => layer.graphics.filter((g) => g.attributes?.[key] !== undefined).length
        return { schools: count('schoolId'), tracts: count('tractId') }
      })
    const expected = { schools: alternative.schools_150m, tracts: alternative.dac_tracts.length }

    const hasWebgl = await page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null)
    let seen: Awaited<ReturnType<typeof drawn>> = null
    if (hasWebgl) {
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        seen = await drawn()
        if (seen && seen.schools === expected.schools && seen.tracts === expected.tracts) break
        await page.waitForTimeout(500)
      }
    }
    if (seen) {
      expect(seen, `places drawn for ${alternative.id}`).toEqual(expected)
      expect(pageErrors).toEqual([])
      console.info(`Routes pane: ${seen.schools} schools and ${seen.tracts} tracts drawn for ${alternative.id}.`)
    } else {
      console.warn('Routes pane: the map view did not start here, so the drawn schools and tracts were not checked.')
    }
    // Either way the layers and their data loaded, and the panel shows the counts.
    expect(failedLoads).toEqual([])
    expect(await text(region('Community near the route'))).toContain(corridorLine(alternative))
  })
})
