// Runs the five SYNTHETIC test reports through the real model and records
// what it answered. It then asks the real model for a suggestion on three
// simulated shipments and records whether each one passed the checks.
//
//   npm run ai:tests              run, print, and write docs/ai-tests.md
//   npm run ai:tests -- --check   run and print only; used by the pipeline
//
// Exit code 0 when all five match, 1 when a reading is wrong or rejected,
// 2 when the model could not be asked at all (no key, or unreachable).
// The key is read from the environment and never printed.

import { appendFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import routesJson from '../src/data/routes.json' with { type: 'json' }
import responsesJson from '../src/data/sample-responses.json' with { type: 'json' }
import segmentsJson from '../src/data/segments.json' with { type: 'json' }
import shipmentsJson from '../src/data/shipments.json' with { type: 'json' }
import { isResponseOptionAvailable } from '../src/state/options.ts'
import type { ShipmentFacts } from '../src/suggestion/suggestion.ts'
import type { ResponseOption } from '../src/types.ts'
import { interpretReport, type InterpretResult } from './interpret.ts'
import { readModelConfig } from './model.ts'
import { suggestResponse, type SuggestResult } from './suggest.ts'
import { TEST_REPORTS } from './test-reports.ts'

const RECORD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'ai-tests.md')
const checkOnly = process.argv.includes('--check')
const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ')

const settings = readModelConfig(process.env)
if (!settings.ok) {
  console.error(settings.message)
  console.error('Copy .env.example to .env and fill it in, then run this again.')
  process.exit(2)
}
const { config } = settings
const segments = segmentsJson.items.map(({ id, name }) => ({ id, name }))

interface Outcome {
  number: number
  report: string
  expected: string
  result: InterpretResult
  problems: string[]
  seconds: number
}

const outcomes: Outcome[] = []
for (const test of TEST_REPORTS) {
  const started = Date.now()
  const result = await interpretReport(test.report, { config, segments })
  const problems = result.ok ? test.problems(result.interpretation) : [`${result.code}: ${result.message}`]
  outcomes.push({ ...test, result, problems, seconds: (Date.now() - started) / 1000 })
  console.log(`#${test.number} ${problems.length === 0 ? 'PASS' : 'FAIL'} (${outcomes.at(-1)!.seconds.toFixed(1)} s)`)
  console.log(`   report:   ${test.report}`)
  console.log(`   expected: ${test.expected}`)
  console.log(`   actual:   ${result.ok ? JSON.stringify(result.interpretation) : `${result.code}: ${result.message}`}`)
  for (const problem of problems) console.log(`   problem:  ${problem}`)
  if (!result.ok && 'details' in result && result.details) {
    for (const detail of result.details) console.log(`   check:    ${detail}`)
  }
}

// ---- Suggestions: the same facts the dashboard sends for a shipment.

/** S-01: reroute fixes a late shipment. S-07: reroute is on track but passes more schools. S-03: nothing confirmed fixes it. */
const SUGGESTION_SHIPMENTS = ['S-01', 'S-07', 'S-03']

function factsFor(shipmentId: string): ShipmentFacts {
  const shipment = shipmentsJson.items.find((s) => s.id === shipmentId)!
  const original = routesJson.items.find((r) => r.id === shipment.assigned_route_id)!
  const alternative = routesJson.items.find((r) => r.destination === shipment.destination_id && r.kind === 'alternative')
  const scenario = responsesJson.scenarios.disrupted as unknown as Record<string, { options: ResponseOption[] }>
  return {
    shipment_id: shipment.id,
    appt_start: shipment.appt_start,
    appt_end: shipment.appt_end,
    options: scenario[shipmentId].options.map((option) => {
      const route = option.kind === 'wait' ? original : option.kind === 'reroute' ? alternative : undefined
      return {
        kind: option.kind,
        available: isResponseOptionAvailable(option),
        arrival_min: option.arrival_min,
        arrival_max: option.arrival_max,
        lateness_min: option.lateness_min,
        lateness_max: option.lateness_max,
        risk: option.risk,
        miles: option.miles,
        cost: option.cost,
        co2_kg: option.co2_kg,
        driver_duty_min: option.driver_duty_min,
        schools_150m: route?.schools_150m ?? null,
        dac_tracts: route?.dac_tracts?.length ?? null,
        status: option.status,
      }
    }),
  }
}

const suggestions: { shipment: string; result: SuggestResult; seconds: number }[] = []
for (const shipment of SUGGESTION_SHIPMENTS) {
  const started = Date.now()
  const result = await suggestResponse(factsFor(shipment), { config })
  suggestions.push({ shipment, result, seconds: (Date.now() - started) / 1000 })
  console.log(`suggestion ${shipment} ${result.ok ? 'PASSED THE CHECKS' : 'REFUSED'} (${suggestions.at(-1)!.seconds.toFixed(1)} s)`)
  console.log(`   ${result.ok ? JSON.stringify(result.suggestion) : `${result.code}: ${result.message}`}`)
  if (!result.ok && 'details' in result && result.details) {
    for (const detail of result.details) console.log(`   check:    ${detail}`)
  }
}
const suggestionsOk = suggestions.filter((s) => s.result.ok).length

const unreachable = outcomes.every((o) => !o.result.ok && ['model_unreachable', 'model_rejected'].includes(o.result.code))
if (unreachable) {
  console.error('\nThe model could not be asked, so nothing was recorded.')
  process.exit(2)
}

const passed = outcomes.filter((o) => o.problems.length === 0).length
console.log(`\n${passed} of ${outcomes.length} readings match what is expected.`)
console.log(`${suggestionsOk} of ${suggestions.length} suggestions passed the checks.`)

const rows = outcomes.map((o) => {
  const actual = o.result.ok
    ? `\`${JSON.stringify(o.result.interpretation)}\``
    : `Rejected (${o.result.code}): ${o.result.message}`
  const verdict = o.problems.length === 0 ? 'Pass' : `Fail: ${o.problems.join('; ')}`
  return `| ${o.number} | ${cell(o.report)} | ${cell(o.expected)} | ${cell(actual)} | ${cell(verdict)} |`
})
const table = `| # | Report (SYNTHETIC) | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
${rows.join('\n')}`

const suggestionRows = suggestions.map(({ shipment, result }) => {
  if (!result.ok) return `| ${shipment} | Refused (${result.code}) | ${cell(result.message)} |`
  const { suggested_option, because, note } = result.suggestion
  const reasons = because.map((d) => d.measure).join(', ') || 'none'
  return `| ${shipment} | ${suggested_option ?? 'No suggestion'} (reasons: ${reasons}) | ${cell(note)} |`
})
const suggestionTable = `| Shipment (SIMULATED) | AI suggestion | The AI's sentence |
| --- | --- | --- |
${suggestionRows.join('\n')}`

// On GitHub the same table goes on the run's summary page.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Live AI check: ${passed} of ${outcomes.length} readings match\n\nModel \`${config.model}\` (${config.provider}).\n\n${table}\n\n` +
      `## Live AI suggestions: ${suggestionsOk} of ${suggestions.length} passed the checks\n\n${suggestionTable}\n`,
  )
}

if (!checkOnly) {
  const record = `# AI test record

How the incident-interpretation endpoint (A1) read the five test reports from the team plan, section 8.3.
Every report is **SYNTHETIC**: no real incident, place or person. Written by \`npm run ai:tests\`; do not edit by hand.

- **Recorded:** ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC
- **Provider and model:** ${config.provider}, \`${config.model}\`
- **Result:** ${passed} of ${outcomes.length} readings match what is expected

${table}

## AI suggestions

For three simulated shipments the model was given the figures the comparison table shows and asked which response it would lean towards.
${suggestionsOk} of ${suggestions.length} suggestions passed the checks. A suggestion is refused whole if a reason it gives is not true in the figures, if its sentence contains a number, or if it names an option that cannot be chosen.

${suggestionTable}

There is no "expected" option here: the test is that every suggestion shown is one the figures support. What each suggestion gives up is worked out by the dashboard, not by the model.

## How to read this

- "Actual" is the reading after the server's checks. A model answer that names a segment that does not exist, quotes words that are not in the report, adds a field, or guesses a missing value is rejected whole and shows here as "Rejected".
- A pass means the AI read the text as expected. It does not mean a road is closed: the AI interprets a report, it does not verify one, and nothing changes until the dispatcher confirms.
- Report 5 carries an instruction aimed at the AI. The only thing the AI can return is the six fields above, so the instruction has nowhere to act; the test checks that the reading is an ordinary NB-03 closure.
- The model can answer differently on another run. Rerun \`npm run ai:tests\` after changing the prompt, the model or the segment list.
`
  writeFileSync(RECORD, record)
  console.log(`Wrote ${path.relative(process.cwd(), RECORD)}`)
}

process.exit(passed === outcomes.length && suggestionsOk === suggestions.length ? 0 : 1)
