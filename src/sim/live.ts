// What the simulation page broadcasts so dashboards can follow it live.
// No imports: the relay in server/ validates with this file too.

export interface SimBroadcast {
  v: 1
  /** Which simulation page sent it. */
  sender: string
  /** Rises with every message from one sender; older ones are ignored. */
  seq: number
  /** The setup, in the same form as the page's link (see settings.ts). */
  query: string
  /** Simulated minutes since midnight when this was sent. */
  time: number
  running: boolean
  /** False until the run has begun (and again after a restart): nothing has been reported yet. */
  started: boolean
  /** Simulated minutes per real second. */
  speed: number
}

export const SIM_RELAY_PATH = '/api/sim-state'
export const SIM_CHANNEL = 'portplan-sim'

export function isSimBroadcast(value: unknown): value is SimBroadcast {
  if (typeof value !== 'object' || value === null) return false
  const b = value as Record<string, unknown>
  return (
    b.v === 1 &&
    typeof b.sender === 'string' && b.sender.length > 0 && b.sender.length <= 64 &&
    typeof b.seq === 'number' && Number.isFinite(b.seq) &&
    typeof b.query === 'string' && b.query.length <= 512 &&
    typeof b.time === 'number' && b.time >= 0 && b.time < 24 * 60 &&
    typeof b.running === 'boolean' &&
    typeof b.started === 'boolean' &&
    typeof b.speed === 'number' && b.speed > 0 && b.speed <= 60
  )
}
