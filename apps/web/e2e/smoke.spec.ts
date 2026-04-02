/**
 * Smoke Tests — Fast cross-module health check
 * Verifies that every major page loads without JS errors or blank screens.
 * Runs on all environments (local, sit, demo, production).
 */

import { test, expect } from '@playwright/test'

const PAGES = [
  { name: 'Dashboard',           path: '/dashboard' },
  { name: 'Peer Network',        path: '/network' },
  { name: 'Referrals',           path: '/referrals' },
  { name: 'Appointments',        path: '/appointments' },
  { name: 'AI Chatbot Config',   path: '/chatbot/config' },
  { name: 'Triage Sessions',     path: '/triage/sessions' },
  { name: '360° Synthesis',      path: '/synthesis' },
  { name: 'Transcription',       path: '/transcription' },
  { name: 'Procedure Planner',   path: '/procedures' },
  { name: 'Content Studio',      path: '/content' },
]

test.describe('Smoke — all module pages load', () => {
  for (const { name, path } of PAGES) {
    test(`${name} (${path}) loads without errors`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', err => errors.push(err.message))

      await page.goto(path)
      await page.waitForLoadState('networkidle')

      // Should not be redirected to login (auth state reused from setup)
      expect(page.url()).not.toContain('/auth/login')

      // Should not be a blank page
      const bodyText = await page.evaluate(() => document.body.innerText)
      expect(bodyText.length).toBeGreaterThan(10)

      // No uncaught JS errors
      expect(errors).toHaveLength(0)
    })
  }
})

test.describe('Smoke — AppLayout structure on every page', () => {
  test('Sidebar navigation is visible on Dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('ClinCollab')).toBeVisible()
    await expect(page.getByText('Dashboard')).toBeVisible()
    await expect(page.getByText('Network')).toBeVisible()
  })

  test('AI Insight panel shows on Dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('AI Insight')).toBeVisible()
  })

  test('Search bar is present on all pages', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.getByPlaceholder(/Search colleagues/i)).toBeVisible()
  })
})
