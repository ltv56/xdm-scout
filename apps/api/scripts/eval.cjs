// Run the decision questions over the labelled fixtures with one model.
//   node scripts/eval.cjs [--model <name>] [--limit N] [--target 0.9]
// No --model: DECISION_MODEL from .env; `fixture` answers 0.5 for everything.
// Answers are cached in .local/eval/<model>.json, so a rerun asks only what is missing.
const { createDecisionClient, createLlmClient } = require('../dist/llm/ai-config.js')
const { runEval } = require('../dist/decisions/eval-run.js')
const { askKey, cachePath, fs, limitPerQuestion, loadCache, loadItems, option, outDir, path, pct, safeName, targetOption } = require('./eval-common.cjs')
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

const interval = (p) => `${pct(p.precision)} (${pct(p.precisionInterval.low)}-${pct(p.precisionInterval.high)})`

function report(result, target) {
  const lines = [`# Eval: ${name}`, '', '## All fixtures at 0.7', '', '| question | n | Brier | answered yes | precision (95% interval) | coverage |', '| --- | --- | --- | --- | --- | --- |']
  for (const [code, r] of Object.entries(result.byCode)) {
    const p = r.precision
    lines.push(`| ${code} | ${r.n} | ${r.brier.toFixed(3)} | ${p.answeredYes} | ${interval(p)} | ${pct(p.coverage)} |`)
  }
  lines.push('', `## Threshold picked on the first half (precision lower bound >= ${pct(target)}), measured on the second half`, '')
  lines.push('| question | picked | n | answered yes | precision (95% interval) | coverage |', '| --- | --- | --- | --- | --- | --- |')
  for (const [code, r] of Object.entries(result.byCode)) {
    const p = r.tuned.precision
    const picked = r.tuned.picked === null ? `none (${r.tuned.used})` : r.tuned.picked
    lines.push(`| ${code} | ${picked} | ${p.n} | ${p.answeredYes} | ${interval(p)} | ${pct(p.coverage)} |`)
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
  const target = targetOption(args)
  fs.mkdirSync(outDir, { recursive: true })
  const off = name === 'fixture'
  const env = { ...process.env, DECISION_MODEL: off ? '' : model, ...(off ? { LLM_MODEL: '' } : {}) }
  const client = createDecisionClient(env, createLlmClient(env))
  const items = limitPerQuestion(loadItems(), limit)
  const cache = loadCache(name)

  const asks = [...new Map(items.flatMap((i) => i.asks).map((a) => [askKey(a), a])).values()]
  const missing = asks.filter((a) => !(askKey(a) in cache))
  console.log(`${name}: ${items.length} items, ${asks.length} questions, ${asks.length - missing.length} cached, ${missing.length} to ask`)
  for (let i = 0; i < missing.length; i += BATCH) {
    const part = missing.slice(i, i + BATCH)
    const answers = await decideWithRetry(client, part)
    part.forEach((p, n) => (cache[askKey(p)] = answers[n].probability))
    fs.writeFileSync(cachePath(name), JSON.stringify(cache))
    process.stdout.write(`\r${Math.min(i + BATCH, missing.length)}/${missing.length}`)
  }
  if (missing.length) console.log()

  const cached = { decide: async (asks) => asks.map((ask) => ({ ...ask, probability: cache[askKey(ask)], answeredBy: 'fixture' })) }
  const result = await runEval(cached, items, { target })
  const text = report(result, target)
  fs.writeFileSync(path.join(outDir, `${safeName(name)}-report.md`), `${text}\n`)
  console.log(text)
  if (writeCalibration) saveCalibration(result)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
