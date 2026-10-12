import preact from '@preact/preset-vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [preact()],
  server: { proxy: { '/todos': 'http://127.0.0.1:8000' } },
  test: { environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'] },
})
