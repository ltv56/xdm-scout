// Put cached models side by side on the questions every one of them answered.
//   node scripts/eval-compare.cjs [--only a,b] [--limit N] [--out file.md]
// Reads .local/eval/<model>.json (written by eval.cjs or eval-import.cjs), writes .local/eval/comparison.md.
const { wilson } = require('../dist/decisions/eval.js')
const { askKey, fs, limitPerQuestion, loadCache, loadItems, option, outDir, path, pct } = require('./eval-common.cjs')

const args = process.argv.slice(2)
const only = option(args, '--only')?.split(',')
const limit = option(args, '--limit') === undefined ? Infinity : Number(option(args, '--limit'))
const outName = option(args, '--out') ?? 'comparison.md'
const HIGH = 0.7

const names = fs
  .readdirSync(outDir)
  .filter((f) => f.endsWith('.json') && f !== 'fixture.json')
  .map((f) => f.slice(0, -5))
  .filter((m) => !only || only.includes(m))
const caches = Object.fromEntries(names.map((m) => [m, loadCache(m)]))
const items = limitPerQuestion(loadItems(), limit)
const answered = names.filter((m) => items.some((i) => askKey(i) in caches[m]))
const common = items.filter((i) => answered.every((m) => askKey(i) in caches[m]))
const codes = [...new Set(common.map((i) => i.ask.code))]

function measure(model, set) {
  let right = 0
  let squares = 0
  let said = 0
  let saidRight = 0
  for (const i of set) {
    const p = caches[model][askKey(i)]
    right += (p >= 0.5) === i.yes
    squares += (p - (i.yes ? 1 : 0)) ** 2
    if (p >= HIGH) {
      said++
      saidRight += i.yes
    }
  }
  return { accuracy: right / set.length, brier: squares / set.length, said, saidRight, precision: said ? saidRight / said : null, coverage: said / set.length }
}

const byModel = answered
  .map((model) => ({ model, all: measure(model, common), perCode: Object.fromEntries(codes.map((c) => [c, measure(model, common.filter((i) => i.ask.code === c))])) }))
  .sort((a, b) => a.all.brier - b.all.brier)

const table = (title, cell) => [
  `## ${title}`,
  '',
  `| model | ${codes.join(' | ')} |`,
  `| --- | ${codes.map(() => '---').join(' | ')} |`,
  ...byModel.map((r) => `| ${r.model} | ${codes.map((c) => cell(r.perCode[c])).join(' | ')} |`),
  '',
]

const lines = [
  '# Model comparison',
  '',
  `Questions answered by every model: ${common.length}. Accuracy: p >= 0.5 matches the label. Precision and coverage: answers with p >= ${HIGH}.`,
  '',
  '## Overall',
  '',
  '| model | accuracy | Brier | precision | coverage |',
  '| --- | --- | --- | --- | --- |',
  ...byModel.map((r) => `| ${r.model} | ${pct(r.all.accuracy)} | ${r.all.brier.toFixed(3)} | ${pct(r.all.precision)} | ${pct(r.all.coverage)} |`),
  '',
  ...table('Accuracy per question', (m) => pct(m.accuracy)),
  ...table('Brier per question (lower is better)', (m) => m.brier.toFixed(3)),
  ...table('Precision per question (95% interval) and coverage', (m) => {
    const w = wilson(m.saidRight, m.said)
    return `${pct(m.precision)} (${pct(w.low)}-${pct(w.high)}), ${pct(m.coverage)}`
  }),
]
const noAnswers = names.filter((m) => !answered.includes(m))
if (noAnswers.length) lines.push('## No answers', '', ...noAnswers.map((m) => `- ${m}`), '')
fs.writeFileSync(path.join(outDir, outName), lines.join('\n'))
console.log(lines.slice(0, 9 + byModel.length).join('\n'))
