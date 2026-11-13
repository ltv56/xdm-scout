// Shared by the eval scripts. Needs `npx tsc -p tsconfig.build.json` first.
const fs = require('node:fs')
const path = require('node:path')
const { buildAsks } = require('../dist/decisions/eval-run.js')

const root = path.join(__dirname, '../../..')
const fixtureDir = path.join(root, 'fixtures/eval')
const outDir = path.join(root, '.local/eval')

const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, `${name}.json`), 'utf8'))
const loadItems = () => buildAsks({ profiles: loadFixture('profiles'), dms: loadFixture('dms'), drafts: loadFixture('drafts') })
const askKey = (item) => `${item.ask.code}|${item.ask.input}`
const safeName = (model) => model.replace(/[^\w.-]/g, '_')
const cachePath = (model) => path.join(outDir, `${safeName(model)}.json`)
const loadCache = (model) => (fs.existsSync(cachePath(model)) ? JSON.parse(fs.readFileSync(cachePath(model), 'utf8')) : {})
const pct = (x) => (x === null ? '-' : `${(x * 100).toFixed(0)}%`)

function option(args, name) {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}

// Keeps the first `limit` items of each question, so a small run still covers every question.
function limitPerQuestion(items, limit) {
  const seen = {}
  return items.filter((i) => (seen[i.ask.code] = (seen[i.ask.code] ?? 0) + 1) <= limit)
}

module.exports = { askKey, cachePath, fs, limitPerQuestion, loadCache, loadFixture, loadItems, option, outDir, path, pct, safeName }
