import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { approveResult, reviewItem, reviewQueue, senderProfile } from './contract'
import { ReviewStubController } from './review-stub.controller'

let c: ReviewStubController

beforeEach(() => {
  c = new ReviewStubController()
})

const item = (draftId: number) => c.queue('1').items.find((i) => i.draftId === draftId)!

describe('review stub', () => {
  it('returns a queue that matches the contract and covers the screen states', () => {
    const q = reviewQueue.parse(c.queue('1'))
    const items = q.items
    expect(items.some((i) => i.checks.length === 0)).toBe(true)
    expect(items.some((i) => i.checks.some((k) => k.level === 'block'))).toBe(true)
    expect(items.some((i) => i.checks.some((k) => k.level === 'warn'))).toBe(true)
    expect(items.some((i) => i.kind === 'reply' && i.sendPath === 'API_SEND' && i.openInXUrl === null)).toBe(true)
    expect(items.some((i) => i.sendPath === 'HUMAN_HANDOFF' && i.openInXUrl?.startsWith('https://x.com/messages/compose?recipient_id='))).toBe(true)
    expect(items.some((i) => i.checks.some((k) => k.needsConfirm))).toBe(true)
    expect(items.some((i) => i.sentences.some((s) => s.source === null))).toBe(true)
  })

  it('carries a dated metrics snapshot, criteria and decision probabilities for every draft', () => {
    const items = reviewQueue.parse(c.queue('1')).items
    for (const i of items) {
      expect(i.prospect.snapshot.sampleSize).toBeGreaterThan(0)
      expect(i.prospect.snapshot.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(i.decisions.map((d) => d.code)).toEqual(expect.arrayContaining(['policy', 'claims']))
      for (const d of i.decisions) expect(d.probability).toBeGreaterThanOrEqual(0)
    }
    expect(items.filter((i) => i.kind === 'reply').every((i) => i.decisions.some((d) => d.code === 'invitation'))).toBe(true)
    expect(items.some((i) => i.prospect.criteria.some((k) => k.status === 'unknown'))).toBe(true)
    expect(() => reviewItem.parse({ ...items[0], decisions: [{ code: 'policy', question: 'q', probability: 1.4, model: 'fixture' }] })).toThrow()
  })

  it('rejects a bad campaign id', () => {
    expect(() => c.queue('x')).toThrow(BadRequestException)
  })

  it('edit reruns checks: a new unbacked sentence becomes a warn to confirm, status back to pending', () => {
    const before = item(101)
    const edited = reviewItem.parse(c.edit(101, { text: 'Saw your post on eval tooling. We run a small fund in Singapore. You built the best agent on X. No worries if not.' }))
    expect(edited.editedByReviewer).toBe(true)
    expect(edited.status).toBe('pending')
    expect(edited.contentHash).not.toBe(before.contentHash)
    expect(edited.checks.some((k) => k.code === 'unbacked_claim' && k.level === 'warn' && k.needsConfirm)).toBe(true)
  })

  it('approve needs the hash the reviewer saw and the unbacked confirmation', () => {
    const blocked = c.queue('1').items.find((i) => i.checks.some((k) => k.level === 'block'))!
    expect(() => c.approve(blocked.draftId, { contentHash: blocked.contentHash })).toThrow(ConflictException)

    const clean = c.queue('1').items.find((i) => i.checks.length === 0)!
    expect(() => c.approve(clean.draftId, { contentHash: 'a'.repeat(64) })).toThrow(ConflictException)
    expect(approveResult.parse(c.approve(clean.draftId, { contentHash: clean.contentHash }))).toEqual({ attemptId: expect.any(Number) })
    expect(item(clean.draftId).status).toBe('approved')

    const toConfirm = c.queue('1').items.find((i) => i.checks.some((k) => k.needsConfirm))!
    expect(() => c.approve(toConfirm.draftId, { contentHash: toConfirm.contentHash })).toThrow(ConflictException)
    expect(c.approve(toConfirm.draftId, { contentHash: toConfirm.contentHash, confirmedUnbacked: true })).toHaveProperty('attemptId')
  })

  it('skip needs a reason from the list; skipped drafts cannot be approved', () => {
    expect(() => c.skip(101, { reason: 'bored' })).toThrow(BadRequestException)
    expect(c.skip(101, { reason: 'wrong_tone' }).status).toBe('skipped')
    expect(() => c.approve(101, { contentHash: item(101).contentHash })).toThrow(ConflictException)
  })

  it('manual path records sent / not sent only for approved hand-off drafts', () => {
    const handoff = c.queue('1').items.find((i) => i.sendPath === 'HUMAN_HANDOFF' && i.checks.length === 0)!
    expect(() => c.manual(handoff.draftId, { outcome: 'sent' })).toThrow(ConflictException)
    c.approve(handoff.draftId, { contentHash: handoff.contentHash })
    expect(c.manual(handoff.draftId, { outcome: 'sent' }).status).toBe('sent_manually')
    const api = c.queue('1').items.find((i) => i.sendPath === 'API_SEND')!
    expect(() => c.manual(api.draftId, { outcome: 'sent' })).toThrow(ConflictException)
  })

  it('regenerate replaces the draft text; dnc removes it from the queue', () => {
    const r = c.regenerate(101, { note: 'shorter' })
    expect(r.status).toBe('pending')
    expect(r.text).not.toBe('')
    expect(c.dnc(101)).toEqual({ ok: true })
    expect(c.queue('1').items.some((i) => i.draftId === 101)).toBe(false)
  })

  it('answers 404 for an unknown draft', () => {
    expect(() => c.skip(999, { reason: 'other' })).toThrow(NotFoundException)
  })

  it('reads and saves the sender profile', () => {
    expect(senderProfile.parse(c.profile())).toBeTruthy()
    const next = { intro: 'We back AI founders in SEA.', offers: ['Intro to investors'], signer: 'Vinh', sampleMessages: [] }
    expect(c.saveProfile(next)).toEqual(next)
    expect(c.profile()).toEqual(next)
    expect(() => c.saveProfile({ intro: '' })).toThrow(BadRequestException)
  })
})
