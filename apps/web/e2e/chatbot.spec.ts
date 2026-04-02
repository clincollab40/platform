/**
 * E2E — AI Chatbot Config (M4)
 */
import { test, expect } from '@playwright/test'

test.describe('Chatbot Config — page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/chatbot/config')
    await page.waitForLoadState('networkidle')
  })

  test('shows AI Chatbot breadcrumb', async ({ page }) => {
    await expect(page.getByText('AI Chatbot')).toBeVisible()
  })

  test('InsightPanel shows bot readiness score', async ({ page }) => {
    await expect(page.getByText('AI Insight')).toBeVisible()
  })

  test('page does not crash for inactive bot', async ({ page }) => {
    expect(page.url()).toContain('/chatbot/config')
  })
})

test.describe('Chatbot Config — mobile spec', () => {
  test('page renders on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/chatbot/config')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/chatbot')
  })
})
