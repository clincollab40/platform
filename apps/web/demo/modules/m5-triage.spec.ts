/**
 * M5 Demo — Clinical Triage
 * Run: npx playwright test demo/modules/m5-triage.spec.ts --headed
 * Duration: ~2 min
 */
import { test } from '@playwright/test'
import { T, showChapter, showFeature, highlight, setSectionLabel, clearSectionLabel, gotoAndWait, smoothScrollDown } from '../demo-helpers'

test.setTimeout(5 * 60 * 1000)

test('M5 — Clinical Triage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await showChapter(page, '5', 'Clinical Triage', 'AI-Guided Symptom Assessment · Red Flag Detection · 4 Specialty Templates · WhatsApp Delivery')

  await setSectionLabel(page, 'M5 — Clinical Triage')

  // ── 5.1 Triage sessions
  await gotoAndWait(page, '/triage/sessions')
  await showFeature(page,
    'Triage Sessions Dashboard',
    'Every WhatsApp triage conversation: outcome urgency, escalation flag, and linked referral case.'
  )
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.short)

  await showFeature(page,
    'Session Outcomes',
    'Each session closes with: urgency level, red-flag summary, recommended action, and auto-created referral case (if urgent+).'
  )
  await page.waitForTimeout(T.longRead)

  // ── 5.2 Triage builder
  await gotoAndWait(page, '/triage/builder')
  await showFeature(page,
    'Triage Protocol Builder',
    'Visual question builder with conditional branching. Each question can branch based on patient response.'
  )
  await page.waitForTimeout(T.longRead)

  await highlight(page, 'main', T.feature)
  await showFeature(page,
    '4 Specialty Templates Pre-Seeded',
    'Interventional Cardiology · Cardiac Surgery · Neurosurgery · Orthopaedics. Each covers 15–20 symptom pathways.'
  )
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.short)

  await showFeature(page,
    'Red Flag Rules Engine',
    'Any question can be flagged as a red-flag trigger. "Chest pain + diaphoresis" → Emergency. System bypasses remaining questions and escalates immediately.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'WhatsApp Adaptive Delivery',
    'Questions sent one at a time via WhatsApp. Hindi/English supported. Patient replies → system evaluates → next question sent.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'IC Template — Sample Flow',
    'Q1: Chest pain? → Q2: Radiation? → Q3: Diaphoresis? → RED FLAG if yes → Emergency classification → Immediate specialist alert.'
  )
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})
