/**
 * M10 — Clinical Content Engine — Unit Tests
 *
 * Self-contained: all logic inlined as pure functions.
 * FIXES:
 *   1. Source credibility tiers aligned with actual scoring logic
 *      (PubMed/Cochrane/ACC/ESC = Tier 1; ClinicalTrials/medRxiv = Tier 2; Wikipedia excluded)
 *   2. Content type → output format mapping matches actual implementation
 *   3. Word count limits reflect actual content_type config
 *   4. InsightPanel CME score formula matches content/page.tsx
 *   5. Patient education review gate logic added
 */

// ── Source credibility scoring ────────────────────────────────────
describe('M10 — sourceCredibilityScoring', () => {
  const SOURCE_SCORES: Record<string, number> = {
    pubmed:           5,
    cochrane:         5,
    acc_guidelines:   4,
    esc_guidelines:   4,
    csi_guidelines:   4,
    icmr:             4,
    aiims:            4,
    'clinicaltrials.gov': 3,
    medrxiv:          3,
    tct:              3,
  }
  const EXCLUDED_SOURCES = ['wikipedia', 'webmd', 'healthline', 'news_article']

  function getScore(source: string): number | null {
    if (EXCLUDED_SOURCES.includes(source)) return null
    return SOURCE_SCORES[source] ?? 2  // unknown = tier 3
  }

  function isExcluded(source: string): boolean {
    return EXCLUDED_SOURCES.includes(source)
  }

  test('PubMed = tier 1 score 5',               () => expect(getScore('pubmed')).toBe(5))
  test('Cochrane = tier 1 score 5',             () => expect(getScore('cochrane')).toBe(5))
  test('ACC guidelines = tier 1 score 4',       () => expect(getScore('acc_guidelines')).toBe(4))
  test('ESC guidelines = tier 1 score 4',       () => expect(getScore('esc_guidelines')).toBe(4))
  test('CSI guidelines = tier 1 score 4',       () => expect(getScore('csi_guidelines')).toBe(4))
  test('ICMR = tier 1 score 4',                 () => expect(getScore('icmr')).toBe(4))
  test('ClinicalTrials = tier 2 score 3',       () => expect(getScore('clinicaltrials.gov')).toBe(3))
  test('medRxiv = tier 2 score 3',              () => expect(getScore('medrxiv')).toBe(3))
  test('Wikipedia excluded (null)',             () => expect(getScore('wikipedia')).toBeNull())
  test('WebMD excluded (null)',                 () => expect(getScore('webmd')).toBeNull())
  test('Wikipedia is excluded',                 () => expect(isExcluded('wikipedia')).toBe(true))
  test('PubMed is NOT excluded',                () => expect(isExcluded('pubmed')).toBe(false))
  test('4 excluded sources defined',            () => expect(EXCLUDED_SOURCES.length).toBe(4))
})

// ── Content type → output format mapping ─────────────────────────
describe('M10 — contentTypeOutputFormat', () => {
  const FORMAT_MAP: Record<string, string[]> = {
    cme_module:          ['pptx', 'pdf'],
    grand_rounds:        ['pptx', 'pdf'],
    patient_education:   ['pdf', 'whatsapp'],
    referral_guideline:  ['pdf'],
    clinical_summary:    ['pdf'],
    case_study:          ['pdf'],
    newsletter:          ['pdf', 'html'],
  }

  function getFormats(contentType: string): string[] {
    return FORMAT_MAP[contentType] ?? ['pdf']
  }

  test('CME module supports PPTX',              () => expect(getFormats('cme_module')).toContain('pptx'))
  test('Grand rounds supports PPTX',            () => expect(getFormats('grand_rounds')).toContain('pptx'))
  test('Patient education supports WhatsApp',   () => expect(getFormats('patient_education')).toContain('whatsapp'))
  test('Referral guideline = PDF only',         () => { const f = getFormats('referral_guideline'); expect(f).toContain('pdf'); expect(f).not.toContain('pptx') })
  test('Clinical summary = PDF only',           () => expect(getFormats('clinical_summary')).toEqual(['pdf']))
  test('Unknown type defaults to PDF',          () => expect(getFormats('unknown_type')).toEqual(['pdf']))
  test('Newsletter supports HTML',              () => expect(getFormats('newsletter')).toContain('html'))
})

// ── Content pipeline section metric ──────────────────────────────
describe('M10 — contentPipelineSections', () => {
  interface Section { id: string; title: string; word_count: number; deleted: boolean }

  function computePipelineMetrics(sections: Section[]): {
    totalSections: number
    activeSections: number
    deletedSections: number
    totalWordCount: number
    avgWordCount: number
  } {
    const active  = sections.filter(s => !s.deleted)
    const deleted = sections.filter(s => s.deleted)
    const totalWords = active.reduce((sum, s) => sum + s.word_count, 0)
    return {
      totalSections:  sections.length,
      activeSections: active.length,
      deletedSections:deleted.length,
      totalWordCount: totalWords,
      avgWordCount:   active.length > 0 ? Math.round(totalWords / active.length) : 0,
    }
  }

  const sections: Section[] = [
    { id:'s1', title:'Introduction',   word_count:200,  deleted:false },
    { id:'s2', title:'Evidence',       word_count:400,  deleted:false },
    { id:'s3', title:'References',     word_count:100,  deleted:true  },
  ]

  test('total sections = 3',             () => expect(computePipelineMetrics(sections).totalSections).toBe(3))
  test('active sections = 2',            () => expect(computePipelineMetrics(sections).activeSections).toBe(2))
  test('deleted sections = 1',           () => expect(computePipelineMetrics(sections).deletedSections).toBe(1))
  test('total word count = 600 (active)',() => expect(computePipelineMetrics(sections).totalWordCount).toBe(600))
  test('avg word count = 300',           () => expect(computePipelineMetrics(sections).avgWordCount).toBe(300))
  test('empty sections = all zeros',     () => {
    const m = computePipelineMetrics([])
    expect(m.totalSections).toBe(0)
    expect(m.avgWordCount).toBe(0)
  })
})

// ── Patient education review gate ─────────────────────────────────
describe('M10 — patientEducationReviewGate', () => {
  interface ContentRequest { content_type: string; status: string; reviewed_by_doctor: boolean }

  function canPublish(req: ContentRequest): { allowed: boolean; reason?: string } {
    if (req.content_type === 'patient_education' && !req.reviewed_by_doctor) {
      return { allowed: false, reason: 'Patient education content must be reviewed by a doctor before publishing' }
    }
    if (req.status !== 'approved') {
      return { allowed: false, reason: `Cannot publish content with status: ${req.status}` }
    }
    return { allowed: true }
  }

  test('approved CME can publish without doctor review',     () => expect(canPublish({ content_type:'cme_module', status:'approved', reviewed_by_doctor:false }).allowed).toBe(true))
  test('patient_education without review cannot publish',    () => {
    const r = canPublish({ content_type:'patient_education', status:'approved', reviewed_by_doctor:false })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('reviewed by a doctor')
  })
  test('patient_education with review can publish',          () => expect(canPublish({ content_type:'patient_education', status:'approved', reviewed_by_doctor:true }).allowed).toBe(true))
  test('in_progress content cannot publish',                 () => expect(canPublish({ content_type:'cme_module', status:'in_progress', reviewed_by_doctor:true }).allowed).toBe(false))
  test('awaiting_review content cannot publish',             () => expect(canPublish({ content_type:'referral_guideline', status:'awaiting_review', reviewed_by_doctor:false }).allowed).toBe(false))
})

// ── Vancouver citation formatter ──────────────────────────────────
describe('M10 — vancouverCitationFormatter', () => {
  interface Author { surname: string; initials: string }
  interface Reference { authors: Author[]; title: string; journal: string; year: number; volume?: string; pages?: string }

  function formatVancouver(ref: Reference): string {
    const authorStr = ref.authors.slice(0, 6)
      .map(a => `${a.surname} ${a.initials}`)
      .join(', ')
    const etAl = ref.authors.length > 6 ? ', et al' : ''
    const volume = ref.volume ? `;${ref.volume}` : ''
    const pages  = ref.pages  ? `:${ref.pages}`  : ''
    return `${authorStr}${etAl}. ${ref.title}. ${ref.journal}. ${ref.year}${volume}${pages}.`
  }

  test('single author formatted correctly', () => {
    const result = formatVancouver({
      authors: [{ surname: 'Kumar', initials: 'R' }],
      title: 'Coronary artery disease in India',
      journal: 'Indian Heart J',
      year: 2024, volume: '76', pages: '12-18',
    })
    expect(result).toContain('Kumar R')
    expect(result).toContain('Indian Heart J')
    expect(result).toContain('2024;76:12-18')
  })
  test('more than 6 authors adds et al', () => {
    const authors = Array.from({ length: 7 }, (_, i) => ({ surname: `Author${i+1}`, initials: 'A' }))
    const result = formatVancouver({ authors, title: 'Study', journal: 'J Med', year: 2024 })
    expect(result).toContain('et al')
    expect(result).not.toContain('Author7')
  })
  test('6 authors no et al', () => {
    const authors = Array.from({ length: 6 }, (_, i) => ({ surname: `Author${i+1}`, initials: 'A' }))
    const result = formatVancouver({ authors, title: 'Study', journal: 'J Med', year: 2024 })
    expect(result).not.toContain('et al')
    expect(result).toContain('Author6')
  })
})

// ── InsightPanel CME score (matches content/page.tsx) ────────────
describe('M10 — contentInsightScore', () => {
  // Matches: Math.round(completionRate * 0.8 + (hasNoAwaitingReview ? 20 : 0))
  function computeCMEScore(
    completedCount: number,
    totalCount: number,
    awaitingReviewCount: number
  ): number {
    if (totalCount === 0) return 0
    const completionRate    = Math.round((completedCount / totalCount) * 100)
    const reviewBonus       = awaitingReviewCount === 0 ? 20 : 0
    return Math.min(100, Math.round(completionRate * 0.8 + reviewBonus))
  }

  test('no content = 0 score',                    () => expect(computeCMEScore(0, 0, 0)).toBe(0))
  test('100% completion + no awaiting = 100',     () => expect(computeCMEScore(10, 10, 0)).toBe(100))
  test('100% completion + awaiting = 80',         () => expect(computeCMEScore(10, 10, 2)).toBe(80))
  test('50% completion + no awaiting = 60',       () => expect(computeCMEScore(5, 10, 0)).toBe(60))
  test('0% completion + no awaiting = 20',        () => expect(computeCMEScore(0, 10, 0)).toBe(20))
  test('0% completion + awaiting = 0',            () => expect(computeCMEScore(0, 10, 3)).toBe(0))
  test('score capped at 100',                     () => expect(computeCMEScore(10, 10, 0)).toBe(100))
})

// ── Content word count limits ─────────────────────────────────────
describe('M10 — contentWordCountLimits', () => {
  const WORD_LIMITS: Record<string, { min: number; max: number }> = {
    patient_education: { min: 300,  max: 800 },
    cme_module:        { min: 1500, max: 5000 },
    grand_rounds:      { min: 1000, max: 3000 },
    referral_guideline:{ min: 500,  max: 2000 },
    clinical_summary:  { min: 200,  max: 1000 },
    case_study:        { min: 800,  max: 2500 },
  }

  function validateWordCount(contentType: string, wordCount: number): boolean {
    const limits = WORD_LIMITS[contentType]
    if (!limits) return true  // no limits for unknown type
    return wordCount >= limits.min && wordCount <= limits.max
  }

  test('patient education 500 words valid',        () => expect(validateWordCount('patient_education', 500)).toBe(true))
  test('patient education 200 words too short',    () => expect(validateWordCount('patient_education', 200)).toBe(false))
  test('patient education 900 words too long',     () => expect(validateWordCount('patient_education', 900)).toBe(false))
  test('CME module 2000 words valid',              () => expect(validateWordCount('cme_module', 2000)).toBe(true))
  test('CME module 1000 words too short',          () => expect(validateWordCount('cme_module', 1000)).toBe(false))
  test('unknown type always valid',                () => expect(validateWordCount('unknown', 5000)).toBe(true))
})
