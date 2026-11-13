import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = join(__dirname, '../../../../fixtures/eval')
const load = <T>(name: string) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as T

type Draft = { id: string; text: string; planted: string | null; labels: Record<string, boolean | null>; reviewed: boolean; batch?: number }
type Dm = { id: string; group: string; text: string; labels: { invitation: boolean | null; opt_out: boolean; reply_class: string | null }; reviewed: boolean; batch?: number }
type Profile = { id: string; handle: string; labels: { own_account: boolean; fits_segment: boolean | null }; reviewed: boolean; batch?: number }

describe('eval fixtures', () => {
  it('keeps the sizes the spec asks for', () => {
    expect(load<Profile[]>('profiles')).toHaveLength(60)
    expect(load<Dm[]>('dms')).toHaveLength(300)
    expect(load<Draft[]>('drafts')).toHaveLength(320)
  })

  it('keeps the first batch as it was and adds a second one with ids that continue it', () => {
    const dms = load<Dm[]>('dms')
    expect(dms.slice(0, 100).every((d, i) => d.id === `dm${String(i + 1).padStart(3, '0')}` && d.batch === undefined)).toBe(true)
    expect(dms.slice(100).every((d, i) => d.id === `dm${String(i + 101).padStart(3, '0')}` && d.batch === 2)).toBe(true)
    expect(load<Draft[]>('drafts').slice(100, 300).every((d, i) => d.id === `dr${String(i + 101).padStart(3, '0')}` && d.batch === 2)).toBe(true)
    expect(load<Draft[]>('drafts').slice(300).every((d, i) => d.id === `dr${String(i + 301).padStart(3, '0')}` && d.batch === 3)).toBe(true)
    expect(load<Profile[]>('profiles').slice(30).every((p, i) => p.id === `f${String(i + 31).padStart(2, '0')}` && p.batch === 2)).toBe(true)
  })

  it('has no repeated DM text and no repeated profile handle', () => {
    expect(new Set(load<Dm[]>('dms').map((d) => d.text)).size).toBe(300)
    expect(new Set(load<Profile[]>('profiles').map((p) => p.handle)).size).toBe(60)
  })

  it('gives the second batch 80 clean drafts and 30 of each planted fault', () => {
    const second = load<Draft[]>('drafts').slice(100, 300)
    const count = (f: string | null) => second.filter((d) => d.planted === f).length
    expect([count(null), count('one_person'), count('no_sensitive'), count('no_familiarity'), count('claim_backed')]).toEqual([80, 30, 30, 30, 30])
  })

  it('gives the third batch 15 loaded questions and 5 clean drafts whose question is neutral or backed', () => {
    const third = load<Draft[]>('drafts').slice(300)
    expect(third.filter((d) => d.planted === 'no_loaded_question')).toHaveLength(15)
    expect(third.filter((d) => d.planted === null)).toHaveLength(5)
    expect(third.every((d) => /\?/.test(d.text))).toBe(true)
  })

  it('labels every draft for loaded questions', () => {
    expect(load<Draft[]>('drafts').every((d) => typeof d.labels.no_loaded_question === 'boolean')).toBe(true)
  })

  it('covers short, long, lowercase and emoji messages and 30 tricky ones in the second batch', () => {
    const dms = load<Dm[]>('dms').slice(100)
    expect(dms.some((d) => d.text.length < 25)).toBe(true)
    expect(dms.some((d) => d.text.length > 100)).toBe(true)
    expect(dms.some((d) => /^[a-z]/.test(d.text))).toBe(true)
    expect(dms.some((d) => /\p{Extended_Pictographic}/u.test(d.text))).toBe(true)
    expect(dms.filter((d) => d.group === 'tricky')).toHaveLength(30)
  })

  it('writes every fixture in English', () => {
    const all = JSON.stringify([load('profiles'), load('dms'), load('drafts')])
    expect(/[À-ɏḀ-ỿ]/.test(all)).toBe(false)
  })

  it('marks a planted fault false on its own check and leaves clean drafts all true', () => {
    for (const d of load<Draft[]>('drafts')) {
      if (d.planted) expect(d.labels[d.planted]).toBe(false)
      else expect(Object.values(d.labels).every((v) => v === true)).toBe(true)
    }
  })

  it('keeps the labels the invitation groups imply and gives every DM an answer', () => {
    for (const d of load<Dm[]>('dms')) {
      if (d.group === 'clear_invite') expect(d.labels.invitation).toBe(true)
      if (d.group === 'decline' || d.group === 'spam') expect(d.labels.invitation).toBe(false)
      expect(typeof d.labels.invitation).toBe('boolean')
      expect(d.labels.reply_class).toMatch(/^(Interested|Question|Not now|Not interested|Opt-out|Unclear)(\|(Interested|Question))?$/)
    }
  })

  it('treats a stop request as an opt-out and a plain decline as not one', () => {
    const dms = load<Dm[]>('dms')
    expect(dms.filter((d) => /^Please stop|^Unsubscribe/.test(d.text)).every((d) => d.labels.opt_out && d.labels.reply_class === 'Opt-out')).toBe(true)
    expect(dms.filter((d) => d.group === 'decline' && d.text.startsWith('Not interested')).every((d) => !d.labels.opt_out && d.labels.reply_class === 'Not interested')).toBe(true)
  })

  it('has an opt-out exactly where the reply class is Opt-out', () => {
    for (const d of load<Dm[]>('dms')) expect(d.labels.opt_out).toBe(d.labels.reply_class === 'Opt-out')
  })

  it('flags parody, fan and unaffiliated accounts as not their own', () => {
    const own = Object.fromEntries(load<Profile[]>('profiles').map((p) => [p.handle, p.labels.own_account]))
    expect([own.elon_musk_fan, own.the_real_sama, own.ai_news_daily]).toEqual([false, false, false])
    expect(own.mina_builds).toBe(true)
  })

  it('has every label answered and every item reviewed', () => {
    for (const name of ['profiles', 'dms', 'drafts']) {
      const items = load<{ reviewed: boolean; labels: Record<string, unknown> }[]>(name)
      expect(items.every((i) => i.reviewed)).toBe(true)
      expect(items.every((i) => Object.values(i.labels).every((v) => v !== null))).toBe(true)
    }
  })
})
