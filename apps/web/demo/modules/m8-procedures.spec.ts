/**
 * M8 Demo — Procedure Planner
 * Run: npx playwright test demo/modules/m8-procedures.spec.ts --headed
 * Duration: ~2.5 min
 */
import { test } from '@playwright/test'
import { T, showChapter, showFeature, highlight, setSectionLabel, clearSectionLabel, gotoAndWait, smoothScrollDown } from '../demo-helpers'

test.setTimeout(6 * 60 * 1000)

test('M8 — Procedure Planner', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await showChapter(page, '8', 'Procedure Planner', 'Pre-Op Workup · Consent Tracking · 5-Gate Readiness · Medication Holds · Resource Booking')

  await setSectionLabel(page, 'M8 — Procedure Planner')

  // ── 8.1 Procedure list
  await gotoAndWait(page, '/procedures')
  await showFeature(page,
    'Procedure Plans Dashboard',
    'All active procedure plans with real-time readiness status. Red / Amber / Green alerts based on days to procedure date.'
  )
  await page.waitForTimeout(T.longRead)

  await highlight(page, 'aside', T.feature)
  await showFeature(page,
    'Checklist Compliance Score',
    'KPI: % of plans with workup complete AND consent signed. Industry standard pre-op safety metric. Tracked per specialist.'
  )
  await page.waitForTimeout(T.read)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.short)

  await showFeature(page,
    'Care Plan Alert Stages',
    '🟢 Green (> 7 days) · 🟠 Amber (3–7 days) — workup urgency · 🔴 Red (≤ 2 days) — must be ready · ⚫ Overdue — past procedure date'
  )
  await page.waitForTimeout(T.longRead)

  // ── 8.2 5-Gate readiness
  await showFeature(page,
    '5-Gate Readiness Check',
    'A plan can only move to READY status when ALL 5 gates pass: ✅ Workup complete ✅ Consent signed ✅ Anaesthesia plan ✅ Resources booked ✅ Date set'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Workup Status Machine',
    'Each workup item: Not Started → In Progress → Complete (or Waived with reason). Plan stays blocked until all items are done or waived.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 8.3 Consent lifecycle
  await showFeature(page,
    'Consent Lifecycle',
    'Not Started → Sent for Review → Reviewed → Signed (or Waived). WhatsApp notification to patient at each transition. Immutable audit log.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 8.4 Medication hold
  await showFeature(page,
    'Medication Hold Date Calculator',
    'Enter procedure date → system calculates: Warfarin hold 5 days prior · NOAC 2 days · Aspirin 7 days. WhatsApp reminder auto-sent to patient.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 8.5 Resource booking
  await showFeature(page,
    'Resource Booking',
    'Book: OT slot, cath lab, imaging suite, nursing team, equipment. Each resource tracked with confirmation status. Unconfirmed = plan blocker.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Procedure Plan Status Machine',
    'Draft → Active → Scheduled → Ready → In Progress → Completed → Closed. Complication branch: In Progress → Complication → In Progress / Cancelled.'
  )
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})
