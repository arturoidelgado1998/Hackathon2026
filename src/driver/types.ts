// Driver notice types (issue #34, N1). Kept out of src/types.ts on purpose:
// the shared schema is fixed by D1 and other issues depend on it unchanged.
// A notice is display text only. It carries no name, sign-in or location.

import type { ResponseOptionKind, TimeHHMM } from '../types.ts'

/** `under_revision`: the dispatcher changed the decision after sending. */
export type DriverNoticeState = 'active' | 'under_revision'

/** The words the driver reads. The dispatcher previews exactly this object. */
export interface DriverNoticeBody {
  shipment_id: string
  destination_name: string
  appt_start: TimeHHMM
  appt_end: TimeHHMM
  option_kind: ResponseOptionKind
  what_changed: string
  instruction: string
  /** Road segments of an alternative route, in travel order; [] otherwise. */
  route_steps: string[]
  /** Truck-suitability note on a reroute; null otherwise. */
  caution: string | null
  reason: string
  /** "11:15 to 11:28"; null when there is no estimate. Always an estimate. */
  estimated_arrival: string | null
  /** Duty time against the normal plan. SIMULATED. */
  driver_impact: string
}

/** A body the dispatcher has sent. */
export interface DriverNotice extends DriverNoticeBody {
  state: DriverNoticeState
  /** 1 for the first notice on a shipment, then 2, 3... */
  version: number
  /** ISO 8601 time the dispatcher pressed Send. */
  sent_at: string
  /** Sent time of the notice this one replaces; null for version 1. */
  replaces_sent_at: string | null
}

const OPTION_KINDS: ResponseOptionKind[] = ['wait', 'reroute', 'request_slot']
const STRING_FIELDS = [
  'shipment_id',
  'destination_name',
  'appt_start',
  'appt_end',
  'what_changed',
  'instruction',
  'reason',
  'driver_impact',
  'sent_at',
] as const

const isNullableString = (v: unknown) => v === null || typeof v === 'string'

/** Checks a value read from storage or another window before it is shown. */
export function isDriverNotice(value: unknown): value is DriverNotice {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    STRING_FIELDS.every((field) => typeof v[field] === 'string') &&
    OPTION_KINDS.includes(v.option_kind as ResponseOptionKind) &&
    Array.isArray(v.route_steps) &&
    v.route_steps.every((step) => typeof step === 'string') &&
    isNullableString(v.caution) &&
    isNullableString(v.estimated_arrival) &&
    isNullableString(v.replaces_sent_at) &&
    (v.state === 'active' || v.state === 'under_revision') &&
    Number.isInteger(v.version) &&
    (v.version as number) >= 1
  )
}

/**
 * The driver's answer to one notice (issue #36). Two fixed choices and no
 * free text, so a reply can never carry a name or other personal detail.
 */
export type DriverReplyKind = 'received' | 'cannot_do_safely'

export const REPLY_LABELS: Record<DriverReplyKind, string> = {
  received: 'Received',
  cannot_do_safely: "I can't do this safely",
}

export interface DriverReply {
  shipment_id: string
  /** The notice this answers: its version and sent time together. */
  notice_version: number
  notice_sent_at: string
  kind: DriverReplyKind
  /** ISO 8601 time the driver tapped the button. */
  replied_at: string
}

export function isDriverReply(value: unknown): value is DriverReply {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.shipment_id === 'string' &&
    Number.isInteger(v.notice_version) &&
    typeof v.notice_sent_at === 'string' &&
    (v.kind === 'received' || v.kind === 'cannot_do_safely') &&
    typeof v.replied_at === 'string'
  )
}

/**
 * True when the reply answers this exact notice and the notice still
 * stands. A reply to an earlier version, or to a notice that is being
 * revised, is never shown as an answer to the current one.
 */
export function replyAnswers(
  reply: DriverReply | null | undefined,
  notice: DriverNotice | null | undefined,
): reply is DriverReply {
  return (
    !!reply &&
    !!notice &&
    notice.state === 'active' &&
    reply.shipment_id === notice.shipment_id &&
    reply.notice_version === notice.version &&
    reply.notice_sent_at === notice.sent_at
  )
}

/** "14:42" in the reader's own time zone. Formatting only. */
export function formatSentTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unknown time'
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
