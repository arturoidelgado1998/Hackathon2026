// Optional features. Each can be switched off without touching the core flow.

/**
 * G5 truck-route check: show the truck designation Caltrans records for the
 * highways each route follows. Set VITE_TRUCK_NETWORK_CHECK=off to hide it.
 */
export const TRUCK_NETWORK_CHECK = import.meta.env.VITE_TRUCK_NETWORK_CHECK !== 'off'
