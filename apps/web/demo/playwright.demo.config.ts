/**
 * Playwright Config — Demo Mode
 *
 * Optimised for OBS recording:
 *   - Single chromium browser, headed
 *   - Slow motion for natural pacing
 *   - 1280x720 viewport (1080p-ready when OBS upscales)
 *   - No retries (clean demo, not a test suite)
 *   - Long timeouts (chapters can be slow)
 *
 * Usage:
 *   npx playwright test --config demo/playwright.demo.config.ts [file]
 */

import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.DEMO_URL ?? process.env.BASE_URL ?? 'https://app.clincollab.com'

export default defineConfig({
  testDir:        '.',          // run from demo/ folder
  fullyParallel:  false,        // sequential — maintain demo order
  forbidOnly:     false,
  retries:        0,            // never retry in demo mode
  workers:        1,            // one browser, one demo
  timeout:        20 * 60_000, // 20 minutes per test

  reporter: [
    ['list'],
  ],

  use: {
    baseURL:            BASE_URL,
    headless:           false,       // OBS needs a visible window
    slowMo:             100,         // 100ms between actions = natural feel
    viewport:           { width: 1280, height: 720 },
    trace:              'off',
    screenshot:         'off',
    video:              'off',       // OBS records externally
    locale:             'en-IN',
    timezoneId:         'Asia/Kolkata',
    actionTimeout:      15_000,
    navigationTimeout:  30_000,
    ignoreHTTPSErrors:  true,

    // Reuse authenticated session from e2e auth setup
    storageState:       '.auth/user.json',
  },

  projects: [
    {
      name:  'demo-chromium',
      use:   { ...devices['Desktop Chrome'] },
    },
  ],
})
