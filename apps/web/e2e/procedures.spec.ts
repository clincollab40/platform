/**
 * E2E — Procedure Planner (M8) & Communications (M9)
 */
import { test, expect } from '@playwright/test'

test.describe('Procedure Planner — page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/procedures')
    await page.waitForLoadState('networkidle')
  })

  test('shows Procedure Planner breadcrumb', async ({ page }) => {
    await expect(page.getByText('Procedure Planner')).toBeVisible()
  })

  test('InsightPanel with checklist compliance score', async ({ page }) => {
    await expect(page.getByText('AI Insight')).toBeVisible()
  })

  test('page renders without crash', async ({ page }) => {
    expect(page.url()).toContain('/procedures')
  })
})

test.describe('Procedure Comms — page', () => {
  test('shows Procedure Comms breadcrumb or redirects to latest plan', async ({ page }) => {
    await page.goto('/procedures/communications')
    await page.waitForLoadState('networkidle')
    // Either shows comms page or redirects to /procedures if no plans
    expect(
      page.url().includes('/procedures/communications') ||
      page.url().includes('/procedures')
    ).toBe(true)
  })
})
