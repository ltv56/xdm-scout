import { expect, test } from '@playwright/test'
import { ensureCampaign } from './setup.ts'

test('When the server fails, Overview, Review and Candidates say so instead of looking empty', async ({ page, request }) => {
  await ensureCampaign(request)
  const fail = (r: { fulfill: (o: object) => Promise<void> }) => r.fulfill({ status: 500, json: { message: 'The server is down' } })
  await page.route('**/api/review-queue*', fail)
  await page.route('**/api/campaigns/*/prospects', fail)
  await page.route('**/api/campaigns/*/drafts/ready', fail)
  await page.goto('/')
  await page.getByRole('button', { name: /^Campaign/ }).click()
  await page.getByRole('button', { name: 'robotics demo', exact: true }).click()
  const nav = page.getByRole('navigation')

  await expect(page.getByRole('alert')).toContainText('Some numbers could not be loaded: The server is down')
  await nav.getByRole('button', { name: /^Review/ }).click()
  await expect(page.getByRole('alert')).toHaveText('The server is down')
  await nav.getByRole('button', { name: 'Candidates' }).click()
  await expect(page.getByRole('alert')).toHaveText('The server is down')
})

test('With nothing to show, Review and Candidates say what to do next', async ({ page, request }) => {
  const id = await ensureCampaign(request)
  await page.route('**/api/review-queue*', (r) => r.fulfill({ json: { campaignId: id, sessionSize: 10, items: [] } }))
  await page.route('**/api/campaigns/*/prospects', (r) => r.fulfill({ json: [] }))
  await page.goto('/')
  await page.getByRole('button', { name: /^Campaign/ }).click()
  await page.getByRole('button', { name: 'robotics demo', exact: true }).click()
  const nav = page.getByRole('navigation')

  await nav.getByRole('button', { name: /^Review/ }).click()
  await expect(page.getByRole('heading', { name: 'Nothing to review' })).toBeVisible()
  await nav.getByRole('button', { name: 'Candidates' }).click()
  await expect(page.getByText('No candidates in this campaign yet.')).toBeVisible()
})
