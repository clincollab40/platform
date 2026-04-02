/**
 * M2 Demo — Peer Network
 * Run: npx playwright test demo/modules/m2-network.spec.ts --headed
 * Duration: ~2 min
 */
import { test } from '@playwright/test'
import { T, showChapter, showFeature, highlight, setSectionLabel, clearSectionLabel, gotoAndWait, smoothScrollDown } from '../demo-helpers'

test.setTimeout(5 * 60 * 1000)

test('M2 — Peer Network', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await showChapter(page, '2', 'Peer Network', 'Active · Drifting · Silent · City Benchmarks · Engagement Analytics')

  await setSectionLabel(page, 'M2 — Peer Network')

  // ── 2.1 Network overview
  await gotoAndWait(page, '/network')
  await showFeature(page,
    'Peer Network Dashboard',
    'Your complete ecosystem of referring doctors. Each card shows last-referral date, specialty, and engagement status.'
  )
  await page.waitForTimeout(T.longRead)

  // AI Insight
  await highlight(page, 'aside', T.feature)
  await showFeature(page,
    'Network Health Score & City Benchmark',
    'AI compares your active peer count vs the city benchmark. Hyderabad: 14 · Mumbai: 18 · Delhi: 17. Gap = your growth opportunity.'
  )
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.read)

  // Peer status zones
  await showFeature(page,
    'Three-Zone Peer Classification',
    '🟢 Active (referred < 30 days) · 🟡 Drifting (30–90 days) — needs re-engagement · 🔴 Silent (> 90 days) — at risk of loss'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Re-Engagement Workflow',
    'Drifting/silent peers get a personalised WhatsApp re-engagement message. System tracks if they respond and refer again.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 2.2 Add colleague
  await gotoAndWait(page, '/network/add')
  await showFeature(page,
    'Add New Colleague',
    'Enter referring doctor name, hospital, city, and specialty. ClinCollab creates the peer relationship and generates a referral seed link.'
  )
  await page.waitForTimeout(T.longRead)
  await smoothScrollDown(page, 200)

  await showFeature(page,
    'Peer Seed Status Lifecycle',
    'Seeded → Matched → Active → Drifting → Silent → (re-engage) → Active. Full lifecycle tracking per peer relationship.'
  )
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})
