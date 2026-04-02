/**
 * M3 Demo — Referral Management
 * Run: npx playwright test demo/modules/m3-referrals.spec.ts --headed
 * Duration: ~2.5 min
 */
import { test } from '@playwright/test'
import { T, showChapter, showFeature, highlight, setSectionLabel, clearSectionLabel, gotoAndWait, smoothScrollDown } from '../demo-helpers'

test.setTimeout(6 * 60 * 1000)

test('M3 — Referral Management', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await showChapter(page, '3', 'Referral Management', 'Emergency → Elective Pipeline · Document Upload · WhatsApp Alerts · Token Links')

  await setSectionLabel(page, 'M3 — Referral Management')

  // ── 3.1 Referrals list
  await gotoAndWait(page, '/referrals')
  await showFeature(page,
    'Referral Inbox',
    'All inbound referrals organised by urgency. Emergency cases surface at the top automatically.'
  )
  await page.waitForTimeout(T.longRead)

  // Urgency system
  await showFeature(page,
    '4-Level Urgency Classification',
    '🔴 Emergency (STEMI / haemodynamic instability) · 🟠 Urgent (ECG changes, AMS) · 🟡 Semi-Urgent · 🟢 Elective'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'AI Urgency Auto-Classification',
    'Referring doctor answers triage questions. AI classifies urgency from symptoms, vitals, and ECG findings. No manual override needed.'
  )
  await page.waitForTimeout(T.longRead)

  // Conversion score
  await highlight(page, 'aside', T.feature)
  await showFeature(page,
    'Referral Conversion Score',
    'Track your referral-to-appointment funnel. AI identifies where referrals drop off (submitted but not accepted, accepted but not scheduled).'
  )
  await page.waitForTimeout(T.read)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.read)

  // Status lifecycle
  await showFeature(page,
    'Full Status Lifecycle with Audit',
    'Draft → Submitted → Accepted → In Progress → Completed. Each transition logged: who, when, and notes. Immutable audit trail.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Document Attachments',
    'ECG scans, blood reports, imaging — PDF, JPEG, PNG, HEIC (iPhone). Max 10MB per file. Stored in Supabase private storage bucket.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 3.2 Public referral form (token-based)
  await gotoAndWait(page, '/refer/tok_demo_clincollab_2024')
  await showFeature(page,
    'Token-Based Public Referral Form',
    'Referring doctors get a personalised link. No login required. Token expires after configurable duration or max uses.'
  )
  await page.waitForTimeout(T.longRead)
  await smoothScrollDown(page, 300)

  await showFeature(page,
    'WhatsApp Notification on Referral',
    'Both referring doctor AND specialist receive instant WhatsApp alerts. Case reference number generated for tracking.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 3.3 Case reply (referring doctor view)
  await gotoAndWait(page, '/refer/reply/CC-2024-001')
  await showFeature(page,
    'Referring Doctor Case Updates',
    'Referring doctor can view case status and add updates via their token link — without logging into ClinCollab.'
  )
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})
