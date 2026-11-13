import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: Number(process.env.WEB_PORT ?? 3000), proxy: { '/api': process.env.API_URL ?? 'http://localhost:3001' } },
})
