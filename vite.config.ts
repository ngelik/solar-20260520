import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1' },
  build: { sourcemap: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: true,
    coverage: { provider: 'v8', reporter: ['text', 'html'] }
  }
} as never)
