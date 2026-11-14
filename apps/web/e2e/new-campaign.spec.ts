import { expect, test } from '@playwright/test'
import { ensureCampaign } from './setup.ts'

test.beforeEach(async ({ page, request }) => {
  await ensureCampaign(request)
  await page.goto('/')
})

test('New campaign: a missing name is refused, then the campaign is created', async ({ page }) => {
  await page.getByRole('button', { name: /^Campaign/ }).click()
  await page.getByRole('button', { name: 'New campaign' }).click()

  await page.getByRole('button', { name: 'Create campaign' }).click()
  await expect(page.getByRole('alert')).toHaveText('Give the campaign a name.')

  const name = `e2e ${Date.now()}`
  await page.getByRole('textbox', { name: 'Name' }).fill(name)
  await page.getByRole('textbox', { name: 'Keywords' }).fill('robotics\nllm')
  await page.getByRole('textbox', { name: 'Handles' }).fill('mina_builds')
  await page.getByRole('button', { name: 'Create campaign' }).click()

  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(page.getByRole('button', { name: `Campaign ${name}` })).toBeVisible()
})

test('New campaign: the program and the call post are saved with the campaign and shown on the Overview', async ({ page, request }) => {
  const profile = {
    intro: 'GenAI Fund backs early AI founders in Southeast Asia.',
    programs: [{ id: 7, name: 'FastTrack AI Accelerator', description: 'An accelerator for AI startups.', link: 'https://genaifund.ai/', deadline: null }],
    signer: 'Vinh',
    sampleMessages: [],
  }
  expect((await request.put('/api/sender-profile', { data: profile })).ok()).toBe(true)
  // Post id of 1 Nov 2026 03:00 UTC: the time sits in the bits above the lowest 22.
  const postId = (BigInt(Date.UTC(2026, 10, 1, 3) - 1288834974657) << 22n).toString()
  await page.reload()

  await page.getByRole('button', { name: /^Campaign/ }).click()
  await page.getByRole('button', { name: 'New campaign' }).click()
  const name = `e2e call ${Date.now()}`
  await page.getByRole('textbox', { name: 'Name' }).fill(name)
  await page.getByRole('textbox', { name: 'Keywords' }).fill('agents')
  await page.getByRole('textbox', { name: 'Handles' }).fill('mina_builds')
  await page.getByRole('combobox', { name: 'Program to offer' }).selectOption('7')
  await page.getByText('Call post (optional)').click()
  await page.getByRole('textbox', { name: 'Link of the post' }).fill(`https://x.com/genaifund_ai/status/${postId}`)
  await page.getByRole('textbox', { name: 'Keyword people DM' }).fill('build')
  await page.getByRole('button', { name: 'Create campaign' }).click()

  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Offers FastTrack AI Accelerator')).toBeVisible()
  await expect(page.getByText(/of 1 Nov, keyword “build”/)).toBeVisible()
})
