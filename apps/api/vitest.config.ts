import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [swc.vite()],
  test: { globals: false, env: { NODE_ENV: 'test' } },
})
