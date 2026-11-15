import type { Incident } from '../types.ts'

/** Fixed SIMULATED demo input, independent of the generated response fixture. */
export const sampleIncident: Incident = {
  segment_id: 'NB-03',
  type: 'closure',
  start_time: '10:00',
  reported_reopen_time: '11:10',
  assumed_reopen_time: null,
  evidence_text: 'Report: NB-03 (I-710 northbound to SR-60 east (shared corridor)) closed from 10:00; crews report reopening at 11:10.',
  confirmed_by_user: true,
}

// The closure the dashboard is working with. It is the sample incident until
// the simulation page sets another one for a live demo.
let activeIncident: Incident = sampleIncident

export function getActiveIncident(): Incident {
  return activeIncident
}

/** Pass null to go back to the sample incident. Callers must also reset decisions. */
export function setActiveIncident(incident: Incident | null): void {
  activeIncident = incident ?? sampleIncident
}
