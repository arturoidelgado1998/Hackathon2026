import { useEffect, useState } from 'react'

/** Simulated minutes that pass per real second. */
export const SIM_SPEEDS = [1, 5, 15] as const
export type SimSpeed = (typeof SIM_SPEEDS)[number]

const TICK_MS = 100

export interface SimClock {
  /** Minutes since midnight, within the window; fractional while playing. */
  time: number
  running: boolean
  speed: SimSpeed
  toggle: () => void
  /** Go back to the start of the window and play. */
  start: () => void
  seek: (time: number) => void
  setSpeed: (speed: SimSpeed) => void
  restart: () => void
}

/**
 * A clock for the truck simulation. It never starts by itself: the dispatcher
 * presses Play or drags the slider. It stops at the end of the window.
 */
export function useSimClock(start: number, end: number, initialSpeed: SimSpeed = 5): SimClock {
  const [rawTime, setRawTime] = useState(start)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<SimSpeed>(initialSpeed)
  const time = Math.min(end, Math.max(start, rawTime))
  const running = playing && time < end

  useEffect(() => {
    if (!running) return
    // Advance by real elapsed time, so a busy browser does not slow the clock.
    let last = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      const elapsed = now - last
      last = now
      setRawTime((t) => Math.min(end, Math.max(start, t) + (speed * elapsed) / 1000))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [running, speed, start, end])

  return {
    time,
    running,
    speed,
    toggle: () => {
      if (running) {
        setPlaying(false)
        return
      }
      if (time >= end) setRawTime(start)
      setPlaying(true)
    },
    start: () => {
      setRawTime(start)
      setPlaying(true)
    },
    seek: (next) => {
      // After the day has played to its end, moving the slider must not start it again.
      if (!running) setPlaying(false)
      setRawTime(Math.min(end, Math.max(start, next)))
    },
    setSpeed,
    restart: () => {
      setPlaying(false)
      setRawTime(start)
    },
  }
}
