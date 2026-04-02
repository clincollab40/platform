/**
 * E2E — Dashboard (M1)
 * Tests: metric cards visible, InsightPanel score ring, navigation from dashboard.
 */

import { test, expect } from '@playwright/test'

test.describe('Dashboard — page content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('shows Practice Health section', async ({ page }) => {
    await expect(page.getByText(/Practice Health/i).first()).toBeVisible()
  })

  test('shows InsightPanel AI Insight label', async ({ page }) => {
    await expect(page.getByText('AI Insight')).toBeVisible()
  })

  test('score ring displays a number 0–100', async ({ page }) => {
    const scoreText = await page.locator('.font-display').first().textContent()
    const score = parseInt(scoreText ?? '0')
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  test('at least 3 metric cards visible', async ({ page }) => {
    const cards = page.locator('.metric-card')
    await expect(cards).toHaveCountGreaterThan(2)
  })
})

test.describe('Dashboard — navigation', () => {
  test('clicking Network sidebar item goes to /network', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Network' }).first().click()
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/network')
  })

  test('clicking Referrals sidebar item goes to /referrals', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Referrals' }).first().click()
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/referrals')
  })
})
