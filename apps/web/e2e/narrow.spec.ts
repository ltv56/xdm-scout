import { expect, test } from '@playwright/test'
import { ensureCampaign } from './setup.ts'

test.use({ viewport: { width: 390, height: 844 } })

test('On a phone-sized screen nothing scrolls sideways and the draft is readable in full', async ({ page, request }) => {
  await ensureCampaign(request)
  await page.goto('/')
  await page.getByRole('button', { name: /^Campaign/ }).click()
  await page.getByRole('button', { name: 'robotics demo', exact: true }).click()
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const nav = page.getByRole('navigation')

  for (const tab of [/^Overview/, /^Candidates/, /^Review/]) {
    await nav.getByRole('button', { name: tab }).click()
    await expect(page.getByRole('main')).toBeVisible()
    expect(await sideways()).toBe(0)
  }

  const card = page.getByRole('region', { name: 'Draft message' }).locator('div.overflow-y-auto').first()
  expect(await card.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
})
