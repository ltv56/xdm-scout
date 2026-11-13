import { describe, expect, it } from 'vitest'
import { applyHuman, buildPrompts, mergeVotes, parseAnswer, parseHumanCsv, resolve, toCsv, type EvalItem } from './label-consensus'

const dm = (id: string, labels: EvalItem['labels']): EvalItem => ({ id, kind: 'dms', labels, reviewed: false })

describe('parseAnswer', () => {
  it('reads a JSON array out of a chat answer with a code fence and chatter around it', () => {
    const text = 'Sure! Here you go:\n```json\n[{"id":"dm001","invitation":true,"opt_out":"no","reply_class":"interested"}]\n```\nAnything else?'
    expect(parseAnswer(text)).toEqual([{ id: 'dm001', labels: { invitation: true, opt_out: false, reply_class: 'Interested' } }])
  })

  it('accepts yes, no, true and false in any case, and a labels object', () => {
    expect(parseAnswer('[{"id":"f01","labels":{"own_account":"Yes","fits_segment":"FALSE"}}]')).toEqual([{ id: 'f01', labels: { own_account: true, fits_segment: false } }])
  })

  it('throws when there is no JSON array at all', () => {
    expect(() => parseAnswer('I cannot do that')).toThrow(/JSON array/)
  })
})

describe('resolve', () => {
  const voters = ['a', 'b', 'c']
  it('agrees when every voter says the same and it matches the prefill', () => {
    const item = dm('dm001', { invitation: true })
    const votes = mergeVotes([{ voter: 'a', answers: [{ id: 'dm001', labels: { invitation: true } }] }, { voter: 'b', answers: [{ id: 'dm001', labels: { invitation: true } }] }, { voter: 'c', answers: [{ id: 'dm001', labels: { invitation: true } }] }])
    expect(resolve(item, votes, voters).invitation).toEqual({ status: 'agreed', value: true })
  })

  it('flags a unanimous vote that differs from the prefill', () => {
    const item = dm('dm001', { invitation: false })
    const votes = mergeVotes(voters.map((voter) => ({ voter, answers: [{ id: 'dm001', labels: { invitation: true } }] })))
    expect(resolve(item, votes, voters).invitation).toMatchObject({ status: 'differs', value: true, prefill: false })
  })

  it('splits when voters disagree, and counts a missing voter as unresolved', () => {
    const item = dm('dm001', { invitation: true })
    const split = mergeVotes([{ voter: 'a', answers: [{ id: 'dm001', labels: { invitation: true } }] }, { voter: 'b', answers: [{ id: 'dm001', labels: { invitation: false } }] }, { voter: 'c', answers: [{ id: 'dm001', labels: { invitation: true } }] }])
    expect(resolve(item, split, voters).invitation.status).toBe('split')
    const missing = mergeVotes([{ voter: 'a', answers: [{ id: 'dm001', labels: { invitation: true } }] }, { voter: 'b', answers: [{ id: 'dm001', labels: { invitation: true } }] }])
    expect(resolve(item, missing, voters).invitation.status).toBe('missing')
  })

  it('takes a unanimous vote where there was no prefill', () => {
    const item = dm('dm002', { invitation: null })
    const votes = mergeVotes(voters.map((voter) => ({ voter, answers: [{ id: 'dm002', labels: { invitation: false } }] })))
    expect(resolve(item, votes, voters).invitation).toEqual({ status: 'agreed', value: false })
  })
})

describe('applyHuman', () => {
  it('writes agreed labels, marks the item reviewed only when nothing is left, and lists what a person must label', () => {
    const items = [dm('dm001', { invitation: true, opt_out: false }), dm('dm002', { invitation: null, opt_out: false })]
    const voters = ['a', 'b']
    const votes = mergeVotes(voters.map((voter) => ({ voter, answers: [{ id: 'dm001', labels: { invitation: true, opt_out: false } }, { id: 'dm002', labels: { invitation: voter === 'a', opt_out: false } }] })))
    const { items: out, todo } = applyHuman(items, votes, voters, {})
    expect(out[0]).toMatchObject({ labels: { invitation: true, opt_out: false }, reviewed: true })
    expect(out[1]).toMatchObject({ labels: { invitation: null, opt_out: false }, reviewed: false })
    expect(todo.map((t) => `${t.id}.${t.field}:${t.status}`)).toEqual(['dm002.invitation:split'])
  })

  it('takes the human answer for a split item and then marks it reviewed', () => {
    const items = [dm('dm002', { invitation: null })]
    const voters = ['a', 'b']
    const votes = mergeVotes([{ voter: 'a', answers: [{ id: 'dm002', labels: { invitation: true } }] }, { voter: 'b', answers: [{ id: 'dm002', labels: { invitation: false } }] }])
    const { items: out, todo } = applyHuman(items, votes, voters, { 'dm002.invitation': false })
    expect(out[0]).toMatchObject({ labels: { invitation: false }, reviewed: true })
    expect(todo).toEqual([])
  })
})

describe('csv for the human pass', () => {
  it('round-trips quoted text and reads the human column', () => {
    const csv = toCsv([{ id: 'dm002', field: 'invitation', status: 'split', text: 'Say "hi", maybe', votes: 'a:yes b:no', prefill: null }])
    expect(csv.split('\n')[0]).toBe('id,field,status,text,votes,prefill,human')
    const filled = csv.replace(/,\s*$/m, '').split('\n')
    expect(filled[1]).toContain('"Say ""hi"", maybe"')
    expect(parseHumanCsv('id,field,status,text,votes,prefill,human\ndm002,invitation,split,"Say ""hi"", maybe",a:yes b:no,,yes\ndm003,opt_out,split,x,a:yes b:no,,\n')).toEqual({ 'dm002.invitation': true })
  })
})

// The items are the JSON block at the end of a prompt.
const itemsOf = (text: string) => JSON.parse(text.slice(text.indexOf('```json') + 7, text.lastIndexOf('```'))) as { id: string }[]

describe('buildPrompts', () => {
  const profiles = [{ id: 'f01', handle: 'mina', name: 'Mina', bio: 'Builds robots', followers: 10, labels: { own_account: true, fits_segment: true }, reviewed: false }]
  const dms = [{ id: 'dm001', group: 'clear_invite', text: 'How do I apply?', labels: { invitation: true, opt_out: false, reply_class: 'Question' }, reviewed: false }]
  const drafts = Array.from({ length: 3 }, (_, i) => ({ id: `dr00${i}`, person: 'Mina', evidence: 'Shipped v2', text: 'Hi Mina! Saw it.', planted: i === 0 ? 'one_person' : null, labels: { one_person: true }, reviewed: false }))

  it('splits drafts into parts and never leaks labels, groups or planted faults', () => {
    const prompts = buildPrompts({ profiles, dms, drafts }, 2)
    expect(prompts.map((p) => p.file)).toEqual(['1-profiles-and-dms.md', '2-drafts-a.md', '3-drafts-b.md'])
    const all = prompts.map((p) => p.text).join('\n')
    for (const leak of ['clear_invite', 'planted', 'reviewed', '"labels"']) expect(all).not.toContain(leak)
    expect(prompts[0].text).toContain('own_account')
    expect(prompts[0].text).toContain('How do I apply?')
    const ids = (text: string) => itemsOf(text).map((i) => i.id)
    expect(ids(prompts[1].text)).toHaveLength(2)
    expect(ids(prompts[2].text)).toHaveLength(1)
    expect([...ids(prompts[1].text), ...ids(prompts[2].text)].sort()).toEqual(['dr000', 'dr001', 'dr002'])
  })

  it('splits profiles and DMs into lettered parts when there are too many for one', () => {
    const manyDms = Array.from({ length: 5 }, (_, i) => ({ id: `dm00${i}`, group: 'neutral', text: `Hello ${i}`, labels: {}, reviewed: false }))
    const prompts = buildPrompts({ profiles, dms: manyDms, drafts: [] }, 50, 4)
    expect(prompts.map((p) => p.file)).toEqual(['1-profiles-and-dms-a.md', '2-profiles-and-dms-b.md'])
    expect(prompts.flatMap((p) => itemsOf(p.text))).toHaveLength(6)
  })

  it('shuffles DMs and drafts the same way every time, so the order does not give away the group', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `dm${String(i).padStart(3, '0')}`, group: i < 10 ? 'spam' : 'clear_invite', text: `Text ${i}`, labels: {}, reviewed: false }))
    const order = (text: string) => itemsOf(text).map((i) => i.id).join()
    const first = buildPrompts({ profiles: [], dms: many, drafts: [] })[0].text
    expect(order(buildPrompts({ profiles: [], dms: many, drafts: [] })[0].text)).toBe(order(first))
    expect(order(first)).not.toBe(many.map((d) => d.id).join())
  })

  it('tells the chat to answer with one JSON array of the expected shape', () => {
    const [first, second] = buildPrompts({ profiles, dms, drafts }, 2)
    expect(first.text).toMatch(/one JSON array/)
    expect(first.text).toContain('"reply_class"')
    expect(second.text).toContain('"no_familiarity"')
  })
})
