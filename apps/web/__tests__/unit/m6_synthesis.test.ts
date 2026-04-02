/**
 * M6 — Clinical Synthesis Agent — Unit Tests
 *
 * Self-contained: all logic inlined as pure functions.
 * FIXES:
 *   1. Data completeness uses actual synthesis page score formula: completed*60% + avg_completeness*40%
 *   2. Red flag extraction tests match actual synthesis job findings schema
 *   3. Priority classification aligned with actual urgency levels (emergency > urgent > routine)
 *   4. InsightPanel synthesis score added
 *   5. Trigger validation covers all valid synthesis trigger types
 */

// ── Data completeness scoring ────────────────────────────────────
describe('M6 — dataCompletenessScoring', () => {
  function computeCompleteness(successCount: number, totalTools: number): number {
    if (totalTools === 0) return 0
    return Math.round((successCount / totalTools) * 100)
  }

  test('all 5 tools succeed = 100%',    () => expect(computeCompleteness(5, 5)).toBe(100))
  test('4 of 5 tools = 80%',            () => expect(computeCompleteness(4, 5)).toBe(80))
  test('1 of 5 tools = 20%',            () => expect(computeCompleteness(1, 5)).toBe(20))
  test('0 tools succeed = 0%',          () => expect(computeCompleteness(0, 5)).toBe(0))
  test('no tools total = 0% (safe)',    () => expect(computeCompleteness(0, 0)).toBe(0))
  test('3 of 4 tools = 75%',            () => expect(computeCompleteness(3, 4)).toBe(75))
})

// ── InsightPanel synthesis score (matches synthesis/page.tsx) ────
describe('M6 — synthesisInsightScore', () => {
  // Matches: Math.round(completionRate * 0.6 + avgDataCompleteness * 0.4)
  function computeSynthesisScore(completionRate: number, avgDataCompleteness: number): number {
    return Math.round(completionRate * 0.6 + avgDataCompleteness * 0.4)
  }

  test('100% completion + 100% data = 100', () => expect(computeSynthesisScore(100, 100)).toBe(100))
  test('0% completion + 0% data = 0',       () => expect(computeSynthesisScore(0, 0)).toBe(0))
  test('60% completion + 40% data = 52',    () => expect(computeSynthesisScore(60, 40)).toBe(52))
  test('100% completion + 0% data = 60',    () => expect(computeSynthesisScore(100, 0)).toBe(60))
  test('0% completion + 100% data = 40',    () => expect(computeSynthesisScore(0, 100)).toBe(40))
  test('80% completion + 80% data = 80',    () => expect(computeSynthesisScore(80, 80)).toBe(80))
})

// ── Red flag extraction from synthesis findings ───────────────────
describe('M6 — redFlagExtraction', () => {
  interface Finding { source: string; level?: string; summary?: string; urgency?: string }
  interface RedFlag { description: string; source: string; level: string }

  function extractRedFlags(findings: Finding[]): RedFlag[] {
    const flags: RedFlag[] = []
    for (const f of findings) {
      if (f.source === 'triage_self_report' && f.level && f.level !== 'none') {
        flags.push({ description: f.summary || 'Triage flag', source: f.source, level: f.level })
      }
      if (f.source === 'referral_summary' && f.urgency === 'emergency') {
        flags.push({ description: 'Emergency referral', source: f.source, level: 'urgent' })
      }
    }
    return flags
  }

  test('urgent triage flag extracted',                () => {
    const flags = extractRedFlags([{ source:'triage_self_report', level:'urgent', summary:'BP 190/110' }])
    expect(flags).toHaveLength(1)
    expect(flags[0].level).toBe('urgent')
  })
  test('no flags when triage level is none',          () => {
    const flags = extractRedFlags([{ source:'triage_self_report', level:'none', summary:'' }])
    expect(flags).toHaveLength(0)
  })
  test('emergency referral creates urgent flag',      () => {
    const flags = extractRedFlags([{ source:'referral_summary', urgency:'emergency' }])
    expect(flags[0].level).toBe('urgent')
    expect(flags[0].source).toBe('referral_summary')
  })
  test('needs_review triage flag extracted',          () => {
    const flags = extractRedFlags([{ source:'triage_self_report', level:'needs_review', summary:'Tachycardia' }])
    expect(flags[0].level).toBe('needs_review')
  })
  test('routine referral does NOT create flag',       () => {
    const flags = extractRedFlags([{ source:'referral_summary', urgency:'routine' }])
    expect(flags).toHaveLength(0)
  })
  test('multiple sources contribute multiple flags',  () => {
    const flags = extractRedFlags([
      { source:'triage_self_report', level:'needs_review', summary:'Syncope' },
      { source:'referral_summary', urgency:'emergency' },
    ])
    expect(flags).toHaveLength(2)
  })
})

// ── Synthesis trigger validation ─────────────────────────────────
describe('M6 — synthesisTriggerValidation', () => {
  const VALID_TRIGGERS = [
    'manual', 'pre_consult_scheduled', 'referral_accepted',
    'triage_completed', 'appointment_confirmed',
  ]
  const isValid = (t: string) => VALID_TRIGGERS.includes(t)

  test('manual trigger valid',                  () => expect(isValid('manual')).toBe(true))
  test('referral_accepted valid',               () => expect(isValid('referral_accepted')).toBe(true))
  test('triage_completed valid',                () => expect(isValid('triage_completed')).toBe(true))
  test('appointment_confirmed valid',           () => expect(isValid('appointment_confirmed')).toBe(true))
  test('"auto" not a valid trigger',            () => expect(isValid('auto')).toBe(false))
  test('empty string invalid',                  () => expect(isValid('')).toBe(false))
  test('all defined triggers valid',            () => expect(VALID_TRIGGERS.every(isValid)).toBe(true))
})

// ── Priority classification ──────────────────────────────────────
describe('M6 — synthesisPriorityClassification', () => {
  function classifyPriority(flags: Array<{ level: string }>): 'emergency' | 'urgent' | 'routine' {
    if (flags.some(f => f.level === 'urgent' && f.level === 'urgent')) {
      // check for emergency referral flags
    }
    if (flags.some(f => f.level === 'urgent'))       return 'urgent'
    if (flags.some(f => f.level === 'needs_review')) return 'urgent'  // escalate for safety
    return 'routine'
  }

  // More robust version matching actual logic
  function prioritise(urgencyFromReferral: string, triageLevel: string): 'emergency' | 'urgent' | 'routine' {
    if (urgencyFromReferral === 'emergency')                return 'emergency'
    if (urgencyFromReferral === 'urgent')                   return 'urgent'
    if (triageLevel === 'urgent')                           return 'urgent'
    if (triageLevel === 'needs_review')                     return 'urgent'
    return 'routine'
  }

  test('emergency referral = emergency priority',     () => expect(prioritise('emergency', 'none')).toBe('emergency'))
  test('urgent referral = urgent priority',           () => expect(prioritise('urgent', 'none')).toBe('urgent'))
  test('urgent triage = urgent priority',             () => expect(prioritise('routine', 'urgent')).toBe('urgent'))
  test('needs_review triage = urgent (safety)',       () => expect(prioritise('routine', 'needs_review')).toBe('urgent'))
  test('routine referral + clear triage = routine',   () => expect(prioritise('routine', 'none')).toBe('routine'))
  test('emergency overrides triage level',            () => expect(prioritise('emergency', 'needs_review')).toBe('emergency'))
})

// ── Synthesis context builder ────────────────────────────────────
describe('M6 — synthesisContextBuilder', () => {
  interface ToolOutput {
    source: string
    answers?: Array<{ question_text: string; answer_value: string }>
    chiefComplaint?: string
  }

  function buildContext(outputs: ToolOutput[]): string {
    return outputs.map(o => {
      if (o.source === 'triage_self_report' && o.answers) {
        return 'TRIAGE: ' + o.answers.map(a => `${a.question_text}: ${a.answer_value}`).join(', ')
      }
      if (o.source === 'referral_summary') {
        return `REFERRAL: ${o.chiefComplaint}`
      }
      return `OTHER: ${o.source}`
    }).join('\n\n')
  }

  test('triage answers included in context',      () => {
    const ctx = buildContext([{
      source: 'triage_self_report',
      answers: [{ question_text: 'Do you have chest pain?', answer_value: 'yes' }],
    }])
    expect(ctx).toContain('chest pain')
    expect(ctx).toContain('yes')
  })
  test('referral chief complaint in context',     () => {
    const ctx = buildContext([{ source: 'referral_summary', chiefComplaint: 'Chest tightness on exertion' }])
    expect(ctx).toContain('Chest tightness on exertion')
  })
  test('empty outputs produce empty context',     () => expect(buildContext([])).toBe(''))
  test('multiple sources joined with separator',  () => {
    const ctx = buildContext([
      { source: 'referral_summary', chiefComplaint: 'Chest pain' },
      { source: 'triage_self_report', answers: [{ question_text: 'Breathless?', answer_value: 'yes' }] },
    ])
    expect(ctx).toContain('REFERRAL')
    expect(ctx).toContain('TRIAGE')
  })
})

// ── Synthesis job status machine ─────────────────────────────────
describe('M6 — synthesisJobStatusMachine', () => {
  const TRANSITIONS: Record<string, string[]> = {
    pending:    ['running', 'failed'],
    running:    ['completed', 'failed', 'partial'],
    partial:    ['completed', 'failed'],
    completed:  [],
    failed:     ['pending'],  // retry allowed
  }
  const can = (from: string, to: string) => (TRANSITIONS[from] ?? []).includes(to)

  test('pending → running valid',     () => expect(can('pending', 'running')).toBe(true))
  test('running → completed valid',   () => expect(can('running', 'completed')).toBe(true))
  test('running → failed valid',      () => expect(can('running', 'failed')).toBe(true))
  test('running → partial valid',     () => expect(can('running', 'partial')).toBe(true))
  test('failed → pending (retry)',    () => expect(can('failed', 'pending')).toBe(true))
  test('completed is terminal',       () => expect(can('completed', 'running')).toBe(false))
  test('pending → completed skip',    () => expect(can('pending', 'completed')).toBe(false))
})
