import { describe, expect, it } from 'vitest'
import { FakeLlmClient } from '../llm/fake-llm-client'
import { classifyReply, optOutRule } from './reply-class'

describe('optOutRule', () => {
  it.each([
    'stop',
    'STOP.',
    'Please stop messaging me',
    "Please don't message me again, thanks.",
    'Do not contact me',
    'unsubscribe',
    'Thanks, but take me off whatever list this is.',
    'I said no already. Leave me alone.',
    'Cool program. Can you remove me from your list?',
  ])('treats %j as an opt-out', (text) => {
    expect(optOutRule(text)).toBe(true)
  })

  it.each([
    "I can't stop thinking about your programme. How do I apply?",
    "Don't stop posting those threads. How do I apply?",
    'Great, please stop by our demo day booth next week!',
    'You stopped following me, why?',
    'Not interested, thanks.',
  ])('leaves %j to the model', (text) => {
    expect(optOutRule(text)).toBe(false)
  })
})

describe('classifyReply', () => {
  it('uses the rule without calling the model', async () => {
    const llm = new FakeLlmClient(() => ({ class: 'Interested', probability: 0.99 }))
    expect(await classifyReply(llm, 'stop')).toEqual({ replyClass: 'Opt-out', classBy: 'rule' })
    expect(llm.calls).toEqual([])
  })

  it('takes the model class when it is sure enough', async () => {
    const llm = new FakeLlmClient(() => ({ class: 'Interested', probability: 0.9 }))
    expect(await classifyReply(llm, 'Would love to talk')).toEqual({ replyClass: 'Interested', classBy: 'llm' })
    expect(llm.calls[0]).toMatchObject({ task: 'reply', user: JSON.stringify({ input: 'Would love to talk' }) })
  })

  it('falls back to Unclear when the model is unsure', async () => {
    const llm = new FakeLlmClient(() => ({ class: 'Not interested', probability: 0.6 }))
    expect(await classifyReply(llm, 'hmm')).toEqual({ replyClass: 'Unclear', classBy: 'llm' })
  })

  it('retries bad output once, then falls back to Unclear', async () => {
    const llm = new FakeLlmClient(() => ({ class: 'Maybe', probability: 0.9 }))
    expect(await classifyReply(llm, 'hmm')).toEqual({ replyClass: 'Unclear', classBy: 'llm' })
    expect(llm.calls).toHaveLength(2)
  })
})
