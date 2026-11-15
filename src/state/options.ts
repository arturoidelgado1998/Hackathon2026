import type { ResponseOption } from '../types.ts'

/** Slot requests intentionally have no arrival estimate until confirmed. */
export function isResponseOptionAvailable(option: ResponseOption): boolean {
  if ('available' in option && option.available === false) return false
  if (option.kind === 'request_slot') return option.requires_confirmation
  return (
    !option.requires_confirmation &&
    option.arrival_min !== null &&
    option.arrival_max !== null
  )
}

/**
 * Whether the dispatcher can choose this response right now. On a live day an
 * option with valid figures can still be closed: the truck has already acted,
 * the road has reopened, or the load has been delivered.
 */
export function isResponseOptionOpen(option: ResponseOption): boolean {
  if ('closed_reason' in option && option.closed_reason) return false
  return isResponseOptionAvailable(option)
}

/** The plain reason a response cannot be chosen, for its disabled controls. */
export function responseOptionClosedReason(option: ResponseOption): string | undefined {
  if ('closed_reason' in option && typeof option.closed_reason === 'string') return option.closed_reason
  return isResponseOptionAvailable(option) ? undefined : option.status
}
