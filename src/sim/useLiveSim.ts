import { useEffect, useRef, useState } from 'react'
import type { SimBroadcast } from './live.ts'
import { subscribeSim } from './liveChannel.ts'
import { parseSettings, type SimSettings } from './settings.ts'

/** How long a running clock is carried forward without news from the simulation page. */
const MAX_COAST_MS = 3000
const TICK_MS = 100

export interface LiveSim {
  settings: SimSettings
  /** Simulated minutes since midnight, now. */
  time: number
  running: boolean
  /** False until the run has begun: nothing has been reported yet. */
  started: boolean
  speed: number
}

export type LiveSetup = (settings: SimSettings, time: number, started: boolean) => void

function timeAt(state: SimBroadcast, heardAt: number, now: number): number {
  const coast = state.running ? Math.min(MAX_COAST_MS, Math.max(0, now - heardAt)) : 0
  return Math.min(24 * 60 - 1, state.time + (state.speed * coast) / 1000)
}

/**
 * Follows the simulation page. Null until one has been heard from, or when
 * not enabled. `onUpdate` is called with every state and on every clock tick,
 * outside rendering, so the caller can switch scenario in the same update.
 */
export function useLiveSim(
  enabled: boolean,
  segmentIds: readonly string[],
  onUpdate?: LiveSetup,
): LiveSim | null {
  const [heard, setHeard] = useState<{ state: SimBroadcast; settings: SimSettings; at: number } | null>(null)
  const [now, setNow] = useState(0)
  const updateRef = useRef(onUpdate)
  const idsRef = useRef(segmentIds)
  useEffect(() => {
    updateRef.current = onUpdate
    idsRef.current = segmentIds
  })

  useEffect(() => {
    if (!enabled) return
    return subscribeSim((state) => {
      // Parsed like a link, so anything unexpected falls back to a default.
      const settings = parseSettings(state.query, idsRef.current)
      const at = Date.now()
      updateRef.current?.(settings, state.time, state.started)
      setHeard({ state, settings, at })
      setNow(at)
    })
  }, [enabled])

  const running = heard?.state.running ?? false
  useEffect(() => {
    if (!running || !heard) return
    const id = setInterval(() => {
      const tick = Date.now()
      updateRef.current?.(heard.settings, timeAt(heard.state, heard.at, tick), heard.state.started)
      setNow(tick)
    }, TICK_MS)
    return () => clearInterval(id)
  }, [running, heard])

  if (!enabled || !heard) return null
  return {
    settings: heard.settings,
    time: timeAt(heard.state, heard.at, now),
    running,
    started: heard.state.started,
    speed: heard.state.speed,
  }
}
