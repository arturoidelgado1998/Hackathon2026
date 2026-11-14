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
