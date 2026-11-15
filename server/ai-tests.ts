// Asks the real model the five SYNTHETIC test reports, then for a suggestion
// on three simulated shipments, and records what it answered.
//
//   npm run ai:tests                         run, print, and write docs/ai-tests.md
//   npm run ai:tests -- --check              run and print only; used by the pipeline
//   npm run ai:tests -- --models=a,b,c       run the same questions on several models
//                                            and compare them (Claude provider)
//
// Exit code 0 when everything on the first model passes, 1 when a reading is
// wrong or a suggestion is refused twice in a row, 2 when the model could not
// be asked at all (no key, or unreachable). The key is read from the
// environment and never printed.

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
import { interpretReport, type InterpretResult, type Served } from './interpret.ts'
import { readModelConfig, type ModelConfig } from './model.ts'
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
const base = settings.config
const requested = process.argv.find((arg) => arg.startsWith('--models='))?.slice('--models='.length)
const models = requested ? requested.split(',').map((m) => m.trim()).filter(Boolean) : [base.model]
const segments = segmentsJson.items.map(({ id, name }) => ({ id, name }))

/** Published prices in US dollars per million tokens (input, output), as of November 2026. */
const PRICES: Record<string, [number, number]> = {
  'claude-fable-5-2': [8, 40],
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
}

/** S-01: reroute fixes a late shipment. S-07: reroute is on track but passes more schools. S-03: nothing confirmed fixes it. */
const SUGGESTION_SHIPMENTS = ['S-01', 'S-07', 'S-03']

/** The same facts the dashboard sends for a shipment. */
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

interface ReadingOutcome {
  number: number
  report: string
  expected: string
  result: InterpretResult
  problems: string[]
}

interface ModelRun {
  model: string
  readings: ReadingOutcome[]
  suggestions: { shipment: string; result: SuggestResult; secondTry: boolean }[]
  seconds: number
  input_tokens: number
  output_tokens: number
  /** Models that actually answered; more than the one asked for if a fallback ran. */
  served: Set<string>
}

async function run(config: ModelConfig): Promise<ModelRun> {
  const started = Date.now()
  const total: ModelRun = {
    model: config.model,
    readings: [],
    suggestions: [],
    seconds: 0,
    input_tokens: 0,
    output_tokens: 0,
    served: new Set(),
  }
  const count = (served?: Served) => {
    if (!served) return
    total.served.add(served.model)
    total.input_tokens += served.usage?.input_tokens ?? 0
    total.output_tokens += served.usage?.output_tokens ?? 0
  }

  console.log(`\n=== ${config.provider}, model ${config.model}`)
  for (const test of TEST_REPORTS) {
    const result = await interpretReport(test.report, { config, segments })
    const problems = result.ok ? test.problems(result.interpretation) : [`${result.code}: ${result.message}`]
    if ('served' in result) count(result.served)
    total.readings.push({ number: test.number, report: test.report, expected: test.expected, result, problems })
    console.log(`#${test.number} ${problems.length === 0 ? 'PASS' : 'FAIL'}`)
    console.log(`   report:   ${test.report}`)
    console.log(`   expected: ${test.expected}`)
    console.log(`   actual:   ${result.ok ? JSON.stringify(result.interpretation) : `${result.code}: ${result.message}`}`)
    for (const problem of problems) console.log(`   problem:  ${problem}`)
    if (!result.ok && 'details' in result && result.details) {
      for (const detail of result.details) console.log(`   check:    ${detail}`)
    }
  }
  for (const shipment of SUGGESTION_SHIPMENTS) {
    let result = await suggestResponse(factsFor(shipment), { config })
    if ('served' in result) count(result.served)
    // A model words its sentence differently each time, and the checks refuse
    // one that runs long or carries a figure. On the dashboard the dispatcher
    // would ask again, so one refused answer gets one more try here before it
    // counts against the model. An unreachable model is not asked twice.
    let secondTry = false
    if (!result.ok && result.code === 'invalid_model_response') {
      console.log(`suggestion ${shipment} REFUSED ON THE FIRST TRY, asking once more`)
      for (const detail of result.details ?? []) console.log(`   check:    ${detail}`)
      secondTry = true
      result = await suggestResponse(factsFor(shipment), { config })
      if ('served' in result) count(result.served)
    }
    total.suggestions.push({ shipment, result, secondTry })
    console.log(`suggestion ${shipment} ${result.ok ? `PASSED THE CHECKS${secondTry ? ' ON THE SECOND TRY' : ''}` : 'REFUSED'}`)
    console.log(`   ${result.ok ? JSON.stringify(result.suggestion) : `${result.code}: ${result.message}`}`)
    if (!result.ok && 'details' in result && result.details) {
      for (const detail of result.details) console.log(`   check:    ${detail}`)
    }
  }
  total.seconds = (Date.now() - started) / 1000
  return total
}

const runs: ModelRun[] = []
for (const model of models) runs.push(await run({ ...base, model }))

const readingsPassed = (r: ModelRun) => r.readings.filter((o) => o.problems.length === 0).length
const suggestionsPassed = (r: ModelRun) => r.suggestions.filter((s) => s.result.ok).length
const neverAnswered = (r: ModelRun) =>
  [...r.readings.map((o) => o.result), ...r.suggestions.map((s) => s.result)].every(
    (result) => !result.ok && ['model_unreachable', 'model_rejected'].includes(result.code),
  )
function cost(r: ModelRun): string {
  const price = PRICES[r.model]
  if (!price || r.input_tokens + r.output_tokens === 0) return 'n/a'
  return `$${((r.input_tokens * price[0] + r.output_tokens * price[1]) / 1_000_000).toFixed(4)}`
}

const first = runs[0]
if (neverAnswered(first)) {
  console.error('\nThe model could not be asked, so nothing was recorded.')
  process.exit(2)
}

const questions = TEST_REPORTS.length + SUGGESTION_SHIPMENTS.length
const comparison = `| Model | Readings correct | Suggestions that passed the checks | Time for all ${questions} questions | Tokens in / out | Est. cost |
| --- | --- | --- | --- | --- | --- |
${runs
  .map((r) =>
    neverAnswered(r)
      ? `| \`${r.model}\` | could not be asked | | | | |`
      : `| \`${r.model}\` | ${readingsPassed(r)} of ${r.readings.length} | ${suggestionsPassed(r)} of ${r.suggestions.length} | ${r.seconds.toFixed(1)} s | ${r.input_tokens} / ${r.output_tokens} | ${cost(r)} |`,
  )
  .join('\n')}`

console.log(`\n${comparison}`)
for (const r of runs.filter((r) => [...r.served].some((m) => m !== r.model))) {
  console.log(`Note: ${r.model} was answered at least once by ${[...r.served].join(', ')}.`)
}

const readingTable = (r: ModelRun) => `| # | Report (SYNTHETIC) | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
${r.readings
  .map((o) => {
    const actual = o.result.ok
      ? `\`${JSON.stringify(o.result.interpretation)}\``
      : `Rejected (${o.result.code}): ${o.result.message}`
    const verdict = o.problems.length === 0 ? 'Pass' : `Fail: ${o.problems.join('; ')}`
    return `| ${o.number} | ${cell(o.report)} | ${cell(o.expected)} | ${cell(actual)} | ${cell(verdict)} |`
  })
  .join('\n')}`

const suggestionTable = (r: ModelRun) => `| Shipment (SIMULATED) | AI suggestion | The AI's sentence |
| --- | --- | --- |
${r.suggestions
  .map(({ shipment, result, secondTry }) => {
    const tries = secondTry ? ', on the second try' : ''
    if (!result.ok) return `| ${shipment} | Refused (${result.code}${tries}) | ${cell(result.message)} |`
    const { suggested_option, because, note } = result.suggestion
    const reasons = because.map((d) => d.measure).join(', ') || 'none'
    return `| ${shipment} | ${suggested_option ?? 'No suggestion'} (reasons: ${reasons}${tries}) | ${cell(note)} |`
  })
  .join('\n')}`

const perModel = runs
  .filter((r) => !neverAnswered(r))
  .map((r) => `### \`${r.model}\`\n\n${readingTable(r)}\n\n${suggestionTable(r)}`)
  .join('\n\n')

// On GitHub the same tables go on the run's summary page.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Live AI check (${base.provider})\n\n${comparison}\n\n${perModel}\n`)
}

if (!checkOnly) {
  writeFileSync(
    RECORD,
    `# AI test record

How the AI read the five test reports from the team plan, section 8.3, and what it suggested for three simulated shipments.
Every report is **SYNTHETIC** and every shipment is **SIMULATED**: no real incident, place or person. Written by \`npm run ai:tests\`; do not edit by hand.

- **Recorded:** ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC
- **Provider:** ${base.provider}

## Summary

${comparison}

"Readings correct" compares each reading with what the team plan expects. "Suggestions that passed the checks" counts suggestions the dashboard would show: there is no expected option, only the test that every reason given is true in the figures. Cost is an estimate from published prices and the tokens each run used.

## Answers

${perModel}

## How to read this

- "Actual" is the reading after the server's checks. A model answer that names a segment that does not exist, quotes words that are not in the report, adds a field, or guesses a missing value is rejected whole and shows here as "Rejected".
- A suggestion is refused whole if a reason it gives is not true in the figures, if its sentence contains a number, or if it names an option that cannot be chosen. What each suggestion gives up is worked out by the dashboard, not by the model.
- A pass means the AI read the text as expected. It does not mean a road is closed: the AI interprets a report, it does not verify one, and nothing changes until the dispatcher confirms.
- Report 5 carries an instruction aimed at the AI. The only thing the AI can return is the six fields, so the instruction has nowhere to act; the test checks that the reading is an ordinary NB-03 closure.
- The model can answer differently on another run. Rerun \`npm run ai:tests\` after changing the prompt, the model or the segment list.
`,
  )
  console.log(`Wrote ${path.relative(process.cwd(), RECORD)}`)
}

process.exit(
  readingsPassed(first) === first.readings.length && suggestionsPassed(first) === first.suggestions.length ? 0 : 1,
)
