import { defineConfig } from '@playwright/test'

const web = Number(process.env.E2E_WEB_PORT ?? 3020)
const api = process.env.E2E_API_URL ?? 'http://localhost:3021'

// Uses the installed Edge, so no browser is downloaded. The API must already run with REVIEW_STUB=1 X_MODE=fake on its own database; see docs/testing.md.
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${web}`, channel: 'msedge', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx vite',
    cwd: '..',
    env: { WEB_PORT: String(web), API_URL: api },
    url: `http://localhost:${web}`,
    reuseExistingServer: true,
  },
})
