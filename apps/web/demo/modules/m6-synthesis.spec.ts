/**
 * M6 Demo — 360° Synthesis
 * Run: npx playwright test demo/modules/m6-synthesis.spec.ts --headed
 * Duration: ~2 min
 */
import { test } from '@playwright/test'
import { T, showChapter, showFeature, highlight, setSectionLabel, clearSectionLabel, gotoAndWait, smoothScrollDown } from '../demo-helpers'

test.setTimeout(5 * 60 * 1000)

test('M6 — 360° Synthesis', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await showChapter(page, '6', '360° Synthesis', 'Groq LLaMA 3.3 70B · Multi-source Patient Summary · Red Flags · Agent Traces')

  await setSectionLabel(page, 'M6 — 360° Synthesis')

  // ── 6.1 Synthesis list
  await gotoAndWait(page, '/synthesis')
  await showFeature(page,
    '360° Patient Synthesis',
    'AI aggregates data from: referral notes, triage responses, transcription sessions, and prior visits into one clinical summary.'
  )
  await page.waitForTimeout(T.longRead)

  await highlight(page, 'aside', T.feature)
  await showFeature(page,
    'Synthesis Coverage Score',
    'Tracks % of patients with a complete AI synthesis. Highlights which cases still need synthesis to be run.'
  )
  await page.waitForTimeout(T.read)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.short)

  await showFeature(page,
    'Synthesis Status Lifecycle',
    'Pending → Processing → Completed → Reviewed. Each status shown with the job timestamp and data sources used.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 6.2 Synthesis detail
  await showFeature(page,
    'Source-by-Source Aggregation',
    'Each source is listed: referral submission, triage session, last consultation note. AI weights sources by recency and completeness.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Red Flag Extraction',
    'Critical findings highlighted automatically: abnormal labs, drug interactions, contraindications, allergy alerts. Shown at the top of every synthesis.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Agent Trace Explainability',
    'Every synthesis step logged: source ingestion → extraction → analysis → synthesis → red flag check → output. Full audit for medicolegal use.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Synthesis Findings Review',
    'Specialist reviews AI findings, marks them confirmed or dismissed, adds clinical notes. Reviewed synthesis is locked and timestamped.'
  )
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})
