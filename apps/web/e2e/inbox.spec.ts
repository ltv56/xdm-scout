import { expect, test, type APIRequestContext } from '@playwright/test'
import emptyDatabase from './global-setup.ts'
import { draftCampaign } from './setup.ts'

let campaign = ''

// Approves two drafts and records both as sent by hand, the state X's API often can't confirm.
async function sendTwoByHand(request: APIRequestContext) {
  const list = await (await request.get('/api/campaigns')).json()
  const id = list.find((c: { name: string }) => c.name === campaign).id
  const queue = await (await request.get(`/api/review-queue?campaignId=${id}`)).json()
  const drafts = queue.items.filter((i: { status: string; sendPath: string }) => i.status === 'pending' && i.sendPath === 'HUMAN_HANDOFF').slice(0, 2)
  expect(drafts.length).toBe(2)
  for (const d of drafts) {
    expect((await request.post(`/api/drafts/${d.draftId}/approve`, { data: { contentHash: d.contentHash, confirmedUnbacked: true } })).ok()).toBe(true)
    expect((await request.post(`/api/drafts/${d.draftId}/manual`, { data: { outcome: 'sent' } })).ok()).toBe(true)
  }
}

test.beforeAll(async ({ request }) => {
  campaign = await draftCampaign(request)
  await sendTwoByHand(request)
})

// The fake X has only three people worth drafting and a sent one never comes back, so later spec files get a fresh pool.
test.afterAll(async () => {
  await emptyDatabase()
})

test('Inbox: messages sent by hand are checked in X, then marked sent or not sent', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Campaign/ }).click()
  await page.getByRole('button', { name: campaign, exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Inbox' }).click()

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
