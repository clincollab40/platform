import { defineConfig, devices } from '@playwright/test'

/**
 * ClinCollab — Playwright E2E Test Configuration
 *
 * Targets all 4 environments via the BASE_URL env var:
 *   production : https://app.clincollab.com
 *   sit        : https://sit.clincollab.com (or Vercel preview)
 *   demo       : https://demo.clincollab.com
 *   local      : http://localhost:3000
 *
 * Run:
 *   npm run test:e2e                          # local (default)
 *   BASE_URL=https://sit.clincollab.com npm run test:e2e
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir:        './e2e',
  fullyParallel:  false,          // keep sequential — DB state depends on ordering
  forbidOnly:     !!process.env.CI,
  retries:        process.env.CI ? 2 : 0,
  workers:        process.env.CI ? 2 : 1,
  timeout:        30_000,         // 30s per test
  expect:         { timeout: 8_000 },

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ...(process.env.CI ? [['github'] as ['github']] : []),
  ],

  use: {
    baseURL:             BASE_URL,
    trace:               'on-first-retry',
    screenshot:          'only-on-failure',
    video:               'retain-on-failure',
    locale:              'en-IN',
    timezoneId:          'Asia/Kolkata',
    actionTimeout:       10_000,
    navigationTimeout:   20_000,
    ignoreHTTPSErrors:   true,   // allow self-signed certs on preview environments
  },

  projects: [
    // ── Setup: authenticate once, save storage state ──────────────
    {
      name:   'setup',
      testMatch: '**/*auth.setup.ts',
    },

    // ── Desktop Chrome (primary) ──────────────────────────────────
    {
      name:        'chromium',
      use:         { ...devices['Desktop Chrome'], storageState: '.auth/user.json' },
      dependencies:['setup'],
    },

    // ── Mobile Safari — critical for WhatsApp deep links ─────────
    {
      name:        'mobile-safari',
      use:         { ...devices['iPhone 14'], storageState: '.auth/user.json' },
      dependencies:['setup'],
      testMatch:   '**/*mobile*.spec.ts',
    },

    // ── Mobile Chrome — Android users (majority in India) ─────────
    {
      name:        'mobile-chrome',
      use:         { ...devices['Pixel 7'], storageState: '.auth/user.json' },
      dependencies:['setup'],
      testMatch:   '**/*mobile*.spec.ts',
    },

    // ── Firefox — secondary desktop coverage ─────────────────────
    {
      name:        'firefox',
      use:         { ...devices['Desktop Firefox'], storageState: '.auth/user.json' },
      dependencies:['setup'],
      testMatch:   '**/*smoke*.spec.ts',   // only smoke tests on Firefox
    },
  ],

  // Start Next.js dev server locally when not in CI
  webServer: process.env.CI ? undefined : {
    command:  'npm run dev',
    url:      'http://localhost:3000',
    timeout:  120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL:      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      NEXT_PUBLIC_APP_URL:           'http://localhost:3000',
      SUPABASE_SERVICE_ROLE_KEY:     process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      ADMIN_EMAIL_WHITELIST:         process.env.ADMIN_EMAIL_WHITELIST ?? '',
    },
  },

  outputDir:           'test-results',
  globalSetup:         undefined,   // set to './tests/e2e/global-setup.ts' when DB seeding is ready
  globalTeardown:      undefined,
})
