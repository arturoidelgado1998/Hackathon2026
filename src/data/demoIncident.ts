import type { Incident } from '../types.ts'

/** Fixed SIMULATED demo input, independent of the generated response fixture. */
export const sampleIncident: Incident = {
  segment_id: 'NB-03',
  type: 'closure',
  start_time: '10:00',
  reported_reopen_time: '11:10',
  assumed_reopen_time: null,
  evidence_text: 'SIMULATED report: NB-03 (I-710 northbound to SR-60 east (shared corridor)) closed from 10:00; crews report reopening at 11:10.',
  confirmed_by_user: true,
}
