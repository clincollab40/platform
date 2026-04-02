/**
 * E2E — 360° Synthesis (M6)
 */
import { test, expect } from '@playwright/test'

test.describe('Synthesis — page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/synthesis')
    await page.waitForLoadState('networkidle')
  })

  test('shows 360° Synthesis breadcrumb', async ({ page }) => {
    await expect(page.getByText('360° Synthesis')).toBeVisible()
  })

  test('InsightPanel visible with synthesis score', async ({ page }) => {
    await expect(page.getByText('AI Insight')).toBeVisible()
  })

  test('page does not crash (empty state OK)', async ({ page }) => {
    expect(page.url()).toContain('/synthesis')
    const body = await page.locator('main').textContent()
    expect(body!.length).toBeGreaterThan(0)
  })
})
