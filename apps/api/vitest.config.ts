import { config } from 'dotenv'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'
import { testDatabaseUrl } from './src/test/test-db-url'

config({ path: '../../.env', quiet: true })

const testUrl = testDatabaseUrl(process.env.DATABASE_URL ?? '')

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: false,
    env: { NODE_ENV: 'test', DATABASE_URL: testUrl },
    globalSetup: ['./src/test/global-setup.ts'],
    fileParallelism: false,
  },
})
