import { expect, test, type Page } from '@playwright/test'

async function openPage(page: Page, name: 'Profile' | 'Settings') {
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('list', { name: 'Account menu' }).getByRole('button', { name }).click()
}

const status = (over: object) => ({ mode: 'live', connected: false, handle: null, tokenExpiresAt: null, missingScopes: [], ...over })

test('The X account card connects the sandbox sender in fake mode', async ({ page }) => {
  await page.goto('/')
  await openPage(page, 'Profile')
  const card = page.getByRole('region', { name: 'X account' })
  const connect = card.getByRole('button', { name: 'Use sandbox account' })
  if (await connect.isVisible()) {
    await expect(card).toContainText('Not connected')
    await connect.click()
  }
  await expect(card).toContainText('@sandbox_sender')
  await expect(card).toContainText('Sandbox sender')
  await expect(connect).toHaveCount(0)
})

test('In live mode the card links to the X login, and asks to reconnect when scopes are missing', async ({ page }) => {
  let reply = status({})
  await page.route('**/api/auth/x/status', (r) => r.fulfill({ json: reply }))
  await page.goto('/')
  await openPage(page, 'Profile')
  const card = page.getByRole('region', { name: 'X account' })
  await expect(card.getByRole('link', { name: 'Connect X account' })).toHaveAttribute('href', '/api/auth/x/login')

  reply = status({ connected: true, handle: 'leviath', missingScopes: ['dm.write'] })
  await page.reload()
  await openPage(page, 'Profile')
  await expect(card).toContainText('@leviath')
  await expect(card).toContainText('Reconnect to grant: dm.write')
  await expect(card.getByRole('link', { name: 'Reconnect X account' })).toBeVisible()
})

test('Settings lists only what the operator can fix', async ({ page }) => {
  await page.goto('/')
  await openPage(page, 'Settings')
  const checks = page.getByRole('region', { name: 'Setup check' })
  await expect(checks).toContainText('X account')
  await expect(checks).toContainText('Send DM')
  await expect(checks).toContainText('Not verified until the first send')
  for (const technical of ['Database', 'Decision model', 'Worker', 'Mode']) await expect(checks).not.toContainText(technical)
})
