// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { evaluationCsv, exportEvaluation } from '../../scripts/evaluate.ts'
import type { ScenarioComparisonRow } from './evaluation.ts'

/** Independent CSV reader, including escaped quotes and embedded record separators. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const character = text[i]
    if (character === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"'
        i++
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if (character === '\r' && text[i + 1] === '\n' && !quoted) {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else {
      field += character
    }
  }
  expect(quoted).toBe(false)
  expect(field).toBe('')
  expect(row).toEqual([])
  return rows
}

describe('persisted SIMULATED evaluation exports', () => {
  it('exports exactly nine rows, all three numeric columns, units, labels and selection rules', async () => {
    const generated = await exportEvaluation()
    const json: ScenarioComparisonRow[] = JSON.parse(
      await readFile(new URL('../../docs/evaluation.json', import.meta.url), 'utf8'),
    )
    const csv = parseCsv(await readFile(new URL('../../docs/evaluation.csv', import.meta.url), 'utf8'))
    expect(json).toEqual(generated)
    expect(csv).toHaveLength(10)
    expect(csv[0]).toEqual([
      'id', 'label', 'unit', 'normal', 'disrupted_no_action', 'disrupted_selected_responses',
      'data_label', 'estimated', 'rule', 'selection_rule', 'scenario_labels',
      'selected_responses', 'unknown_totals', 'aggregation',
    ])
    expect(json.map((row) => row.id)).toEqual([
      'late', 'tightOrUnknown', 'latenessMax', 'cost', 'addedMiles',
      'co2Kg', 'pending', 'addedDriverDuty', 'flaggedRoutes',
    ])
    const expected = {
      normal: [0, 0, 0, 1027, 0, 546.5, 0, 0, 0],
      disrupted_no_action: [3, 1, 132, 1204, 0, 546.5, 0, 263, 0],
      disrupted_selected_responses: [2, 0, 84, 1182, 20, 577.9, 2, 176, 2],
    }
    for (const scenario of Object.keys(expected) as (keyof typeof expected)[]) {
      expect(json.map((row) => row.values[scenario])).toEqual(expected[scenario])
      const column = csv[0].indexOf(scenario)
      expect(csv.slice(1).map((row) => Number(row[column]))).toEqual(expected[scenario])
    }
    for (const [index, row] of json.entries()) {
      expect(Object.keys(row.values)).toEqual(Object.keys(expected))
      expect(row.unit).not.toBe('')
      expect(row.rule).not.toBe('')
      expect(row).toMatchObject({ estimated: true, data_label: 'SIMULATED' })
      expect(row.simulation.selection_rule).toMatch(/Evaluation only:.*fewest added miles/)
      expect(row.simulation.selection_rule).toContain('does not select or rank UI responses')
      expect(csv[index + 1]).toHaveLength(csv[0].length)
      expect(csv[index + 1].slice(0, 3)).toEqual([row.id, row.label, row.unit])
      expect(csv[index + 1].slice(6, 10))
        .toEqual(['SIMULATED', 'true', row.rule, row.simulation.selection_rule])
      expect(JSON.parse(csv[index + 1][10])).toEqual(row.simulation.scenario_labels)
      expect(JSON.parse(csv[index + 1][11])).toEqual(row.simulation.selected_responses)
      expect(csv[index + 1].slice(12))
        .toEqual([row.simulation.unknown_totals, row.simulation.aggregation])
    }
  })

  it('round-trips CSV commas, quotes, CRLF/newlines and unknown estimates without column loss', async () => {
    const [row] = await exportEvaluation()
    const label = 'A "quoted", simulated\r\nmetric\nwith a newline'
    const special: ScenarioComparisonRow = {
      ...row, label, values: { ...row.values, normal: null },
    }
    const [header, record] = parseCsv(evaluationCsv([special]))
    expect(record).toHaveLength(header.length)
    expect(record[1]).toBe(label)
    expect(record[header.indexOf('normal')]).toBe('null')
    expect(JSON.parse(record[header.indexOf('selected_responses')]))
      .toEqual(row.simulation.selected_responses)
  })
})
