import { expect, test } from '@playwright/test'
import { ensureCampaign } from './setup.ts'

test.beforeEach(async ({ page, request }) => {
  await ensureCampaign(request)
  await page.goto('/')
  await page.getByRole('button', { name: /^Campaign/ }).click()
  await page.getByRole('button', { name: 'robotics demo', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Candidates' }).click()
})

test('Candidates: people are listed and the tabs filter them', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Candidates' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('3 candidates shown')

  await page.getByRole('button', { name: /^Not a fit/ }).click()
  await expect(page.getByText('Nobody in this list.')).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('0 candidates shown')

  await page.getByRole('button', { name: /^Ready for a draft/ }).click()
  await expect(page.getByRole('status')).toHaveText('3 candidates shown')
})

test('Candidates: filtering by relationship and sorting by followers', async ({ page }) => {
  const names = page.getByRole('listitem').getByRole('link', { name: /@/ }).filter({ hasText: /^[^@]/ })

  await page.getByRole('combobox', { name: 'Sort by' }).selectOption({ label: 'Followers' })
  await page.getByRole('button', { name: /^Sorted/ }).click()
  await expect(names.first()).toContainText('@tomas_agents')
  await page.getByRole('button', { name: /^Sorted/ }).click()
  await expect(names.first()).not.toContainText('@tomas_agents')

  await page.getByRole('combobox', { name: 'Relationship' }).selectOption({ label: 'Messaged you first' })
  await expect(page.getByText('Nobody in this list.')).toBeVisible()
  await page.getByRole('combobox', { name: 'Relationship' }).selectOption({ label: 'Any relationship' })
  await expect(page.getByRole('status')).toHaveText('3 candidates shown')
})
