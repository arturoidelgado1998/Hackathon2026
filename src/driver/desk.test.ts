import { beforeEach, describe, expect, it } from 'vitest'
import { createBrowserChannel, STORAGE_PREFIX, type NoticeChannel } from './channel.ts'
import { createNoticeDesk, decisionKey } from './desk.ts'
import { isDriverNotice, type DriverNotice, type DriverNoticeBody } from './types.ts'

const body: DriverNoticeBody = {
  shipment_id: 'S-01',
  destination_name: 'Summit Ridge Distribution (fictional)',
  appt_start: '11:00',
  appt_end: '11:30',
  option_kind: 'reroute',
  what_changed: 'NB-03 is closed from 10:00.',
  instruction: 'Use the alternative route R-A-ALT.',
  route_steps: ['A', 'B'],
  caution: 'Route suitability for trucks is not verified.',
  reason: 'Dispatch chose the alternative route.',
  estimated_arrival: '11:15 to 11:28',
  driver_impact: '88 min on duty: +14 min duty time vs. normal.',
}

function clock() {
  const times = ['2026-11-14T10:31:00Z', '2026-11-14T10:42:00Z', '2026-11-14T10:50:00Z']
  let i = 0
  return () => times[i++]
}

let channel: NoticeChannel

beforeEach(() => {
  window.localStorage.clear()
  channel = createBrowserChannel()
})

describe('notice channel (same browser)', () => {
  it('delivers a published notice to subscribers and keeps it for late readers', () => {
    const seen: (DriverNotice | null)[] = []
    channel.subscribe('S-01', (n) => seen.push(n))
    const desk = createNoticeDesk(channel, clock())
    const notice = desk.send(body, 'k1')

    expect(seen).toEqual([notice])
    // A driver page opened later, in another window, reads the same notice.
    expect(createBrowserChannel().latest('S-01')).toEqual(notice)
    expect(channel.latest('S-02')).toBeNull()
  })

  it('does not deliver one shipment\'s notice to another shipment\'s page', () => {
    const seen: (DriverNotice | null)[] = []
    channel.subscribe('S-02', (n) => seen.push(n))
    createNoticeDesk(channel, clock()).send(body, 'k1')
    expect(seen).toEqual([])
  })

  it('ignores stored values that are not notices', () => {
    window.localStorage.setItem(STORAGE_PREFIX + 'S-01', '{"instruction":"<b>hi</b>"}')
    window.localStorage.setItem(STORAGE_PREFIX + 'S-02', 'not json')
    expect(channel.latest('S-01')).toBeNull()
    expect(channel.latest('S-02')).toBeNull()
    expect(channel.all()).toEqual([])
  })

  it('stops delivering after unsubscribe', () => {
    const seen: (DriverNotice | null)[] = []
    const unsubscribe = channel.subscribe('S-01', (n) => seen.push(n))
    unsubscribe()
    createNoticeDesk(channel, clock()).send(body, 'k1')
    expect(seen).toEqual([])
  })
})

describe('notice desk', () => {
  it('numbers versions and records what each notice replaces', () => {
    const desk = createNoticeDesk(channel, clock())
    const first = desk.send(body, 'k1')
    const second = desk.send({ ...body, instruction: 'Keep the original route.' }, 'k2')

    expect(first).toMatchObject({ version: 1, state: 'active', replaces_sent_at: null })
    expect(second).toMatchObject({
      version: 2,
      state: 'active',
      sent_at: '2026-11-14T10:42:00Z',
      replaces_sent_at: '2026-11-14T10:31:00Z',
    })
    expect(isDriverNotice(second)).toBe(true)
    expect(desk.getSnapshot()['S-01']).toEqual({ notice: second, decisionKey: 'k2' })
  })

  it('leaves a notice alone while its decision stands', () => {
    const desk = createNoticeDesk(channel, clock())
    const sent = desk.send(body, 'k1')
    desk.reconcile({ 'S-01': 'k1' })
    expect(channel.latest('S-01')).toEqual(sent)
  })

  it('marks a sent notice as under revision when its decision changes or goes away', () => {
    const desk = createNoticeDesk(channel, clock())
    desk.send(body, 'k1')
    const seen: (DriverNotice | null)[] = []
    channel.subscribe('S-01', (n) => seen.push(n))

    desk.reconcile({ 'S-01': 'k2' })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ state: 'under_revision', version: 1 })
    // The earlier words stay readable; nothing new was sent.
    expect(seen[0]!.instruction).toBe(body.instruction)

    // A second look publishes nothing more.
    desk.reconcile({})
    expect(seen).toHaveLength(1)
  })

  it('needs Send again after a change, even if the same decision comes back', () => {
    const desk = createNoticeDesk(channel, clock())
    desk.send(body, 'k1')
    desk.reconcile({})
    desk.reconcile({ 'S-01': 'k1' })
    expect(channel.latest('S-01')!.state).toBe('under_revision')
    expect(desk.send(body, 'k1')).toMatchObject({ state: 'active', version: 2 })
  })

  it('treats notices left by an earlier dashboard session as under revision', () => {
    createNoticeDesk(channel, clock()).send(body, 'k1')
    const reloaded = createNoticeDesk(createBrowserChannel(), clock())
    expect(reloaded.getSnapshot()['S-01'].decisionKey).toBeNull()
    reloaded.reconcile({})
    expect(channel.latest('S-01')!.state).toBe('under_revision')
  })

  it('clear removes every notice and tells open pages', () => {
    const desk = createNoticeDesk(channel, clock())
    desk.send(body, 'k1')
    desk.send({ ...body, shipment_id: 'S-02' }, 'k1')
    const seen: (DriverNotice | null)[] = []
    channel.subscribe('S-02', (n) => seen.push(n))

    desk.clear()
    expect(seen).toEqual([null])
    expect(channel.all()).toEqual([])
    expect(desk.getSnapshot()).toEqual({})
  })

  it('tells subscribers when the snapshot changes', () => {
    const desk = createNoticeDesk(channel, clock())
    let changes = 0
    const unsubscribe = desk.subscribe(() => changes++)
    desk.send(body, 'k1')
    desk.reconcile({})
    desk.clear()
    unsubscribe()
    desk.send(body, 'k1')
    expect(changes).toBe(3)
  })
})

describe('decisionKey', () => {
  it('differs by scenario, option, status and time', () => {
    const base = {
      shipment_id: 'S-01',
      option_kind: 'wait',
      status: 'selected',
      timestamp: '2026-11-14T10:05:00Z',
    } as const
    const keys = new Set([
      decisionKey(base, 'disrupted'),
      decisionKey(base, 'normal'),
      decisionKey({ ...base, option_kind: 'reroute' }, 'disrupted'),
      decisionKey({ ...base, timestamp: '2026-11-14T10:06:00Z' }, 'disrupted'),
    ])
    expect(keys.size).toBe(4)
  })
})
