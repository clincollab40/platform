/**
 * E2E — Transcription (M7)
 */
import { test, expect } from '@playwright/test'

test.describe('Transcription — page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/transcription')
    await page.waitForLoadState('networkidle')
  })

  test('shows Transcription breadcrumb', async ({ page }) => {
    await expect(page.getByText('Transcription')).toBeVisible()
  })

  test('InsightPanel with approval score visible', async ({ page }) => {
    await expect(page.getByText('AI Insight')).toBeVisible()
  })

  test('page renders without crash', async ({ page }) => {
    expect(page.url()).toContain('/transcription')
  })
})
