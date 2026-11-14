import { expect, test, type Page } from '@playwright/test'
import { draftCampaign } from './setup.ts'

let campaign = ''

async function openPendingDraft(page: Page) {
  const approve = page.getByRole('button', { name: 'Approve', exact: true })
  const next = page.getByRole('button', { name: 'Next draft' })
  for (let i = 0; i < 10; i++) {
    if ((await approve.count()) > 0 && (await approve.isEnabled())) return true
    if (await next.isDisabled()) break
    await next.click()
  }
  return false
}

test.beforeAll(async ({ request }) => {
  campaign = await draftCampaign(request)
})

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Campaign/ }).click()
  await page.getByRole('button', { name: campaign, exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: /^Review/ }).click()
  await expect(page.getByRole('region', { name: 'Draft message' })).toBeVisible()
  expect(await openPendingDraft(page)).toBe(true)
})

test('Review: reading a draft, the source of a sentence, and approving it', async ({ page }) => {
  const heading = page.getByRole('heading', { level: 2 })
  await expect(page.getByText('Open chat with @')).toBeDisabled()

  await page.getByRole('region', { name: 'Draft message' }).getByRole('button').nth(1).focus()
  await expect(page.getByRole('region', { name: 'Evidence' })).toBeVisible()

  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByRole('link', { name: /^Open chat with @/ })).toHaveAttribute('href', /x\.com\/messages\/compose/)
  await expect(heading).toBeVisible()
})

test('Review: Skip asks for a reason and moves on', async ({ page }) => {
  const heading = page.getByRole('heading', { level: 2 })
  const before = await heading.textContent()
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await page.getByRole('radio', { name: 'Weak opening' }).check()
  await page.getByRole('button', { name: 'Skip draft' }).click()
  await expect(heading).not.toHaveText(before ?? '')
})

test('Review: Do not contact asks first, and Cancel keeps the draft', async ({ page }) => {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: /^Do not contact @/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: /^Never contact @/ })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('region', { name: 'Draft message' })).toBeVisible()
})
