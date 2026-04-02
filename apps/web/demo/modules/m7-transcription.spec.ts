/**
 * M7 Demo — AI Transcription
 * Run: npx playwright test demo/modules/m7-transcription.spec.ts --headed
 * Duration: ~2 min
 */
import { test } from '@playwright/test'
import { T, showChapter, showFeature, highlight, setSectionLabel, clearSectionLabel, gotoAndWait, smoothScrollDown } from '../demo-helpers'

test.setTimeout(5 * 60 * 1000)

test('M7 — AI Transcription', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await showChapter(page, '7', 'AI Transcription', 'Groq Whisper · SOAP Notes · AI Confidence Score · Note Templates')

  await setSectionLabel(page, 'M7 — Transcription')

  // ── 7.1 Transcription list
  await gotoAndWait(page, '/transcription')
  await showFeature(page,
    'Transcription Dashboard',
    'All consultation recordings and AI-generated SOAP notes. Sortable by date, specialty, or approval status.'
  )
  await page.waitForTimeout(T.longRead)

  await highlight(page, 'aside', T.feature)
  await showFeature(page,
    'Note Approval Score',
    '% of AI-generated notes reviewed and approved by the specialist. Target is 100%. Low score = medicolegal risk flag.'
  )
  await page.waitForTimeout(T.read)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.short)

  await showFeature(page,
    'AI Confidence Score per Note',
    'Each note carries 0–100% AI confidence. Notes below 70% confidence are auto-flagged and cannot be approved without a manual review.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 7.2 Templates
  await gotoAndWait(page, '/transcription/templates')
  await showFeature(page,
    'Note Templates Library',
    'Specialty-specific templates: SOAP, procedure note, discharge summary, follow-up note. Customise per consultation type.'
  )
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.short)

  await showFeature(page,
    'Groq Whisper — Multilingual Support',
    'Record in English, Hindi, Telugu, Tamil — or mixed. Whisper auto-transcribes. AI then converts raw transcript to structured clinical SOAP format.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'SOAP Note Structure',
    'AI auto-fills: Subjective (patient complaints) · Objective (vitals/findings) · Assessment (diagnosis) · Plan (medication + follow-up).'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'One-Click PDF Download',
    'Approved notes download as formatted PDF — ready for patient file, referral documentation, or insurance submission.'
  )
  await page.waitForTimeout(T.read)

  await clearSectionLabel(page)
})
