/**
 * M1 Demo — Identity, Auth & Onboarding
 * Run: npx playwright test demo/modules/m1-identity.spec.ts --headed
 * Duration: ~2 min
 */
import { test } from '@playwright/test'
import { T, showChapter, showFeature, highlight, setSectionLabel, clearSectionLabel, gotoAndWait, smoothScrollDown } from '../demo-helpers'

test.setTimeout(5 * 60 * 1000)

test('M1 — Identity, Auth & Onboarding', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await showChapter(page, '1', 'Identity & Onboarding', 'Google OAuth · Specialty Profiling · Profile Completeness')

  await setSectionLabel(page, 'M1 — Identity & Onboarding')

  // ── 1.1 Login page
  await gotoAndWait(page, '/auth/login')
  await showFeature(page,
    'Google OAuth Login',
    'One-click sign-in. No passwords stored in ClinCollab. MCI number verified on first login.'
  )
  await page.waitForTimeout(T.longRead)
  await highlight(page, 'button, [role="button"]', T.feature)
  await page.waitForTimeout(T.short)

  // ── 1.2 Dashboard (post-login home)
  await gotoAndWait(page, '/dashboard')
  await showFeature(page,
    'Clinical Command Center',
    'Personalised dashboard. Practice Health Score = 60% network activity + 40% profile completeness.'
  )
  await page.waitForTimeout(T.longRead)

  // Metric cards
  await highlight(page, '.metric-card, [class*="metric"]', T.feature)
  await showFeature(page,
    'Practice Health Score',
    'Live composite score. Updates instantly as you add peers, complete referrals, and fill your profile.'
  )
  await page.waitForTimeout(T.read)

  // AI Insight Panel
  await highlight(page, 'aside', T.feature)
  await showFeature(page,
    'AI Insight Panel (Groq LLaMA 3.3 70B)',
    'Context-aware recommendations per module. Each insight includes a one-click action to close the gap.'
  )
  await page.waitForTimeout(T.longRead)

  // Sidebar nav
  await highlight(page, 'nav', T.feature)
  await showFeature(page,
    'Module Navigation',
    '11 modules in the left sidebar. Access controlled by your organisation plan tier.'
  )
  await page.waitForTimeout(T.read)

  // ── 1.3 Onboarding flow (review)
  await gotoAndWait(page, '/onboarding')
  await showFeature(page,
    'Specialist Onboarding',
    'Step-by-step: Specialty → Sub-specialty → City → Hospital → MCI number → Photo. Guided progressively.'
  )
  await page.waitForTimeout(T.longRead)
  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.read)

  await showFeature(page,
    'Profile Completeness Score',
    '6 fields tracked: designation, sub-specialty, hospitals, years of experience, photo, MCI number. Each field adds ~17%.'
  )
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})
