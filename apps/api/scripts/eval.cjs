// Run the decision questions over the labelled fixtures with one model.
//   node scripts/eval.cjs [--model <name>] [--limit N]
// No --model: DECISION_MODEL from .env; `fixture` answers 0.5 for everything.
// Answers are cached in .local/eval/<model>.json, so a rerun asks only what is missing.
const { createDecisionClient, createLlmClient } = require('../dist/llm/ai-config.js')
const { runEval } = require('../dist/decisions/eval-run.js')
const { askKey, cachePath, fs, limitPerQuestion, loadCache, loadItems, option, outDir, path, pct, safeName } = require('./eval-common.cjs')
require('dotenv').config({ path: path.join(__dirname, '../../../.env'), quiet: true })

const args = process.argv.slice(2)
const model = option(args, '--model') ?? process.env.DECISION_MODEL ?? ''
const limit = option(args, '--limit') === undefined ? Infinity : Number(option(args, '--limit'))
const name = model || 'fixture'
const writeCalibration = args.includes('--write-calibration')
const CALIBRATION_FILE = path.join(__dirname, '../src/decisions/calibration.json')
const BATCH = 10
const MAX_TRIES = 5

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000))

// Free tiers rate-limit (429): wait and retry the same batch instead of losing the run.
async function decideWithRetry(client, asks) {
  for (let tries = 1, wait = 15; ; tries++, wait = Math.min(wait * 2, 120)) {
    try {
      return await client.decide(asks)
    } catch (e) {
      if (!/429|too_many/i.test(e.message) || tries >= MAX_TRIES) throw e
      console.log(`\nrate limited, waiting ${wait}s`)
      await sleep(wait)
    }
  }
}

function report(result) {
  const lines = [`# Eval: ${name}`, '', '| question | n | Brier | answered yes | precision (95% interval) | coverage |', '| --- | --- | --- | --- | --- | --- |']
  for (const [code, r] of Object.entries(result.byCode)) {
    const p = r.precision
    const interval = `${pct(p.precisionInterval.low)}-${pct(p.precisionInterval.high)}`
    lines.push(`| ${code} | ${r.n} | ${r.brier.toFixed(3)} | ${p.answeredYes} | ${pct(p.precision)} (${interval}) | ${pct(p.coverage)} |`)
  }
  return lines.join('\n')
}

// The second half of the fixtures only reports (the first half is for choosing thresholds): yes answers at the high threshold and how many were right.
function saveCalibration(result) {
  const table = fs.existsSync(CALIBRATION_FILE) ? JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8')) : {}
  const byCode = {}
  for (const [code, r] of Object.entries(result.byCode)) {
    const p = r.report.precision
    byCode[code] = { examples: p.answeredYes, right: p.right, low: Number(p.precisionInterval.low.toFixed(3)), high: Number(p.precisionInterval.high.toFixed(3)) }
  }
  table[name] = { measuredOn: new Date().toISOString().slice(0, 10), byCode }
  fs.writeFileSync(CALIBRATION_FILE, `${JSON.stringify(table, null, 2)}\n`)
  console.log(`calibration for ${name} written to ${path.relative(process.cwd(), CALIBRATION_FILE)}`)
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const off = name === 'fixture'
  const env = { ...process.env, DECISION_MODEL: off ? '' : model, ...(off ? { LLM_MODEL: '' } : {}) }
  const client = createDecisionClient(env, createLlmClient(env))
  const items = limitPerQuestion(loadItems(), limit)
  const cache = loadCache(name)

  const missing = items.filter((i) => !(askKey(i) in cache))
  console.log(`${name}: ${items.length} questions, ${items.length - missing.length} cached, ${missing.length} to ask`)
  for (let i = 0; i < missing.length; i += BATCH) {
    const part = missing.slice(i, i + BATCH)
    const answers = await decideWithRetry(client, part.map((p) => p.ask))
    part.forEach((p, n) => (cache[askKey(p)] = answers[n].probability))
    fs.writeFileSync(cachePath(name), JSON.stringify(cache))
    process.stdout.write(`\r${Math.min(i + BATCH, missing.length)}/${missing.length}`)
  }
  if (missing.length) console.log()

  const cached = { decide: async (asks) => asks.map((ask) => ({ ...ask, probability: cache[`${ask.code}|${ask.input}`], answeredBy: 'fixture' })) }
  const result = await runEval(cached, items)
  const text = report(result)
  fs.writeFileSync(path.join(outDir, `${safeName(name)}-report.md`), `${text}\n`)
  console.log(text)
  if (writeCalibration) saveCalibration(result)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
