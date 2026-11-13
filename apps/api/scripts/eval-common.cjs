// Shared by the eval scripts. Needs `npx tsc -p tsconfig.build.json` first.
const fs = require('node:fs')
const path = require('node:path')
const { buildAsks, itemProbability } = require('../dist/decisions/eval-run.js')

const root = path.join(__dirname, '../../..')
const fixtureDir = path.join(root, 'fixtures/eval')
const outDir = path.join(root, '.local/eval')

const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, `${name}.json`), 'utf8'))
const loadItems = () => buildAsks({ profiles: loadFixture('profiles'), dms: loadFixture('dms'), drafts: loadFixture('drafts') })
const askKey = (ask) => `${ask.code}|${ask.input}`
const isCached = (cache, item) => item.asks.every((a) => askKey(a) in cache)
const probabilityOf = (cache, item) => itemProbability(item.asks.map((a) => cache[askKey(a)]))
const safeName = (model) => model.replace(/[^\w.-]/g, '_')
const cachePath = (model) => path.join(outDir, `${safeName(model)}.json`)
const loadCache = (model) => (fs.existsSync(cachePath(model)) ? JSON.parse(fs.readFileSync(cachePath(model), 'utf8')) : {})
const pct = (x) => (x === null ? '-' : `${(x * 100).toFixed(0)}%`)

function option(args, name) {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}

// Lowest acceptable 95% lower bound on precision when picking a threshold.
function targetOption(args) {
  const target = Number(option(args, '--target') ?? 0.9)
  if (target > 0 && target < 1) return target
  console.error(`--target must be between 0 and 1, got ${option(args, '--target')}`)
  process.exit(1)
}

// Keeps the first `limit` items of each question, so a small run still covers every question.
function limitPerQuestion(items, limit) {
  const seen = {}
  return items.filter((i) => (seen[i.code] = (seen[i.code] ?? 0) + 1) <= limit)
}

module.exports = { askKey, cachePath, fs, isCached, limitPerQuestion, loadCache, loadFixture, loadItems, option, outDir, path, pct, probabilityOf, safeName, targetOption }
