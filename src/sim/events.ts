// Live annotations for the dashboard: what has happened so far, and a short
// note on where each shipment is now. Everything is read off the truck trips,
// which come from the engine; nothing here calculates travel.

import { formatTime } from '../engine/time.ts'
import { parseTime } from '../engine/time.ts'
import type { Incident } from '../types.ts'
import type { TruckPlan, TruckState } from './trucks.ts'

export interface LiveEvent {
  /** Minutes since midnight. */
  time: number
  kind: 'incident' | 'shipment'
  text: string
}

export interface EventNames {
  segmentName: (segmentId: string) => string
  destinationName: (shipmentId: string) => string
}

/** Everything that has happened up to `now`, newest first. */
export function liveEvents(
  plans: readonly TruckPlan[],
  incident: Incident | null,
  now: number,
  names: EventNames,
): LiveEvent[] {
  const events: LiveEvent[] = []
  if (incident) {
    const start = parseTime(incident.start_time)
    const reopenText = incident.assumed_reopen_time ?? incident.reported_reopen_time
    events.push({
      time: start,
      kind: 'incident',
      text: `Closure reported on ${incident.segment_id}, ${names.segmentName(incident.segment_id)}. ${
        reopenText === null ? 'No reopening time reported.' : `Reported to reopen ${reopenText} (estimate).`
      }`,
    })
    if (reopenText !== null) {
      events.push({ time: parseTime(reopenText), kind: 'incident', text: `${incident.segment_id} reopened.` })
    }
  }
  for (const plan of plans) {
    if (plan.held_for !== null) {
      events.push({
        time: plan.departure,
        kind: 'shipment',
        text: `${plan.shipment_id} is held at the port: ${plan.held_for} is closed.`,
      })
    }
    if (plan.leaves !== null) {
      events.push({
        time: plan.leaves,
        kind: 'shipment',
        text: plan.rerouted
          ? `${plan.shipment_id} left the port on route ${plan.route_id}.`
          : `${plan.shipment_id} left the port.`,
      })
    }
    for (const leg of plan.legs) {
      if (leg.enter === null || leg.enter > leg.arrive) {
        events.push({
          time: leg.arrive,
          kind: 'shipment',
          text: `${plan.shipment_id} is held at ${leg.segment_id}, which is closed.`,
        })
      }
    }
    if (plan.arrival !== null) {
      events.push({
        time: plan.arrival,
        kind: 'shipment',
        text: `${plan.shipment_id} arrived at ${names.destinationName(plan.shipment_id)}.`,
      })
    }
  }
  return events.filter((event) => event.time <= now).sort((a, b) => b.time - a.time)
}

/** One line for a shipment card: where the truck is right now. */
export function liveNote(
  plan: TruckPlan,
  state: TruckState,
  segmentName: (segmentId: string) => string,
): string {
  switch (state.status) {
    case 'at_port':
      if (state.held_for !== null) {
        return state.wait_until === null
          ? `Held at the port: ${state.held_for} is closed. Reopening time unknown.`
          : `Held at the port: ${state.held_for} is closed. Leaves ${formatTime(state.wait_until)}.`
      }
      return `At the port. Leaves ${formatTime(plan.leaves ?? plan.departure)}.`
    case 'waiting': {
      const leg = plan.legs.find((item) => item.segment_id === state.segment_id)
      const since = leg ? ` since ${formatTime(leg.arrive)}` : ''
      return state.wait_until === null
        ? `Held at ${state.segment_id}${since}. Reopening time unknown.`
        : `Held at ${state.segment_id}${since}. Reported to reopen ${formatTime(state.wait_until)}.`
    }
    case 'moving':
      return `Left ${formatTime(plan.leaves ?? plan.departure)}. On ${segmentName(state.segment_id!)}.`
    case 'arrived':
      return plan.arrival === null ? 'Arrived.' : `Arrived ${formatTime(plan.arrival)}.`
  }
}
