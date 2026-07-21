import { defineConfig, devices } from '@playwright/test'

// Share one secret-free identity across this CLI invocation's project workers.
// A new Playwright process receives a new value, so stale coordination state
// cannot be reused by a later invocation.
process.env.BRAIN_HANDS_BROWSER_EVIDENCE_INVOCATION_ID ??= `playwright-${process.pid}-${Date.now()}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '/private/tmp/orbitarium-playwright-results/results.json' }]],
  outputDir: '/private/tmp/orbitarium-playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe'
  },
  projects: [
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } }
    },
    {
      name: 'desktop-1920',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } }
    }
  ]
})
