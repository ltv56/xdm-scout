import { config } from 'dotenv'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

config({ path: '../../.env', quiet: true })

const testUrl = (process.env.DATABASE_URL ?? '').replace(/\/xdm(\?|$)/, '/xdm_test$1')

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: false,
    env: { NODE_ENV: 'test', DATABASE_URL: testUrl },
    globalSetup: ['./src/test/global-setup.ts'],
    fileParallelism: false,
  },
})
