// The dashboard on a live day: what is still open for each shipment as the
// clock moves. Every case here is one a dispatcher would otherwise be asked
// about wrongly: a truck that has gone past the closure, a road that has
// reopened, a load that has been delivered, a reroute chosen late.

import { afterEach, describe, expect, it } from 'vitest'
import { assumptions, getRoute, segments, setActiveIncident, shipments } from '../data/index.ts'
import { formatTime, parseTime } from '../engine/time.ts'
import { departure, routeTiming } from '../engine/timing.ts'
import { liveEvents } from '../sim/events.ts'
import { planTruck, sameProgress, switchRoute, truckStateAt } from '../sim/trucks.ts'
import type { Decision, Incident, ResponseOptionKind } from '../types.ts'
import {
  applyLiveToCards,
  applyLiveToView,
  buildLiveShipments,
  getLiveTotals,
  undoBlockedReason,
} from './live.ts'
import { isResponseOptionAvailable, isResponseOptionOpen } from './options.ts'
import { appReducer, initialState, type AppState } from './reducer.ts'
import { buildCards, buildResponseView } from './selectors.ts'
import { getTotals } from './totals.ts'
import { buildTruckPlans } from './trucks.ts'

const at = (hhmm: string) => parseTime(hhmm)
const closure = (start: string, reopen: string | null, segmentId = 'NB-03'): Incident => ({
  segment_id: segmentId,
  type: 'closure',
  start_time: start,
  reported_reopen_time: reopen,
  assumed_reopen_time: null,
  evidence_text: 'SIMULATED test closure.',
  confirmed_by_user: true,
})
const decide = (id: string, kind: ResponseOptionKind, time?: string | number): Decision => ({
  shipment_id: id,
  option_kind: kind,
  status: kind === 'request_slot' ? 'pending_confirmation' : 'selected',
  timestamp: '2026-11-14T10:00:00Z',
  ...(time === undefined ? {} : { sim_time: typeof time === 'number' ? time : at(time) }),
})

/** One shipment at one time: its live record, its card and its response panel. */
function look(id: string, time: string | number | null, decisions: Record<string, Decision> = {}, timingCase: 'slow' | 'fast' = 'slow') {
  const now = time === null ? null : typeof time === 'number' ? time : at(time)
  const live = buildLiveShipments('disrupted', decisions, timingCase, now)
  const item = live.find((entry) => entry.shipment_id === id)!
  const card = applyLiveToCards(buildCards('disrupted', decisions, []), live, (segmentId) => segmentId)
    .find((entry) => entry.shipment.id === id)!
  const view = applyLiveToView(buildResponseView(id, 'disrupted'), live)!
  const option = (kind: ResponseOptionKind) => item.options.find((entry) => entry.kind === kind)!
  return { live, item, card, view, option }
}

afterEach(() => setActiveIncident(null))

describe('without a clock nothing changes', () => {
  it('returns the engine’s options, none closed, and leaves cards and the panel alone', () => {
    const { item, card, view } = look('S-01', null)
    expect(item.state).toBeNull()
    expect(item.options.map((option) => option.closed_reason)).toEqual([null, null, null])
    expect(card).toEqual(buildCards('disrupted', {}, []).find((entry) => entry.shipment.id === 'S-01'))
    expect(view).toEqual(buildResponseView('S-01', 'disrupted'))
  })

  it('a reroute with no recorded time starts from the ready time, as on the prefilled sample', () => {
    const [plan] = buildTruckPlans('disrupted', { 'S-01': decide('S-01', 'reroute') })
    expect(plan).toMatchObject({ route_id: 'R-A-ALT', leaves: at('10:00'), arrival: at('11:28') })
  })
})

describe('a delivered load asks for nothing more', () => {
  it('moves to Delivered with what happened, and offers no response', () => {
    const { item, card, view } = look('S-01', '12:12')
    expect(item.stage).toBe('delivered')
    expect(item.options.every((option) => !isResponseOptionOpen(option))).toBe(true)
    expect(item.route_choice_open).toBe(false)
    expect(card.column).toBe('delivered')
    expect(card.delivered_at).toBe('12:12')
    expect(card.summary).toMatchObject({ risk: 'LATE', arrival_min: '12:12', arrival_max: '12:12', lateness_max: 42 })
    expect(card.summary.reason).toBe('Delivered at 12:12, 42 min after the appointment window closed at 11:30.')
    expect(card.liveDeadlines).toEqual([])
    expect(card.reroute_decide_by).toBeNull()
    expect(view.options).toEqual([])
    expect(view.closedNote).toMatch(/^Delivered at 12:12.*Nothing is left to decide for S-01\.$/)
  })

  it('is not delivered one minute earlier', () => {
    const { item, card } = look('S-01', '12:11')
    expect(item.stage).toBe('on_the_way')
    expect(card.column).toBe('needs_review')
  })

  it('says on time, early or late from the engine’s own lateness rule', () => {
    expect(look('S-08', '09:35').card.summary).toMatchObject({
      risk: 'ON_TRACK',
      reason: 'Delivered at 09:35, inside the appointment window.',
    })
    expect(look('S-02', '12:12').card.summary).toMatchObject({
      risk: 'ON_TRACK',
      reason: 'Delivered at 12:12, before the appointment window opened at 13:00.',
    })
  })

  it('keeps a recorded choice on the delivered card, in the Delivered group', () => {
    for (const kind of ['wait', 'request_slot'] as const) {
      const { card } = look('S-01', '12:30', { 'S-01': decide('S-01', kind, '10:05') })
      expect(card.column).toBe('delivered')
      expect(card.decision?.option_kind).toBe(kind)
    }
  })

  it('drops a rejection note once the load is delivered', () => {
    const live = buildLiveShipments('disrupted', {}, 'slow', at('12:30'))
    const [card] = applyLiveToCards(buildCards('disrupted', {}, ['S-01']), live, (id) => id)
    expect(card.shipment.id).toBe('S-01')
    expect(card.rejectionNote).toBeUndefined()
  })

  it('every load ends the day delivered, whatever was chosen', () => {
    const decisions = { 'S-01': decide('S-01', 'reroute', '10:20'), 'S-04': decide('S-04', 'request_slot', '10:20') }
    const live = buildLiveShipments('disrupted', decisions, 'slow', at('14:00'))
    const cards = applyLiveToCards(buildCards('disrupted', decisions, []), live, (id) => id)
    expect(cards.map((card) => card.column)).toEqual(shipments.map(() => 'delivered'))
    expect(getLiveTotals({ ...initialState, decisions }, live).atRisk).toBe(0)
  })
})

describe('once the road has reopened there is no closure left to avoid', () => {
  it('closes Reroute and Wait at the reopening time, and keeps the estimate for the trip under way', () => {
    const before = look('S-01', at('11:10') - 0.1)
    expect(isResponseOptionOpen(before.option('reroute'))).toBe(true)
    expect(isResponseOptionOpen(before.option('wait'))).toBe(true)

    const { option, item, card } = look('S-01', '11:10')
    expect(option('reroute')).toMatchObject({ available: false, arrival_max: null, cost: null })
    expect(option('reroute').closed_reason).toBe('NB-03 reopened at 11:10, so there is no closure left to avoid.')
    expect(option('reroute').status).toMatch(/^No longer possible: NB-03 reopened/)
    // The trip under way keeps its figures, so the panel still says when it will arrive.
    expect(option('wait')).toMatchObject({ available: true, arrival_max: '12:12', risk: 'LATE' })
    expect(option('wait').closed_reason).toMatch(/nothing left to wait for/)
    expect(item.route_choice_open).toBe(false)
    expect(card.liveDeadlines).toEqual(['Under way on the assigned route; NB-03 reopened at 11:10'])
    expect(card.summary.reason).toBe('Delayed by the NB-03 closure, which has ended.')
    expect(before.card.summary.reason).toMatch(/^Route uses closed segment NB-03/)
    expect(card.reroute_decide_by).toBeNull()
  })

  it('a late load stays in Needs review, because a later slot can still be requested', () => {
    const { card, option } = look('S-01', '11:30')
    expect(card.column).toBe('needs_review')
    expect(isResponseOptionOpen(option('request_slot'))).toBe(true)
  })

  it('an on-track load has nothing left to review and goes back to Monitoring', () => {
    expect(look('S-02', '11:09').card.column).toBe('needs_review')
    expect(look('S-02', '11:10').card.column).toBe('monitoring')
  })
})

describe('a truck that has left the port', () => {
  it('cannot take a route that leaves the port by a different road', () => {
    // S-04 leaves at 10:58 to reach NB-03 as it reopens; R-B-ALT starts on HARBOR-110.
    expect(isResponseOptionOpen(look('S-04', '10:57').option('reroute'))).toBe(true)
    const { option, card } = look('S-04', '10:58')
    expect(option('reroute').available).toBe(false)
    expect(option('reroute').closed_reason).toBe(
      'S-04 left the port at 10:58 on its assigned route, and route R-B-ALT leaves the port by a different road.',
    )
    expect(isResponseOptionOpen(option('wait'))).toBe(true)
    expect(card.liveDeadlines).toContain('Reroute is no longer possible')
  })

  it('can still turn off while it is on a segment both routes share', () => {
    // The road closes at 10:05, after S-01 left at 10:00. Both its routes start with PORT-01.
    setActiveIncident(closure('10:05', '11:10'))
    const { item, option } = look('S-01', '10:08')
    expect(item.stage).toBe('on_the_way')
    expect(isResponseOptionOpen(option('reroute'))).toBe(true)
    // It left on time, so the engine's own reroute estimate still holds.
    expect(option('reroute')).toMatchObject({ arrival_min: '11:15', arrival_max: '11:28', risk: 'ON_TRACK' })
    // It must be told before the turn-off at the end of PORT-01.
    expect(item.reroute_decide_by).toBe('10:12')
  })

  it('queued at the closed segment, it reroutes from where it stands', () => {
    setActiveIncident(closure('10:05', '11:10'))
    const { item, option, card } = look('S-01', '10:30')
    expect(item.stage).toBe('queued')
    expect(card.liveNote).toBe('Held at NB-03 since 10:12. Reported to reopen 11:10.')
    // 10:30 + EB-405 (45 to 52) + WH-A-APPR (20 to 24), not the 11:15 to 11:28 of a 10:00 start.
    expect(option('reroute')).toMatchObject({ arrival_min: '11:35', arrival_max: '11:46', risk: 'LATE', miles: 60 })
    expect(option('reroute').status).toBe('Estimate: alternative route R-A-ALT from 10:30, avoiding NB-03')
    // Duty counts the time already spent standing: 10:00 ready to 11:46.
    expect(option('reroute').driver_duty_min).toBe(106)
    expect(item.reroute_deadline_passed).toBe(true)
    expect(card.liveDeadlines).toContain('Reroute deadline 10:14 has passed: rerouting now may miss the appointment')
  })

  it('queued for a warehouse whose other route starts at the port, it cannot reroute', () => {
    setActiveIncident(closure('10:05', '11:10'))
    const { item, option } = look('S-07', '10:30')
    expect(item.stage).toBe('queued')
    expect(option('reroute').closed_reason).toMatch(/route R-B-ALT leaves the port by a different road/)
    expect(isResponseOptionOpen(option('wait'))).toBe(true)
  })

  it('a truck already inside the segment when it closes is not asked about at all', () => {
    // S-01 enters NB-03 at 10:10 to 10:12; the closure starts at 10:20.
    setActiveIncident(closure('10:20', '11:10'))
    const { item, card } = look('S-01', '10:30')
    expect(item.options).toEqual([])
    expect(card.column).toBe('monitoring')
    expect(card.liveDeadlines).toBeUndefined()
  })
})

describe('a reroute is timed from where the truck is, not from its ready time', () => {
  it('held at the port, the estimate gets later every minute it is not chosen', () => {
    // At the ready time it is the engine's own estimate.
    expect(look('S-01', '10:00').option('reroute')).toMatchObject({ arrival_max: '11:28', risk: 'ON_TRACK' })
    const { option, item } = look('S-01', '10:20')
    expect(option('reroute')).toMatchObject({ arrival_min: '11:35', arrival_max: '11:48', risk: 'LATE', lateness_max: 18 })
    expect(option('reroute').status).toBe('Estimate: alternative route R-A-ALT from 10:20, avoiding NB-03')
    expect(option('reroute').explanation_inputs[0]).toMatch(/ready since 10:00 and is still at the port/)
    // Both ways are now late, and the board says so.
    expect(item.no_feasible_response).toBe(true)
  })

  it('agrees with the engine: the same route timed by routeTiming from the same minute', () => {
    for (const [id, time] of [['S-01', '10:20'], ['S-03', '10:41'], ['S-04', '10:30'], ['S-07', '10:15']] as const) {
      const shipment = shipments.find((entry) => entry.id === id)!
      const { option } = look(id, time)
      const route = getRoute(option('reroute').route_id!)!
      const expected = routeTiming(route, segments, Math.max(at(time), departure(shipment, assumptions)), null)
      expect(option('reroute').arrival_min, id).toBe(formatTime(expected.arrival_min!))
      expect(option('reroute').arrival_max, id).toBe(formatTime(expected.arrival_max!))
    }
  })

  it('a truck not yet ready is unchanged: it would leave at its ready time either way', () => {
    // S-05 is ready at 10:40.
    const { item, option } = look('S-05', '10:10')
    expect(item.stage).toBe('scheduled')
    expect(option('reroute')).toEqual({ ...buildResponseView('S-05', 'disrupted')!.options[1], closed_reason: null })
  })

  it('part-way through a minute it starts on the next whole minute', () => {
    expect(look('S-01', at('10:20') + 0.4).option('reroute').arrival_max).toBe('11:49')
  })

  it('the deadlines on the card follow the clock', () => {
    expect(look('S-01', '10:01').card.liveDeadlines).toEqual([
      'Wait works only if NB-03 reopens by 10:28',
      'Reroute must be chosen by 10:02',
    ])
    expect(look('S-01', '10:29').card.liveDeadlines).toEqual([
      'NB-03 did not reopen by 10:28: waiting no longer meets the appointment',
      'Reroute deadline 10:02 has passed: rerouting now may miss the appointment',
    ])
  })

  it('too late in the day to drive the other route at all, it is closed rather than an error', () => {
    setActiveIncident(closure('10:00', null))
    const { option, item } = look('S-01', '23:30')
    expect(item.stage).toBe('held_at_port')
    expect(option('reroute').closed_reason).toBe('There is not enough of the day left to drive route R-A-ALT.')
    expect(option('reroute').available).toBe(false)
  })

  it('with no reopening time, a held truck can still be rerouted at any time', () => {
    setActiveIncident(closure('10:00', null))
    const { option, card } = look('S-01', '13:00')
    expect(card.liveNote).toBe('Held at the port: NB-03 is closed. Reopening time unknown.')
    // 13:00 + PORT-01 (10 to 12) + EB-405 (45 to 52) + WH-A-APPR (20 to 24).
    expect(option('reroute')).toMatchObject({ arrival_min: '14:15', arrival_max: '14:28', risk: 'LATE' })
    expect(isResponseOptionOpen(option('reroute'))).toBe(true)
  })
})

describe('a reroute that was chosen late', () => {
  const decisions = { 'S-01': decide('S-01', 'reroute', '10:20') }

  it('does not move the truck back in time: it leaves when the choice was made', () => {
    const [plan] = buildTruckPlans('disrupted', decisions)
    expect(plan).toMatchObject({ route_id: 'R-A-ALT', rerouted: true, departure: at('10:00'), leaves: at('10:20'), arrival: at('11:48') })
    // Until the choice it stood at the port, exactly as it would have without it.
    const [waiting] = buildTruckPlans('disrupted', {})
    for (const time of [at('09:50'), at('10:00'), at('10:19')]) {
      const { status, held_for, position } = truckStateAt(waiting, time, segments)
      expect(truckStateAt(plan, time, segments)).toMatchObject({ status, held_for, position })
    }
    expect(sameProgress(plan, waiting, at('10:20'))).toBe(true)
    expect(sameProgress(plan, waiting, at('10:21'))).toBe(false)
    expect(truckStateAt(plan, at('10:10'), segments)).toMatchObject({ status: 'at_port', held_for: 'NB-03' })
    expect(truckStateAt(plan, at('10:26'), segments)).toMatchObject({ status: 'moving', segment_id: 'PORT-01', fraction: 0.5 })
  })

  it('shows the figures it had when chosen on the card, the panel and the totals', () => {
    const { card, option, live } = look('S-01', '10:40', decisions)
    expect(card.column).toBe('decision_recorded')
    expect(card.summary).toMatchObject({ risk: 'LATE', arrival_min: '11:35', arrival_max: '11:48' })
    expect(card.liveNote).toBe('Left 10:20. On EB-405.')
    // Costlier than the same reroute from a 10:00 start: 20 more minutes on duty, same miles.
    const [wait, onTime] = buildResponseView('S-01', 'disrupted')!.options
    const late = option('reroute')
    expect(late).toMatchObject({ arrival_max: '11:48', miles: onTime.miles, co2_kg: onTime.co2_kg })
    expect(late.driver_duty_min).toBe(onTime.driver_duty_min! + 20)
    expect(late.cost!).toBeGreaterThan(onTime.cost!)
    // The figures do not drift as the clock moves on.
    expect(look('S-01', '11:30', decisions).option('reroute')).toMatchObject({ arrival_max: '11:48', cost: late.cost })

    const state: AppState = { ...initialState, decisions }
    const none: AppState = { ...initialState }
    const totals = getLiveTotals(state, live)
    const planned = getLiveTotals(none, buildLiveShipments('disrupted', {}, 'slow', at('10:40')))
    // The total moves by the late reroute's own cost, not by that of a 10:00 start.
    expect(totals.cost! - planned.cost!).toBe(late.cost! - wait.cost!)
    expect(planned).toEqual(getTotals(none))
  })

  it('cannot be swapped for Wait or undone once the truck is on its way', () => {
    const state: AppState = {
      ...initialState,
      decisions,
      lastDecisionChange: { shipmentId: 'S-01', previousDecision: null, wasRejected: false },
    }
    // In the minute the choice is made the truck has not moved yet.
    expect(undoBlockedReason(state, 'slow', at('10:20'))).toBeNull()
    expect(isResponseOptionOpen(look('S-01', '10:20', decisions).option('wait'))).toBe(true)

    expect(undoBlockedReason(state, 'slow', at('10:21'))).toMatch(/already acted on this choice: it is on route R-A-ALT/)
    const { option } = look('S-01', '10:21', decisions)
    expect(option('wait').closed_reason).toBe('S-01 is already on route R-A-ALT and cannot go back to wait for NB-03.')
    expect(option('wait').available).toBe(false)
    // The reroute it is on keeps its figures, but cannot be chosen a second time.
    expect(option('reroute')).toMatchObject({ available: true, arrival_max: '11:48' })
    expect(option('reroute').closed_reason).toBe('S-01 is already on route R-A-ALT.')
    expect(isResponseOptionOpen(option('request_slot'))).toBe(true)
  })

  it('chosen before the truck is ready, it can still be undone until the truck leaves', () => {
    const early = { 'S-05': decide('S-05', 'reroute', '10:10') }
    const state: AppState = {
      ...initialState,
      decisions: early,
      lastDecisionChange: { shipmentId: 'S-05', previousDecision: null, wasRejected: false },
    }
    expect(undoBlockedReason(state, 'slow', at('10:30'))).toBeNull()
    expect(isResponseOptionOpen(look('S-05', '10:30', early).option('wait'))).toBe(true)
    // S-05 is ready at 10:40 and leaves on the other route then.
    expect(undoBlockedReason(state, 'slow', at('10:41'))).toMatch(/can no longer be undone/)
  })

  it('a Wait or a slot request can be undone at any time before delivery, never after', () => {
    for (const kind of ['wait', 'request_slot'] as const) {
      const state: AppState = {
        ...initialState,
        decisions: { 'S-01': decide('S-01', kind, '10:05') },
        lastDecisionChange: { shipmentId: 'S-01', previousDecision: null, wasRejected: false },
      }
      expect(undoBlockedReason(state, 'slow', at('11:40'))).toBeNull()
      expect(undoBlockedReason(state, 'slow', at('12:12'))).toMatch(/was delivered at 12:12/)
      // The prefilled sample has no clock, so nothing there is ever blocked.
      expect(undoBlockedReason(state, 'slow', null)).toBeNull()
    }
  })

  it('from the queue at the closed segment: the truck turns off there, and the log says so', () => {
    setActiveIncident(closure('10:05', '11:10'))
    const queued = { 'S-01': decide('S-01', 'reroute', '10:30') }
    const [plan] = buildTruckPlans('disrupted', queued)
    expect(plan.legs.map((leg) => leg.segment_id)).toEqual(['PORT-01', 'EB-405', 'WH-A-APPR'])
    expect(plan).toMatchObject({ leaves: at('10:00'), arrival: at('11:46') })
    expect(truckStateAt(plan, at('10:20'), segments)).toMatchObject({ status: 'waiting', segment_id: 'NB-03' })
    expect(truckStateAt(plan, at('10:31'), segments)).toMatchObject({ status: 'moving', segment_id: 'EB-405' })
    const texts = liveEvents([plan], closure('10:05', '11:10'), at('10:31'), {
      segmentName: (id) => id,
      destinationName: () => 'WH-A',
    }).map((event) => event.text)
    expect(texts).toContain('S-01 is held at NB-03, which is closed.')
    expect(texts).toContain('S-01 turned off before NB-03 onto route R-A-ALT.')
    expect(texts.join(' ')).not.toMatch(/held at EB-405/)
  })

  it('a truck never moves backwards or jumps when a reroute is chosen, at any minute', () => {
    setActiveIncident(closure('10:05', '11:10'))
    for (const shipment of shipments) {
      const [base] = buildTruckPlans('disrupted', {}).filter((plan) => plan.shipment_id === shipment.id)
      for (let time = at('09:00'); time <= at('12:30'); time += 7) {
        const [item] = buildLiveShipments('disrupted', {}, 'slow', time).filter((entry) => entry.shipment_id === shipment.id)
        const reroute = item.options.find((option) => option.kind === 'reroute')
        if (!reroute || !isResponseOptionOpen(reroute)) continue
        const [plan] = buildTruckPlans('disrupted', { [shipment.id]: decide(shipment.id, 'reroute', time) })
          .filter((entry) => entry.shipment_id === shipment.id)
        // At the moment of choosing, the truck is where it was.
        expect(sameProgress(plan, base, time), `${shipment.id} ${formatTime(time)}`).toBe(true)
        expect(truckStateAt(plan, time, segments).position, `${shipment.id} ${formatTime(time)}`)
          .toEqual(truckStateAt(base, time, segments).position)
        // And it arrives when the option said it would, slow case.
        expect(formatTime(plan.arrival!), `${shipment.id} ${formatTime(time)}`).toBe(reroute.arrival_max)
      }
    }
  })

  it('the fast case arrives at the early end of the same option', () => {
    const { option } = look('S-01', '10:20', {}, 'fast')
    const [plan] = buildTruckPlans('disrupted', { 'S-01': decide('S-01', 'reroute', '10:20') }, 'fast')
    expect(formatTime(plan.arrival!)).toBe(option('reroute').arrival_min)
  })
})

describe('switchRoute', () => {
  const s01 = shipments.find((shipment) => shipment.id === 'S-01')!
  const assigned = getRoute('R-A-ORIG')!
  const alternative = getRoute('R-A-ALT')!
  const base = (incident: Incident) => planTruck(s01, assigned, segments, incident, assumptions, 'slow')

  it('refuses once the truck has entered a segment the new route does not have', () => {
    const plan = base(closure('10:05', '11:10'))
    // 11:10: NB-03 has reopened and the truck is on it.
    expect(switchRoute(plan, assigned, alternative, segments, at('11:10'))).toBeNull()
    expect(switchRoute(plan, assigned, alternative, segments, at('11:09'))).not.toBeNull()
  })

  it('refuses once the truck has arrived', () => {
    const plan = base(closure('10:05', '11:10'))
    expect(switchRoute(plan, assigned, alternative, segments, plan.arrival!)).toBeNull()
  })

  it('refuses a route with no shared start once the truck has left the port', () => {
    const s04 = shipments.find((shipment) => shipment.id === 'S-04')!
    const plan = planTruck(s04, getRoute('R-B-ORIG')!, segments, closure('10:00', '11:10'), assumptions)
    const other = getRoute('R-B-ALT')!
    expect(switchRoute(plan, getRoute('R-B-ORIG')!, other, segments, plan.leaves! - 1)).not.toBeNull()
    expect(switchRoute(plan, getRoute('R-B-ORIG')!, other, segments, plan.leaves!)).toBeNull()
  })

  it('lets the engine refuse a trip that would run past midnight', () => {
    const plan = base(closure('10:00', null))
    expect(() => switchRoute(plan, assigned, alternative, segments, at('23:30'))).toThrow(RangeError)
  })
})

describe('totals on a live day', () => {
  it('match the planned-day totals until something is delivered', () => {
    const state: AppState = { ...initialState, decisions: { 'S-02': decide('S-02', 'wait', '10:05') } }
    const live = buildLiveShipments('disrupted', state.decisions, 'slow', at('10:30'))
    expect(getLiveTotals(state, live)).toEqual(getTotals(state))
  })

  it('stop counting a load as at risk once it is delivered, late or not', () => {
    const none: AppState = { ...initialState }
    const atRisk = (time: string) => getLiveTotals(none, buildLiveShipments('disrupted', {}, 'slow', at(time))).atRisk
    expect(atRisk('11:00')).toBe(getTotals(none).atRisk)
    // S-04 and S-07 arrive at 12:06; S-01 and S-03 follow.
    expect(atRisk('12:06')).toBe(getTotals(none).atRisk - 2)
    expect(atRisk('13:00')).toBe(0)
  })

  it('refuse a committed decision the engine has no option for', () => {
    const state: AppState = { ...initialState, decisions: { 'S-08': decide('S-08', 'reroute', '10:05') } }
    const live = buildLiveShipments('disrupted', {}, 'slow', at('10:30'))
    expect(() => getLiveTotals(state, live)).toThrow(/Invalid committed decision for S-08/)
  })
})

describe('the options the panel shows stay honest', () => {
  it('never offers an open option with no figures, and never ranks', () => {
    for (const time of ['10:00', '10:30', '10:58', '11:10', '11:45', '12:30']) {
      for (const shipment of shipments) {
        const { view } = look(shipment.id, time)
        for (const option of view.options) {
          if (isResponseOptionOpen(option)) expect(isResponseOptionAvailable(option)).toBe(true)
          expect(JSON.stringify(option)).not.toMatch(/\bbest\b|recommend/i)
        }
        expect(view.options.map((option) => option.kind)).toEqual(
          view.options.length === 0 ? [] : ['wait', 'reroute', 'request_slot'],
        )
      }
    }
  })
})

describe('the reducer on a live day', () => {
  const start = appReducer(initialState, { type: 'set_scenario', scenario: 'disrupted' })
  const choose = (state: AppState, shipmentId: string, optionKind: ResponseOptionKind, simTime?: number) =>
    appReducer(state, {
      type: 'select_option',
      shipmentId,
      optionKind,
      timestamp: '2026-11-14T19:46:36.081Z',
      ...(simTime === undefined ? {} : { simTime }),
    })

  it('records the simulated time of a choice, and none on the prefilled sample', () => {
    expect(choose(start, 'S-01', 'reroute', 620.4).decisions['S-01'].sim_time).toBe(620.4)
    expect(choose(start, 'S-01', 'reroute').decisions['S-01']).not.toHaveProperty('sim_time')
    expect(() => choose(start, 'S-01', 'reroute', 1440)).toThrow(/Simulated time/)
    expect(() => choose(start, 'S-01', 'reroute', Number.NaN)).toThrow(/Simulated time/)
  })

  it('when the clock is moved back, choices made after the new time are forgotten', () => {
    let state = choose(start, 'S-01', 'reroute', at('10:20'))
    state = choose(state, 'S-04', 'wait', at('10:40'))
    state = appReducer(state, { type: 'preview', shipmentId: 'S-04', optionKind: 'reroute', timestamp: '2026-11-14T19:46:36.081Z' })

    const same = appReducer(state, { type: 'clock_rewound', time: at('10:45') })
    expect(same).toBe(state)

    const rewound = appReducer(state, { type: 'clock_rewound', time: at('10:30') })
    expect(Object.keys(rewound.decisions)).toEqual(['S-01'])
    expect(rewound.previewDecision).toBeNull()
    // The undo for the forgotten choice goes with it.
    expect(rewound.lastDecisionChange).toBeNull()

    expect(appReducer(rewound, { type: 'clock_rewound', time: at('10:00') }).decisions).toEqual({})
  })

  it('a rewind keeps the undo for a choice that still stands, unless undoing would bring back a later one', () => {
    let state = choose(start, 'S-01', 'wait', at('10:10'))
    state = choose(state, 'S-04', 'wait', at('10:20'))
    // S-04 is forgotten; the last change was S-04's, so no undo is left.
    expect(appReducer(state, { type: 'clock_rewound', time: at('10:15') }).lastDecisionChange).toBeNull()

    let again = choose(start, 'S-04', 'wait', at('10:20'))
    again = choose(again, 'S-01', 'wait', at('10:10'))
    const rewound = appReducer(again, { type: 'clock_rewound', time: at('10:15') })
    expect(Object.keys(rewound.decisions)).toEqual(['S-01'])
    expect(rewound.lastDecisionChange?.shipmentId).toBe('S-01')
  })

  it('choices on the prefilled sample have no time and are never forgotten', () => {
    const state = choose(start, 'S-01', 'reroute')
    expect(appReducer(state, { type: 'clock_rewound', time: 0 })).toBe(state)
  })
})
