import { QUESTIONS } from './questions'

export type Label = boolean | string | null
export type Kind = 'profiles' | 'dms' | 'drafts'
export interface EvalItem {
  id: string
  kind: Kind
  labels: Record<string, Label>
  reviewed: boolean
  [key: string]: unknown
}

const REPLY_CLASSES = ['Interested', 'Question', 'Not now', 'Not interested', 'Opt-out', 'Unclear']
const TEXT_FIELDS = new Set(['reply_class'])

// "yes", "No", true... become booleans; the reply class gets its canonical spelling; anything else is kept and will not match.
function normalize(field: string, value: unknown): Label {
  if (TEXT_FIELDS.has(field)) {
    const s = String(value ?? '').trim()
    return REPLY_CLASSES.find((c) => c.toLowerCase() === s.toLowerCase()) ?? (s || null)
  }
  if (typeof value === 'boolean') return value
  const s = String(value ?? '').trim().toLowerCase()
  if (s === 'yes' || s === 'true') return true
  if (s === 'no' || s === 'false') return false
  return null
}

export type Answer = { id: string; labels: Record<string, Label> }

// A chat answer is free text: take the first JSON array in it, flat or with a labels object.
export function parseAnswer(text: string): Answer[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < start) throw new Error('No JSON array in the answer')
  const rows = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>[]
  return rows.map((row) => {
    const source = (typeof row.labels === 'object' && row.labels ? row.labels : row) as Record<string, unknown>
    const labels: Record<string, Label> = {}
    for (const [field, value] of Object.entries(source)) if (field !== 'id') labels[field] = normalize(field, value)
    return { id: String(row.id), labels }
  })
}

export type Votes = Record<string, Record<string, Record<string, Label>>>

export function mergeVotes(inputs: { voter: string; answers: Answer[] }[]): Votes {
  const votes: Votes = {}
  for (const { voter, answers } of inputs)
    for (const a of answers)
      for (const [field, value] of Object.entries(a.labels)) ((votes[a.id] ??= {})[field] ??= {})[voter] = value
  return votes
}

export type Resolution = { status: 'agreed' | 'differs' | 'split' | 'missing'; value?: Label; prefill?: Label }

// Unanimous = every voter gave the same answer. A unanimous answer that contradicts the prefill still goes to a person.
export function resolve(item: EvalItem, votes: Votes, voters: string[]): Record<string, Resolution> {
  const out: Record<string, Resolution> = {}
  for (const [field, prefill] of Object.entries(item.labels)) {
    const given = voters.map((v) => votes[item.id]?.[field]?.[v])
    const present = given.filter((g): g is Label => g !== undefined && g !== null)
    if (new Set(present).size > 1) out[field] = { status: 'split' }
    else if (present.length < voters.length) out[field] = { status: 'missing' }
    else if (prefill !== null && prefill !== present[0]) out[field] = { status: 'differs', value: present[0], prefill }
    else out[field] = { status: 'agreed', value: present[0] }
  }
  return out
}

const say = (v: Label | undefined) => (v === true ? 'yes' : v === false ? 'no' : (v ?? ''))

export type Todo = { id: string; field: string; status: string; text: string; votes: string; prefill: Label }

function textOf(item: EvalItem): string {
  if (item.kind === 'profiles') return `${item.name} @${item.handle}: ${item.bio}`
  if (item.kind === 'drafts') return `Evidence: ${item.evidence} | Draft: ${item.text}`
  return String(item.text ?? '')
}

export function applyHuman(items: EvalItem[], votes: Votes, voters: string[], human: Record<string, Label>): { items: EvalItem[]; todo: Todo[] } {
  const todo: Todo[] = []
  const out = items.map((item) => {
    const resolved = resolve(item, votes, voters)
    const labels: Record<string, Label> = {}
    let open = false
    for (const [field, r] of Object.entries(resolved)) {
      const key = `${item.id}.${field}`
      if (key in human) labels[field] = human[key]
      else if (r.status === 'agreed') labels[field] = r.value ?? null
      else {
        labels[field] = null
        open = true
        const shown = voters.map((v) => `${v}:${say(votes[item.id]?.[field]?.[v]) || '-'}`).join(' ')
        todo.push({ id: item.id, field, status: r.status, text: textOf(item), votes: shown, prefill: r.prefill ?? item.labels[field] })
      }
    }
    return { ...item, labels, reviewed: !open }
  })
  return { items: out, todo }
}

const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s)

export function toCsv(rows: Todo[]): string {
  const lines = rows.map((r) => [r.id, r.field, r.status, r.text.replaceAll('\n', ' '), r.votes, String(say(r.prefill)), ''].map(cell).join(','))
  return ['id,field,status,text,votes,prefill,human', ...lines].join('\n') + '\n'
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// The human column: yes or no, or a reply class; an empty cell means not answered yet.
export function parseHumanCsv(csv: string): Record<string, Label> {
  const [header, ...rows] = parseCsv(csv)
  const col = (name: string) => header.indexOf(name)
  const out: Record<string, Label> = {}
  for (const r of rows) {
    const answer = (r[col('human')] ?? '').trim()
    if (!answer) continue
    const field = r[col('field')]
    out[`${r[col('id')]}.${field}`] = normalize(field, answer)
  }
  return out
}

type Fixtures = {
  profiles: Record<string, unknown>[]
  dms: Record<string, unknown>[]
  drafts: Record<string, unknown>[]
}

const YES_NO = 'Use true or false.'
const PART_1 = `# Label these items

These are made-up test items for a tool that finds AI and robotics people on X and writes first messages to them. Judge every item on its own, from the text only. Do not guess about anything that is not written. Several chats label the same items independently, so answer what you think is right, not what you think is expected.

## Profiles (id starting with f)
- "own_account": ${QUESTIONS.own_account.instructions} ${YES_NO}
- "fits_segment": does the person build, research or found something in AI or robotics? A commentator, investor, designer, gamer or someone outside the field is false. ${YES_NO}

## Direct messages sent to us (id starting with dm)
- "invitation": ${QUESTIONS.invitation.instructions} ${YES_NO}
- "opt_out": does the message ask us to stop contacting them (stop, unsubscribe, remove me, do not contact or message)? A polite "not interested" alone is false. ${YES_NO}
- "reply_class": one of Interested (wants to talk or apply), Question (asks something), Not now, Not interested, Opt-out (asks us to stop), Unclear (nothing to act on, or spam).

## Answer format
Answer with one JSON array and nothing else, one object for every item below:
[{"id": "f01", "own_account": true, "fits_segment": false}, {"id": "dm001", "invitation": true, "opt_out": false, "reply_class": "Question"}]
`

const DRAFT_PART = `# Label these drafts

These are made-up first messages from a small fund to a person on X, each with the one post it refers to. The evidence is the only thing we know about the person. Judge every draft on its own. Several chats label the same items independently, so answer what you think is right.

For each draft:
- "one_person": ${QUESTIONS.one_person.instructions} ${YES_NO}
- "no_sensitive": ${QUESTIONS.no_sensitive.instructions} ${YES_NO}
- "no_familiarity": ${QUESTIONS.no_familiarity.instructions} ${YES_NO}
- "claim_backed": is every statement about the recipient (what they did, are or have) supported by the evidence? Statements about the fund itself do not count. ${YES_NO}

## Answer format
Answer with one JSON array and nothing else, one object for every draft below:
[{"id": "dr001", "one_person": true, "no_sensitive": true, "no_familiarity": false, "claim_backed": true}]
`

const block = (items: unknown[]) => '\n## Items\n```json\n' + JSON.stringify(items, null, 1) + '\n```\n'
const pick = (item: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, item[k]]))

// Labels, groups and fault markers are left out so the chats cannot copy them.
export function buildPrompts(fixtures: Fixtures, draftsPerPart = 50): { file: string; text: string }[] {
  const first = [
    ...fixtures.profiles.map((p) => pick(p, ['id', 'handle', 'name', 'bio', 'followers'])),
    ...fixtures.dms.map((d) => pick(d, ['id', 'text'])),
  ]
  const prompts = [{ file: '1-profiles-and-dms.md', text: PART_1 + block(first) }]
  for (let i = 0; i * draftsPerPart < fixtures.drafts.length; i++) {
    const chunk = fixtures.drafts.slice(i * draftsPerPart, (i + 1) * draftsPerPart).map((d) => ({ id: d.id, evidence: d.evidence, draft: d.text }))
    prompts.push({ file: `${i + 2}-drafts-${String.fromCharCode(97 + i)}.md`, text: DRAFT_PART + block(chunk) })
  }
  return prompts
}
