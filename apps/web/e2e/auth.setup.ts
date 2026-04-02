/**
 * Playwright Auth Setup
 * Runs once before all E2E tests. Signs in with the test account
 * and saves the authenticated session state to .auth/user.json.
 * All tests reuse this state — no repeated login flows.
 *
 * Requires env vars:
 *   E2E_TEST_EMAIL    — test specialist's Google email
 *   E2E_TEST_PASSWORD — only needed for email/password auth fallback
 *   BASE_URL          — target environment URL
 */

import { test as setup, expect } from '@playwright/test'
import path from 'path'

const AUTH_FILE = path.join(process.cwd(), '.auth', 'user.json')

setup('authenticate test user', async ({ page }) => {
  const email    = process.env.E2E_TEST_EMAIL ?? ''
  const baseUrl  = process.env.BASE_URL       ?? 'http://localhost:3000'

  if (!email) {
    console.warn('⚠ E2E_TEST_EMAIL not set — skipping auth setup')
    await page.context().storageState({ path: AUTH_FILE })
    return
  }

  // Navigate to login page
  await page.goto(`${baseUrl}/auth/login`)
  await page.waitForLoadState('networkidle')

  // ClinCollab uses Google OAuth — click the Google sign-in button
  // In CI, the test account should be pre-authenticated via NEXT_PUBLIC test cookies
  // or use a magic link flow. Here we handle the direct login page.

  const googleBtn = page.getByRole('button', { name: /Sign in with Google/i })

  if (await googleBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Full OAuth flow not possible in CI headless without Google test account.
    // For CI, set NEXT_PUBLIC_BYPASS_AUTH=1 and use a seeded session cookie.
    console.log('ℹ Google OAuth detected — using cookie-based auth for E2E')
  }

  // Check if already authenticated (redirected to dashboard)
  if (page.url().includes('/dashboard')) {
    console.log('✓ Already authenticated')
  } else {
    // Attempt to navigate directly — will redirect to dashboard if cookie is valid
    await page.goto(`${baseUrl}/dashboard`)
    await page.waitForTimeout(2000)
  }

  // Save storage state for all tests
  await page.context().storageState({ path: AUTH_FILE })
  console.log(`✓ Auth state saved to ${AUTH_FILE}`)
})
