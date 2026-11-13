import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = join(__dirname, '../../../../fixtures/eval')
const load = <T>(name: string) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as T

type Draft = { planted: string | null; labels: Record<string, boolean | null>; reviewed: boolean }
type Dm = { group: string; text: string; labels: { invitation: boolean | null; opt_out: boolean; reply_class: string | null }; reviewed: boolean }
type Profile = { handle: string; labels: { own_account: boolean; fits_segment: boolean | null }; reviewed: boolean }

describe('eval fixtures', () => {
  it('keeps the sizes the spec asks for', () => {
    expect(load<Profile[]>('profiles')).toHaveLength(30)
    expect(load<Dm[]>('dms')).toHaveLength(100)
    expect(load<Draft[]>('drafts')).toHaveLength(100)
  })

  it('marks a planted fault false on its own check and every other check true', () => {
    for (const d of load<Draft[]>('drafts')) {
      for (const [check, value] of Object.entries(d.labels)) {
        if (d.planted === check) expect(value).toBe(false)
        else if (!(d.planted === 'no_familiarity' && check === 'claim_backed')) expect(value).toBe(true)
      }
    }
  })

  it('labels a DM from the group it was written for and leaves the vague invitations to the reviewer', () => {
    for (const d of load<Dm[]>('dms')) {
      if (d.group === 'vague_invite') expect(d.labels.invitation).toBeNull()
      else expect(d.labels.invitation).toBe(d.group === 'clear_invite')
    }
  })

  it('treats a stop request as an opt-out and a plain decline as not one', () => {
    const dms = load<Dm[]>('dms')
    expect(dms.filter((d) => /^Please stop|^Unsubscribe/.test(d.text)).every((d) => d.labels.opt_out && d.labels.reply_class === 'Opt-out')).toBe(true)
    expect(dms.filter((d) => d.text.startsWith('Not interested')).every((d) => !d.labels.opt_out && d.labels.reply_class === 'Not interested')).toBe(true)
  })

  it('flags parody, fan and unaffiliated accounts as not their own', () => {
    const own = Object.fromEntries(load<Profile[]>('profiles').map((p) => [p.handle, p.labels.own_account]))
    expect([own.elon_musk_fan, own.the_real_sama, own.ai_news_daily]).toEqual([false, false, false])
    expect(own.mina_builds).toBe(true)
  })

  it('starts every item as not reviewed', () => {
    for (const name of ['profiles', 'dms', 'drafts']) expect(load<{ reviewed: boolean }[]>(name).every((i) => i.reviewed === false)).toBe(true)
  })
})
