// Label the eval fixtures with several independent chats.
//   node scripts/eval-labels.cjs export <out dir> [--batch N]
//   node scripts/eval-labels.cjs merge <answers dir> <out dir> [--batch N] [--human <csv>] [--write]
// Needs `npx tsc -p tsconfig.build.json` first. Answers are files named <voter>-<anything>.txt or .json.
// An item without a `batch` field belongs to batch 1. With --batch only that batch is exported or merged.
const fs = require('node:fs')
const path = require('node:path')
const { applyHuman, buildPrompts, mergeVotes, parseAnswer, parseHumanCsv, toCsv } = require('../dist/decisions/label-consensus.js')

const dir = path.join(__dirname, '../../../fixtures/eval')
const KINDS = ['profiles', 'dms', 'drafts']
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'))

const [command, ...args] = process.argv.slice(2)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const batch = option('--batch') === undefined ? null : Number(option('--batch'))
const inBatch = (item) => batch === null || (item.batch ?? 1) === batch

if (command === 'export') {
  const out = args[0]
  fs.mkdirSync(out, { recursive: true })
  const fixtures = { profiles: load('profiles').filter(inBatch), dms: load('dms').filter(inBatch), drafts: load('drafts').filter(inBatch) }
  for (const { file, text } of buildPrompts(fixtures)) {
    fs.writeFileSync(path.join(out, file), text)
    console.log(`wrote ${path.join(out, file)} (${text.length} characters)`)
  }
} else if (command === 'merge') {
  const [answers, out] = args
  const human = option('--human') ? parseHumanCsv(fs.readFileSync(option('--human'), 'utf8')) : {}
  const inputs = new Map()
  for (const file of fs.readdirSync(answers).filter((f) => /\.(txt|json)$/.test(f))) {
    const voter = file.split('-')[0]
    const parsed = parseAnswer(fs.readFileSync(path.join(answers, file), 'utf8'))
    inputs.set(voter, [...(inputs.get(voter) ?? []), ...parsed])
    console.log(`${voter}: ${parsed.length} answers from ${file}`)
  }
  const voters = [...inputs.keys()]
  const votes = mergeVotes(voters.map((voter) => ({ voter, answers: inputs.get(voter) })))
  const todo = []
  for (const kind of KINDS) {
    const all = load(kind)
    const items = all.filter(inBatch).map((i) => ({ ...i, kind }))
    const result = applyHuman(items, votes, voters, human)
    todo.push(...result.todo)
    console.log(`${kind}: ${result.items.filter((i) => i.reviewed).length} of ${items.length} items fully agreed or answered`)
    if (args.includes('--write')) {
      const updated = new Map(result.items.map(({ kind: _kind, ...rest }) => [rest.id, rest]))
      fs.writeFileSync(path.join(dir, `${kind}.json`), JSON.stringify(all.map((i) => updated.get(i.id) ?? i), null, 2) + '\n')
    }
  }
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'to-label.csv'), toCsv(todo))
  const byStatus = todo.reduce((n, t) => ({ ...n, [t.status]: (n[t.status] ?? 0) + 1 }), {})
  console.log(`to label by hand: ${todo.length}`, byStatus, `-> ${path.join(out, 'to-label.csv')}`)
  console.log(args.includes('--write') ? 'fixtures updated' : 'dry run: add --write to update fixtures')
} else {
  console.error('usage: export <out dir> [--batch N] | merge <answers dir> <out dir> [--batch N] [--human <csv>] [--write]')
  process.exit(2)
}
