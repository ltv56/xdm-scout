import { defineConfig } from '@playwright/test'

const web = Number(process.env.E2E_WEB_PORT ?? 3020)
const api = process.env.E2E_API_URL ?? 'http://localhost:3021'

// Uses the installed Edge, so no browser is downloaded. The API and the worker must already run with X_MODE=fake on the e2e database; see docs/testing.md.
export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
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
