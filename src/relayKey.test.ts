import { afterEach, describe, expect, it, vi } from 'vitest'

// The key is read once as the module loads, so each case loads it afresh.
async function load(search: string) {
  vi.resetModules()
  window.history.replaceState(null, '', `/driver.html${search}`)
  return import('./relayKey.ts')
}

afterEach(() => {
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('the access key in the browser', () => {
  it('has none on the dispatcher’s own computer, and leaves addresses alone', async () => {
    const { relayKey, withRelayKey } = await load('')
    expect(relayKey()).toBeNull()
    expect(withRelayKey('/api/sim-state')).toBe('/api/sim-state')
  })

  it('takes the key from the link and adds it to relay addresses', async () => {
    const { relayKey, withRelayKey } = await load('?closure=1&k=TeamDemo2026')
    expect(relayKey()).toBe('TeamDemo2026')
    expect(withRelayKey('/api/sim-state')).toBe('/api/sim-state?k=TeamDemo2026')
    expect(withRelayKey('/api/sim-state/stream?x=1')).toBe('/api/sim-state/stream?x=1&k=TeamDemo2026')
  })

  it('keeps the key for the tab after the address bar is rewritten or another page is opened', async () => {
    await load('?k=TeamDemo2026')
    const { relayKey } = await load('?closure=1&segment=NB-03')
    expect(relayKey()).toBe('TeamDemo2026')
  })

  it('ignores a malformed key', async () => {
    for (const bad of ['?k=', '?k=abc', '?k=has%20space12', '?k=%3Cscript%3E12345']) {
      expect((await load(bad)).relayKey(), bad).toBeNull()
    }
  })

  it('builds the link another device opens', async () => {
    const { keyedLink } = await load('')
    expect(keyedLink('http://192.168.1.20:5173/driver.html', '', 'S-01', 'TeamDemo2026')).toBe(
      'http://192.168.1.20:5173/driver.html?k=TeamDemo2026#S-01',
    )
    expect(keyedLink('http://192.168.1.20:5173/simulation.html', 'closure=1&speed=5', '', 'TeamDemo2026')).toBe(
      'http://192.168.1.20:5173/simulation.html?closure=1&speed=5&k=TeamDemo2026',
    )
    // No key (this computer only): the link is as it always was.
    expect(keyedLink('http://localhost:5173/driver.html', '', 'S-01', null)).toBe('http://localhost:5173/driver.html#S-01')
  })
})
