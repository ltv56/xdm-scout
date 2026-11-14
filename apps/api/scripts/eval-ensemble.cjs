// Accuracy of two cached models alone and combined, on the questions both answered.
//   node scripts/eval-ensemble.cjs <modelA> <modelB> [--out file.md]
// Combined = mean of the two probabilities. "Agree" rule: yes when both >= 0.7, no when both <= 0.3, otherwise a person decides.
const { wilson } = require('../dist/decisions/eval.js')
const { fs, isCached, loadCache, loadItems, option, outDir, path, pct, probabilityOf } = require('./eval-common.cjs')

const args = process.argv.slice(2)
const [a, b] = args
const outName = option(args, '--out') ?? 'ensemble.md'
const caches = [loadCache(a), loadCache(b)]
const items = loadItems().filter((i) => caches.every((c) => isCached(c, i)))

const accuracy = (set, p) => set.filter((i) => (p(i) >= 0.5) === i.yes).length / set.length
const brier = (set, p) => set.reduce((s, i) => s + (p(i) - (i.yes ? 1 : 0)) ** 2, 0) / set.length
const first = (i) => probabilityOf(caches[0], i)
const second = (i) => probabilityOf(caches[1], i)
const mean = (i) => (first(i) + second(i)) / 2

function row(label, set) {
  const yesBoth = set.filter((i) => first(i) >= 0.7 && second(i) >= 0.7)
  const noBoth = set.filter((i) => first(i) <= 0.3 && second(i) <= 0.3)
  const decided = yesBoth.length + noBoth.length
  const right = yesBoth.filter((i) => i.yes).length + noBoth.filter((i) => !i.yes).length
  const w = wilson(right, decided)
  const cells = [
    label,
    set.length,
    pct(accuracy(set, first)),
    pct(accuracy(set, second)),
    pct(accuracy(set, mean)),
    brier(set, first).toFixed(3),
    brier(set, second).toFixed(3),
    brier(set, mean).toFixed(3),
    pct(decided / set.length),
    `${pct(decided ? right / decided : null)} (${pct(w.low)}-${pct(w.high)})`,
    pct(1 - decided / set.length),
  ]
  return `| ${cells.join(' | ')} |`
}

const codes = [...new Set(items.map((i) => i.code))]
const lines = [
  `# ${a} + ${b}`,
  '',
  `Questions answered by both: ${items.length}. Accuracy: p >= 0.5 matches the label.`,
  '',
  `| question | n | ${a} acc | ${b} acc | mean acc | ${a} Brier | ${b} Brier | mean Brier | agree: decided | agree: precision (95%) | agree: to a person |`,
  `| ${Array.from({ length: 11 }, () => '---').join(' | ')} |`,
  ...codes.map((c) => row(c, items.filter((i) => i.code === c))),
  row('ALL', items),
]
fs.writeFileSync(path.join(outDir, outName), `${lines.join('\n')}\n`)
console.log(lines.join('\n'))
