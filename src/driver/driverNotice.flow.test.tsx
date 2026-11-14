// The whole path: dispatcher's dashboard on one side, driver page on the
// other, joined by the same-browser channel (issue #34).

import { act, fireEvent, render, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App.tsx'
import { STORAGE_PREFIX } from './channel.ts'
import { clearDriverNotices } from './desk.ts'
import { DriverPage, REVISION_TEXT, SIMULATED_NOTICE_TEXT } from './DriverPage.tsx'
import { PENDING_INSTRUCTION, TRUCK_CAUTION } from './notice.ts'

const REROUTE = 'Use the alternative route R-A-ALT.'

function cardFor(shipmentId: string): HTMLElement {
  const card = document.querySelector(`[data-shipment-id="${shipmentId}"]`)
  if (!(card instanceof HTMLElement)) throw new Error(`No card for ${shipmentId}`)
  return card
}

function showDriverPage(shipmentId: string) {
  window.location.hash = shipmentId ? `#${shipmentId}` : ''
  act(() => {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

function setup(shipmentId = 'S-01') {
  window.location.hash = `#${shipmentId}`
  const dashboard = within(render(<App />).container)
  const driver = within(render(<DriverPage />).container)
  const panel = () => dashboard.queryByRole('region', { name: 'Driver notice' })
  const status = () => dashboard.getByTestId('driver-notice-status')
  const send = () => dashboard.getByRole('button', { name: /^Send (update )?to driver$/ })
  const click = (name: string) => fireEvent.click(dashboard.getByRole('button', { name }))
  return { dashboard, driver, panel, status, send, click }
}

const storedNotices = () =>
  Object.keys(window.localStorage).filter((key) => key.startsWith(STORAGE_PREFIX))

beforeEach(() => {
  clearDriverNotices()
  window.localStorage.clear()
})

describe('driver notice, dashboard to driver page', () => {
  it('sends nothing on Preview or on Select, only on Send', () => {
    const { driver, panel, status, send, click } = setup()
    fireEvent.click(cardFor('S-01'))
    expect(panel()).toBeNull()

    click('Preview Reroute')
    expect(panel()).toBeNull()
    expect(storedNotices()).toEqual([])
    expect(driver.getByText('No notice from dispatch for S-01.')).toBeInTheDocument()

    click('Use reroute')
    expect(status()).toHaveTextContent('Not sent')
    expect(storedNotices()).toEqual([])
    expect(driver.getByText('No notice from dispatch for S-01.')).toBeInTheDocument()

    fireEvent.click(send())
    expect(storedNotices()).toEqual([`${STORAGE_PREFIX}S-01`])
    expect(status()).toHaveTextContent(/^Sent \d\d:\d\d \(version 1\)$/)
    expect(driver.getByText(REROUTE)).toBeInTheDocument()
    expect(driver.getByText(/Notice from dispatch\./)).toBeInTheDocument()
    expect(driver.queryByText(/No notice from dispatch/)).toBeNull()
    // Sent once: the button waits for a change.
    expect(send()).toBeDisabled()
  })

  it('shows the driver exactly the text the dispatcher previewed', () => {
    const { dashboard, driver, send, click } = setup()
    fireEvent.click(cardFor('S-01'))
    click('Use reroute')
    const preview = dashboard.getByRole('region', { name: 'Driver notice' }).querySelector('dl')!
    const previewText = preview.textContent
    expect(previewText).toContain(TRUCK_CAUTION)
    expect(previewText).toContain('SIMULATED')
    expect(previewText).toContain('(estimate)')

    fireEvent.click(send())
    const delivered = driver.getByRole('region', { name: 'Notice' }).querySelector('dl')!
    expect(delivered.textContent).toBe(previewText)
  })

  it('marks the notice as being revised when the decision changes, then delivers the update', () => {
    const { driver, status, send, click } = setup()
    fireEvent.click(cardFor('S-01'))
    click('Use reroute')
    fireEvent.click(send())

    click('Request slot')
    expect(driver.getByText(REVISION_TEXT, { exact: false })).toBeInTheDocument()
    const earlier = driver.getByRole('region', { name: 'Earlier notice, being revised' })
    expect(within(earlier).getByText(REROUTE)).toBeInTheDocument()
    // The new instruction has not gone anywhere yet.
    expect(driver.queryByText(PENDING_INSTRUCTION)).toBeNull()
    expect(status()).toHaveTextContent('Changed since sent')
    expect(send()).toBeEnabled()
    expect(send()).toHaveTextContent('Send update to driver')

    fireEvent.click(send())
    expect(driver.getByText(PENDING_INSTRUCTION)).toBeInTheDocument()
    expect(driver.queryByText(REROUTE)).toBeNull()
    expect(driver.getByText(/Version 2, sent/)).toHaveTextContent('Updated: replaces the notice sent at')
    expect(status()).toHaveTextContent(/version 2/)
  })

  it('marks the notice as being revised on Undo and on a scenario switch', () => {
    const { driver, panel, send, click } = setup()
    fireEvent.click(cardFor('S-01'))
    click('Choose wait')
    fireEvent.click(send())
    click('Undo last choice')
    expect(driver.getByText(REVISION_TEXT, { exact: false })).toBeInTheDocument()
    // The panel stays, so the dispatcher can see a notice is out.
    expect(panel()).toHaveTextContent('nothing new to send')
    expect(send()).toBeDisabled()

    click('Choose wait')
    fireEvent.click(send())
    expect(driver.getByText(/Version 2, sent/)).toBeInTheDocument()
    click('Normal')
    expect(driver.getByText(REVISION_TEXT, { exact: false })).toBeInTheDocument()
  })

  it('Reset returns the driver page to the empty state', () => {
    const { driver, send, click } = setup()
    fireEvent.click(cardFor('S-01'))
    click('Use reroute')
    fireEvent.click(send())
    click('Reset')
    expect(driver.getByText('No notice from dispatch for S-01.')).toBeInTheDocument()
    expect(storedNotices()).toEqual([])
  })

  it('keeps one shipment\'s notice off another shipment\'s page', () => {
    const { driver, send, click } = setup('S-02')
    fireEvent.click(cardFor('S-01'))
    click('Use reroute')
    fireEvent.click(send())
    expect(driver.getByText('No notice from dispatch for S-02.')).toBeInTheDocument()

    showDriverPage('S-01')
    expect(driver.getByText(REROUTE)).toBeInTheDocument()
  })
})

describe('driver page', () => {
  it('always says the notice is simulated and to read it when parked', () => {
    const { driver } = setup()
    expect(driver.getByText(SIMULATED_NOTICE_TEXT)).toBeInTheDocument()
    expect(driver.getByText('Read only when parked.')).toBeInTheDocument()
    expect(driver.getByRole('heading', { level: 1 })).toHaveTextContent('Driver notice · S-01')
  })

  it('asks for a shipment when none or an unknown one is given', () => {
    const { driver } = setup('S-99')
    expect(driver.getByText(/Unknown shipment "S-99"/)).toBeInTheDocument()
    expect(driver.getAllByRole('link')).toHaveLength(10)

    showDriverPage('')
    expect(driver.getByText(/No shipment chosen/)).toBeInTheDocument()
  })

  it('has no input the driver could type into', () => {
    const { driver, send, click } = setup()
    fireEvent.click(cardFor('S-01'))
    click('Use reroute')
    fireEvent.click(send())
    expect(driver.queryAllByRole('textbox')).toEqual([])
    expect(driver.queryAllByRole('button')).toEqual([])
  })
})
