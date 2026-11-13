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
