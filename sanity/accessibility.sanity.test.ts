import { createRequire } from 'node:module'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AxeCore } from 'vitest-axe'
import { ROOT } from './helpers.ts'

declare global {
  interface Window {
    axe: typeof AxeCore
  }
}

let server: ViteDevServer
let browser: Browser
let page: Page
let origin: string
const axeScript = createRequire(import.meta.url).resolve('axe-core/axe.min.js')
const region = (name: string) => page.getByRole('region', { name, exact: true })
const card = (id: string) => page.locator(`[data-shipment-id="${id}"]`)
const button = (name: string) => page.getByRole('button', { name, exact: true })

beforeAll(async () => {
  // Source-server checks need no build; the existing browser suite checks dist/.
  server = await createServer({
    root: ROOT,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('Accessibility server did not start')
  origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

afterEach(async () => {
  await page?.close()
})

async function openApp(width = 1440) {
  page = await browser.newPage({ viewport: { width, height: 1000 } })
  // Like the existing dashboard sanity checks, isolate UI from WebGL/network access.
  await page.route('**/src/map/ArcgisMap.tsx*', (route) => route.abort())
  // The prefilled sample; without ?sample the page waits for live updates.
  await page.goto(`${origin}/?sample`)
  await page.getByRole('heading', { name: 'PortPlan', exact: true }).waitFor()
}

async function tabTo(target: Locator) {
  for (let count = 0; count < 100; count++) {
    if (await target.evaluate((element) => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Not reachable by Tab: ${await target.textContent()}`)
}

async function audit() {
  await page.addScriptTag({ path: axeScript })
  const result = await page.evaluate(async () => {
    const results = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    })
    const contrast = results.passes.find(({ id }) => id === 'color-contrast')
    const ratios = contrast?.nodes.flatMap(({ any }) =>
      any.filter(({ id }) => id === 'color-contrast')
        .map(({ data }) => data?.contrastRatio)
        .filter((value) => typeof value === 'number' && Number.isFinite(value)),
    ) ?? []
    return {
      serious: results.violations
        .filter(({ impact }) => impact === 'serious' || impact === 'critical')
        .map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
      contrastFailures: results.violations.filter(({ id }) => id === 'color-contrast'),
      contrastIncomplete: results.incomplete.filter(({ id }) => id === 'color-contrast'),
      contrastPasses: contrast?.nodes.length ?? 0,
      minimumContrast: ratios.length ? Math.min(...ratios) : null,
    }
  })
  expect(result.serious).toEqual([])
  expect(result.contrastFailures).toEqual([])
  expect(result.contrastIncomplete).toEqual([])
  expect(result.contrastPasses).toBeGreaterThan(0)
  expect(result.minimumContrast).not.toBeNull()
  expect(result.minimumContrast).toBeGreaterThanOrEqual(4.5)
}

describe('dashboard accessibility in Chromium', () => {
  it('supports keyboard shipment → preview → select → Reset, with contextual focus', async () => {
    await openApp()
    const totals = await region('Indicators').textContent()
    await tabTo(card('S-01'))
    await page.keyboard.press('Enter')
    expect(await card('S-01').getAttribute('aria-pressed')).toBe('true')
    expect(await card('S-01').evaluate((element) => ({
      focused: element === document.activeElement,
      style: getComputedStyle(element).outlineStyle,
      width: getComputedStyle(element).outlineWidth,
    }))).toEqual({ focused: true, style: 'dashed', width: '3px' })

    await tabTo(button('Preview Reroute'))
    await page.keyboard.press('Enter')
    expect(await region('Indicators').textContent()).toBe(totals)
    expect(await region('Response options').getByRole('status').textContent()).toContain('Preview only')
    expect(await region('Response options').getByRole('status')
      .evaluate((element) => element === document.activeElement)).toBe(true)

    await tabTo(button('Use reroute'))
    await page.keyboard.press('Enter')
    expect(await region('Decision recorded').textContent()).toContain('S-01')
    expect(await region('Indicators').textContent()).not.toBe(totals)
    await audit()

    await tabTo(button('Reset'))
    await page.keyboard.press('Enter')
    expect(await button('Disrupted').getAttribute('aria-pressed')).toBe('true')
    expect(await card('S-01').getAttribute('aria-pressed')).toBe('false')
    expect(await region('Indicators').textContent()).toBe(totals)
    expect(await region('Response options').textContent()).toContain('Select a shipment')

    await tabTo(card('S-01'))
    await page.keyboard.press('Enter')
    await tabTo(button('Why? (Reroute)'))
    await page.keyboard.press('Enter')
    expect(await region('Reroute: inputs and steps')
      .evaluate((element) => element === document.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    expect(await button('Why? (Reroute)')
      .evaluate((element) => element === document.activeElement)).toBe(true)

    const assumptions = page.getByRole('button', { name: /Assumptions & sources.*Expand panel/ })
    await tabTo(assumptions)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Escape')
    expect(await assumptions.evaluate((element) => element === document.activeElement)).toBe(true)
  })

  it('keeps mobile feedback outside table scrolling, Reject all spaced, and text contrast accessible', async () => {
    await openApp()
    await audit()
    for (const width of [1440, 1024, 760, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await button('Reset').click()
      await card('S-01').click()
      const spacing = await button('Reject all options for S-01').evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const shipment = element.parentElement?.previousElementSibling?.getBoundingClientRect()
        return { gap: shipment ? bounds.top - shipment.bottom : 0, height: bounds.height }
      })
      expect(spacing.gap).toBeGreaterThanOrEqual(8)
      expect(spacing.height).toBeGreaterThanOrEqual(44)

      await button('Preview Reroute').click()
      const comparison = region('Response options')
      const feedback = comparison.locator('.responses-feedback')
      const table = comparison.getByRole('region', {
        name: 'Response comparison (scroll horizontally for all options)',
      })
      expect(await table.locator('.responses-feedback').count()).toBe(0)
      if (width <= 760) {
        expect(await comparison.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
          .toBe(true)
        if (width === 390) {
          expect(await table.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
        }
        await table.evaluate((element) => { element.scrollLeft = element.scrollWidth })
        await button('Cancel preview').scrollIntoViewIfNeeded()
        const bounds = await feedback.boundingBox()
        expect(bounds).not.toBeNull()
        if (!bounds) throw new Error('Preview feedback is not visible')
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      }
    }
    await page.setViewportSize({ width: 1440, height: 2000 })
    // At mobile widths a horizontally clipped cell is an axe "incomplete", not
    // a contrast measurement. Use enough desktop space to measure the full table.
    await button('Reset').click()
    await card('S-01').click()
    await audit()
    await button('Normal').click()
    await audit()
    await button('Reset').click()
    await card('S-03').click()
    await audit()
  })
})
