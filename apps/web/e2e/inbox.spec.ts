import { expect, test, type APIRequestContext } from '@playwright/test'
import { createConnection } from 'mysql2/promise'
import emptyDatabase, { E2E_DATABASE_URL } from './global-setup.ts'
import { draftCampaign } from './setup.ts'

let campaign = ''

async function campaignId(request: APIRequestContext): Promise<number> {
  const list = await (await request.get('/api/campaigns')).json()
  return list.find((c: { name: string }) => c.name === campaign).id
}

// Approves drafts and records them as sent by hand, the state X's API often can't confirm.
async function sendByHand(request: APIRequestContext, count: number) {
  const queue = await (await request.get(`/api/review-queue?campaignId=${await campaignId(request)}`)).json()
  const drafts = queue.items.filter((i: { status: string; sendPath: string }) => i.status === 'pending' && i.sendPath === 'HUMAN_HANDOFF').slice(0, count)
  expect(drafts.length).toBe(count)
  for (const d of drafts) {
    expect((await request.post(`/api/drafts/${d.draftId}/approve`, { data: { contentHash: d.contentHash, confirmedUnbacked: true } })).ok()).toBe(true)
    expect((await request.post(`/api/drafts/${d.draftId}/manual`, { data: { outcome: 'sent' } })).ok()).toBe(true)
  }
}

async function openInbox(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /^Campaign/ }).click()
  await page.getByRole('button', { name: campaign, exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Inbox' }).click()
}

test.beforeAll(async ({ request }) => {
  campaign = await draftCampaign(request)
  await sendByHand(request, 2)
})

// The fake X has only three people worth drafting and a sent one never comes back, so later spec files get a fresh pool.
test.afterAll(async () => {
  await emptyDatabase()
})

test('Inbox: messages sent by hand are checked in X, then marked sent or not sent', async ({ page }) => {
  await openInbox(page)

  const toCheck = page.getByRole('region', { name: /^Check in X/ })
  const delivered = page.getByRole('region', { name: 'Delivered' })
  const cards = toCheck.getByRole('listitem')
  await expect(cards).toHaveCount(2)
  await expect(cards.first().getByRole('link', { name: /^Open chat with @/ })).toHaveAttribute('href', /x\.com\/messages\/compose\?recipient_id=/)

  await cards.first().getByRole('button', { name: 'It was sent' }).click()
  await expect(cards).toHaveCount(1)
  await expect(delivered.getByText('Confirmed by you')).toBeVisible()

  await cards.first().getByRole('button', { name: 'It was not sent' }).click()
  await expect(toCheck.getByText('Nothing to check.')).toBeVisible()
  await expect(delivered.getByRole('listitem')).toHaveCount(1)
})

// The worker's fake X lives in its own process, so the reply it would store is written to the e2e database directly.
async function storeReply(text: string) {
  const db = await createConnection(E2E_DATABASE_URL)
  try {
    const [rows] = await db.query("SELECT id, contactId FROM send_attempts WHERE status = 'sent' ORDER BY id LIMIT 1")
    const [{ id, contactId }] = rows as { id: number; contactId: number }[]
    await db.query("INSERT INTO replies (contactId, attemptId, xEventId, text, source, at) VALUES (?, ?, 'e2e-1', ?, 'api', NOW(3))", [contactId, id, text])
  } finally {
    await db.end()
  }
}

test('Inbox: a reply shows with the message we sent and can be marked handled', async ({ page }) => {
  await storeReply('Sounds interesting, tell me more')
  await openInbox(page)

  const reply = page.getByRole('region', { name: /^Replies/ }).getByRole('listitem')
  await expect(reply).toHaveCount(1)
  await expect(reply.getByText('Sounds interesting, tell me more')).toBeVisible()
  await expect(reply.getByText('You wrote')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Delivered' }).getByText('Replied', { exact: true })).toBeVisible()

  await reply.getByRole('button', { name: 'Mark handled' }).click()
  await expect(reply.getByText('Handled', { exact: true })).toBeVisible()
  await expect(reply.getByRole('button', { name: 'Mark handled' })).toHaveCount(0)
})

test('Inbox: Check now reads the open chats, and "They replied" records a reply the API cannot see', async ({ page, request }) => {
  await sendByHand(request, 1)
  const checks = await (await request.get(`/api/inbox/checks?campaignId=${await campaignId(request)}`)).json()
  expect((await request.post(`/api/send-attempts/${checks.toCheck[0].attemptId}/confirm`, { data: { outcome: 'sent' } })).ok()).toBe(true)
  await openInbox(page)

  const replies = page.getByRole('region', { name: /^Replies/ })
  await replies.getByRole('button', { name: 'Check now' }).click()
  await expect(replies.getByRole('status')).toHaveText('Checking 1 chat, estimated $0.01')

  const delivered = page.getByRole('region', { name: 'Delivered' })
  await delivered.getByRole('button', { name: 'They replied' }).click()
  await expect(delivered.getByText('Replied', { exact: true })).toHaveCount(2)
  await expect(replies.getByRole('listitem').first().getByText('They replied in an encrypted chat. Read it in X.')).toBeVisible()

  await replies.getByRole('button', { name: 'Check now' }).click()
  await expect(replies.getByRole('status')).toHaveText('No chats to check')
})
