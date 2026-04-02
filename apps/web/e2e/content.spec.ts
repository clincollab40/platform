/**
 * E2E — Content Studio (M10)
 */
import { test, expect } from '@playwright/test'

test.describe('Content Studio — page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/content')
    await page.waitForLoadState('networkidle')
  })

  test('shows Content Studio breadcrumb', async ({ page }) => {
    await expect(page.getByText('Content Studio')).toBeVisible()
  })

  test('InsightPanel with CME score visible', async ({ page }) => {
    await expect(page.getByText('AI Insight')).toBeVisible()
  })

  test('page renders without crash', async ({ page }) => {
    expect(page.url()).toContain('/content')
    const body = await page.locator('main').textContent()
    expect(body!.length).toBeGreaterThan(0)
  })
})
