/**
 * M10 Demo — Content Studio
 * Run: npx playwright test demo/modules/m10-content.spec.ts --headed
 * Duration: ~2 min
 */
import { test } from '@playwright/test'
import { T, showChapter, showFeature, highlight, setSectionLabel, clearSectionLabel, gotoAndWait, smoothScrollDown } from '../demo-helpers'

test.setTimeout(5 * 60 * 1000)

test('M10 — Content Studio', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await showChapter(page, '10', 'Content Studio', 'AI CME Generation · Patient Education · PPTX + PDF · Vancouver Citations · Source Credibility Tiers')

  await setSectionLabel(page, 'M10 — Content Studio')

  // ── 10.1 Content list
  await gotoAndWait(page, '/content')
  await showFeature(page,
    'Content Studio Dashboard',
    'AI-powered clinical content: CME modules, grand rounds decks, patient education sheets, referral guidelines, case studies.'
  )
  await page.waitForTimeout(T.longRead)

  await highlight(page, 'aside', T.feature)
  await showFeature(page,
    'CME Score',
    'Score = (completion rate × 80%) + 20 bonus if no content in "awaiting review". Drives specialist accountability for content quality.'
  )
  await page.waitForTimeout(T.read)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.short)

  await showFeature(page,
    'Content Types & Output Formats',
    'CME Module → PPTX + PDF · Grand Rounds → PPTX + PDF · Patient Education → PDF + WhatsApp · Referral Guideline → PDF only · Newsletter → PDF + HTML'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Word Count Limits by Content Type',
    'Patient education: 300–800 words · CME: 1,500–5,000 words · Grand rounds: 1,000–3,000 words. AI enforces limits automatically.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 10.2 Source credibility system
  await showFeature(page,
    'Source Credibility Tier System',
    'Tier 1 (Score 4–5): PubMed, Cochrane, ACC/ESC/CSI/ICMR guidelines · Tier 2 (Score 3): ClinicalTrials.gov, medRxiv · ❌ Excluded: Wikipedia, WebMD, Healthline'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Vancouver Citation Formatter',
    'All AI-generated content includes properly formatted Vancouver references. Up to 6 authors listed; beyond that, "et al." is applied.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 10.3 Patient education gate
  await showFeature(page,
    'Patient Education Review Gate',
    'AI-generated patient-facing content CANNOT be published until a doctor reviews and approves it. Prevents medical errors reaching patients.'
  )
  await page.waitForTimeout(T.longRead)

  // Content detail page
  await showFeature(page,
    'AI Content Generation Pipeline',
    'Doctor sets: topic + content type + target audience → AI searches PubMed/guidelines → drafts content → adds citations → formats output → pending review'
  )
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})
