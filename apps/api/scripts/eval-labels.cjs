// Label the eval fixtures with several independent chats.
//   node scripts/eval-labels.cjs export <out dir>
//   node scripts/eval-labels.cjs merge <answers dir> <out dir> [--human <csv>] [--write]
// Needs `npx tsc -p tsconfig.build.json` first. Answers are files named <voter>-<anything>.txt or .json.
const fs = require('node:fs')
const path = require('node:path')
const { applyHuman, buildPrompts, mergeVotes, parseAnswer, parseHumanCsv, toCsv } = require('../dist/decisions/label-consensus.js')

const dir = path.join(__dirname, '../../../fixtures/eval')
const KINDS = ['profiles', 'dms', 'drafts']
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'))

const [command, ...args] = process.argv.slice(2)

if (command === 'export') {
  const out = args[0]
  fs.mkdirSync(out, { recursive: true })
  for (const { file, text } of buildPrompts({ profiles: load('profiles'), dms: load('dms'), drafts: load('drafts') })) {
    fs.writeFileSync(path.join(out, file), text)
    console.log(`wrote ${path.join(out, file)} (${text.length} characters)`)
  }
} else if (command === 'merge') {
  const [answers, out] = args
  const flag = (name) => args.indexOf(name)
  const human = flag('--human') >= 0 ? parseHumanCsv(fs.readFileSync(args[flag('--human') + 1], 'utf8')) : {}
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
    const items = load(kind).map((i) => ({ ...i, kind }))
    const result = applyHuman(items, votes, voters, human)
    todo.push(...result.todo)
    const done = result.items.filter((i) => i.reviewed).length
    console.log(`${kind}: ${done} of ${items.length} items fully agreed or answered`)
    if (args.includes('--write')) {
      const clean = result.items.map(({ kind: _kind, ...rest }) => rest)
      fs.writeFileSync(path.join(dir, `${kind}.json`), JSON.stringify(clean, null, 2) + '\n')
    }
  }
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'to-label.csv'), toCsv(todo))
  const byStatus = todo.reduce((n, t) => ({ ...n, [t.status]: (n[t.status] ?? 0) + 1 }), {})
  console.log(`to label by hand: ${todo.length}`, byStatus, `-> ${path.join(out, 'to-label.csv')}`)
  console.log(args.includes('--write') ? 'fixtures updated' : 'dry run: add --write to update fixtures')
} else {
  console.error('usage: export <out dir> | merge <answers dir> <out dir> [--human <csv>] [--write]')
  process.exit(2)
}
