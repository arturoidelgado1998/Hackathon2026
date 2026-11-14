/// <reference types="node" />

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Assumptions, RoadSegment, Route, Shipment } from '../src/types.ts'
import { sampleIncident } from '../src/data/demoIncident.ts'
import { compareScenarios } from '../src/engine/evaluation.ts'
import type { ScenarioComparisonRow } from '../src/engine/evaluation.ts'

const root = new URL('../', import.meta.url)

async function readData<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(`src/data/${name}.json`, root), 'utf8')) as T
}

/** RFC 4180 fields; unknown numeric estimates are explicit null, never empty/zero. */
function csvField(value: string | number | boolean | null): string {
  const text = value === null ? 'null' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function evaluationCsv(rows: readonly ScenarioComparisonRow[]): string {
  const header = [
    'id', 'label', 'unit', 'normal', 'disrupted_no_action', 'disrupted_selected_responses',
    'data_label', 'estimated', 'rule', 'selection_rule', 'scenario_labels',
    'selected_responses', 'unknown_totals', 'aggregation',
  ]
  const records = rows.map((row) => [
    row.id, row.label, row.unit,
    row.values.normal, row.values.disrupted_no_action, row.values.disrupted_selected_responses,
    row.data_label, row.estimated, row.rule, row.simulation.selection_rule,
    JSON.stringify(row.simulation.scenario_labels), JSON.stringify(row.simulation.selected_responses),
    row.simulation.unknown_totals, row.simulation.aggregation,
  ].map(csvField).join(','))
  return [header.join(','), ...records].join('\r\n') + '\r\n'
}

export async function exportEvaluation(): Promise<ScenarioComparisonRow[]> {
  const [shipments, routes, segments, assumptions] = await Promise.all([
    readData<{ items: Shipment[] }>('shipments'),
    readData<{ items: Route[] }>('routes'),
    readData<{ items: RoadSegment[] }>('segments'),
    readData<Assumptions>('assumptions'),
  ])
  const rows = compareScenarios(
    shipments.items, sampleIncident, { routes: routes.items, segments: segments.items }, assumptions,
  )
  const directory = new URL('docs/', root)
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(new URL('evaluation.json', directory), JSON.stringify(rows, null, 2) + '\n'),
    writeFile(new URL('evaluation.csv', directory), evaluationCsv(rows)),
  ])
  return rows
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const rows = await exportEvaluation()
  console.log(`Exported ${rows.length} SIMULATED, estimated evaluation rows to docs/evaluation.{csv,json}`)
}
