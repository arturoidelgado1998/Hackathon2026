// Is the production build complete and shaped the way the app expects?
// Needs dist/: run `npm run build` first, or `npm run sanity` to do both.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { fromRoot, readText } from './helpers.ts'

// React plus the dashboard is about 280 kB. The ArcGIS SDK is over 1 MB and
// must stay behind the lazy import in src/map/MapPanel.tsx, so a first load
// well above this means something pulled the SDK into the entry bundle.
const FIRST_LOAD_JS_BUDGET_BYTES = 500_000

let html = ''
let assets: string[] = []

/** Local files index.html loads up front, as paths inside dist/. */
function upFrontFiles(kind: 'script' | 'style'): string[] {
  const pattern =
    kind === 'script'
      ? /<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="([^"]+)"/g
      : /<link[^>]*rel="stylesheet"[^>]*\shref="([^"]+)"/g
  return [...html.matchAll(pattern)]
    .map((m) => m[1])
    .filter((url) => url.startsWith('/'))
    .map((url) => url.slice(1))
}

beforeAll(() => {
  if (!existsSync(fromRoot('dist', 'index.html'))) {
    throw new Error('dist/index.html is missing. Run `npm run build` first, or use `npm run sanity`.')
  }
  html = readText('dist', 'index.html')
  assets = readdirSync(fromRoot('dist', 'assets'))
})

describe('production build', () => {
  it('has a page with the app root and title', () => {
    expect(html).toContain('<div id="root"></div>')
    expect(html).toContain('<title>RouteRipple</title>')
    // The dev entry must have been replaced by a built bundle.
    expect(html).not.toContain('/src/main.tsx')
  })

  it('has every script and stylesheet the page loads, and none is empty', () => {
    const files = [...upFrontFiles('script'), ...upFrontFiles('style')]
    expect(upFrontFiles('script').length).toBeGreaterThan(0)
    expect(upFrontFiles('style').length).toBeGreaterThan(0)
    for (const file of files) {
      expect(existsSync(fromRoot('dist', file)), `dist/${file}`).toBe(true)
      expect(statSync(fromRoot('dist', file)).size, `dist/${file} size`).toBeGreaterThan(0)
    }
  })

  it('keeps the ArcGIS map in its own chunk, out of the first page load', () => {
    const mapChunks = assets.filter((f) => /^ArcgisMap-.+\.js$/.test(f))
    expect(mapChunks, 'the lazy map chunk').toHaveLength(1)
    expect(html).not.toContain(mapChunks[0])

    const firstLoad = upFrontFiles('script').reduce(
      (total, file) => total + statSync(fromRoot('dist', file)).size,
      0,
    )
    expect(firstLoad).toBeLessThan(FIRST_LOAD_JS_BUDGET_BYTES)
  })

  it('builds the driver page as its own small page, without the map', () => {
    const driver = readText('dist', 'driver.html')
    expect(driver).toContain('<title>RouteRipple driver notice</title>')
    expect(driver).not.toContain('/src/driver/main.tsx')
    const scripts = [...driver.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="\/([^"]+)"/g)]
      .map((m) => m[1])
    expect(scripts.length).toBeGreaterThan(0)
    // A phone must never download the dashboard's map.
    expect(scripts.filter((file) => /ArcgisMap/.test(file))).toEqual([])
    const size = scripts.reduce((total, file) => total + statSync(fromRoot('dist', file)).size, 0)
    expect(size).toBeLessThan(FIRST_LOAD_JS_BUDGET_BYTES)
  })

  it('has no server-side variable names in the browser bundle', () => {
    const leaks = assets
      .filter((f) => f.endsWith('.js'))
      .filter((f) => /\bLLM_(API_KEY|PROVIDER)\b/.test(readText('dist', 'assets', f)))
    expect(leaks).toEqual([])
  })

  it('ships the branded title and browser/mobile icons on every entry point', () => {
    for (const [entry, title] of [
      ['index.html', 'RouteRipple'],
      ['driver.html', 'RouteRipple driver notice'],
      ['simulation.html', 'RouteRipple simulation'],
    ]) {
      const source = readText('dist', entry)
      expect(source).toContain(`<title>${title}</title>`)
      const icons = [...source.matchAll(/<link[^>]*rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)]
        .map((match) => match[1])
      expect(icons, entry).toHaveLength(2)
      for (const icon of icons) {
        expect(icon, entry).toMatch(/^\//)
        expect(statSync(fromRoot('dist', icon.slice(1))).size).toBeGreaterThan(0)
      }
    }
    const touchIcon = readFileSync(fromRoot('dist', 'apple-touch-icon.png'))
    expect(touchIcon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect([touchIcon.readUInt32BE(16), touchIcon.readUInt32BE(20)]).toEqual([180, 180])
  })
})
