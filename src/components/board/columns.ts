import type { BoardColumn, Scenario, ShipmentSummary } from '../../viewModels.ts'

/**
 * Starting column for a shipment before the dispatcher acts on it.
 * Affected shipments need review in the disrupted scenario; everything
 * else stays in Monitoring. Risk does not decide the column.
 */
export function defaultColumn(summary: ShipmentSummary, scenario: Scenario): BoardColumn {
  return scenario === 'disrupted' && summary.affected ? 'needs_review' : 'monitoring'
}
