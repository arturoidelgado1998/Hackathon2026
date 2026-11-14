import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DriverNoticePanel } from './DriverNoticePanel.tsx'
import type { RelayStatus } from './relayChannel.ts'

const show = (phone: RelayStatus) =>
  render(<DriverNoticePanel shipmentId="S-01" draft={null} isCurrent={false} phone={phone} />)

describe('DriverNoticePanel phone delivery line', () => {
  it('gives the address to open on the phone when the relay is reachable', () => {
    show({ state: 'live', lostAt: null, lanUrls: ['http://192.168.1.20:5195'] })
    expect(screen.getByTestId('phone-delivery')).toHaveTextContent(
      'Phone delivery is on. On a phone on the same network, open http://192.168.1.20:5195/driver.html#S-01',
    )
  })

  it('says the server is local only when it was not started with --host', () => {
    show({ state: 'live', lostAt: null, lanUrls: [] })
    expect(screen.getByTestId('phone-delivery')).toHaveTextContent('this computer only')
  })

  it('says phone delivery is unavailable when the relay is off or lost', () => {
    const off = show({ state: 'off', lostAt: null, lanUrls: [] })
    expect(screen.getByTestId('phone-delivery')).toHaveTextContent(
      'Phone delivery unavailable: same browser only.',
    )
    off.unmount()
    show({ state: 'lost', lostAt: '2026-11-14T10:44:00Z', lanUrls: ['http://192.168.1.20:5195'] })
    expect(screen.getByTestId('phone-delivery')).toHaveTextContent(
      'Phone delivery unavailable: same browser only.',
    )
  })

  it('says nothing while it is still checking', () => {
    show({ state: 'checking', lostAt: null, lanUrls: [] })
    expect(screen.queryByTestId('phone-delivery')).toBeNull()
  })
})
