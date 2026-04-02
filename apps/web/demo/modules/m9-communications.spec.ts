/**
 * M9 Demo — Procedure Communications
 * Run: npx playwright test demo/modules/m9-communications.spec.ts --headed
 * Duration: ~2 min
 */
import { test } from '@playwright/test'
import { T, showChapter, showFeature, highlight, setSectionLabel, clearSectionLabel, gotoAndWait, smoothScrollDown } from '../demo-helpers'

test.setTimeout(5 * 60 * 1000)

test('M9 — Procedure Communications', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await showChapter(page, '9', 'Procedure Communications', 'WhatsApp Stakeholder Threads · SLA Breach · Post-Procedure Milestones · Engagement Rate')

  await setSectionLabel(page, 'M9 — Procedure Comms')

  // ── 9.1 Comms hub
  await gotoAndWait(page, '/procedures/communications')
  await showFeature(page,
    'Stakeholder Communications Hub',
    'Centralised WhatsApp threads for every person in the procedure: patient, family, referring doctor, theatre team.'
  )
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.short)

  await showFeature(page,
    'Stakeholder Roles — 9 Types',
    'Patient · Spouse · Parent · Child · Sibling · Caregiver · Referring Doctor · Primary Contact · Emergency Contact. Each with their own thread.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'WhatsApp Reply Intent Parser',
    '"Yes" / "haan" / "confirm" → Confirmed · "No" / "nahi" / "cancel" → Declined · "arrived" / "pahuncha" → Checked-in · "help" / "emergency" → Distress escalation'
  )
  await page.waitForTimeout(T.longRead)

  // ── 9.2 SLA system
  await showFeature(page,
    'SLA Breach Detection',
    'Critical confirmations: 2-hour SLA. Routine confirmations: 24-hour SLA. Breach triggers automatic escalation WhatsApp to specialist.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 9.3 WhatsApp template substitution
  await showFeature(page,
    'WhatsApp Template Variables',
    '"Dear [PATIENT_NAME], your procedure is on [DATE] at [TIME]. Please arrive 30 minutes early." — Personalised per patient, sent at scale.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 9.4 Post-procedure milestones
  await showFeature(page,
    'Post-Procedure Milestone Tracking',
    'Day 0: Discharge instructions · Day 1: Check call · Day 7: Wound/dressing review · Day 30: Final follow-up. All via WhatsApp. Zero manual effort.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Stakeholder Engagement Rate',
    '% of stakeholders who confirmed their notifications. Low engagement → automatic retry. Tracked per procedure plan and per specialist.'
  )
  await page.waitForTimeout(T.read)

  await clearSectionLabel(page)
})
