/**
 * Module 5 — Unit Tests
 * Virtual Triage Nurse: branching logic, red flag evaluation,
 * completion tracking, display formatting, vitals parsing
 */

import {
  resolveVisibleQuestions,
  evaluateRedFlags,
  computeSessionRedFlagLevel,
  buildRedFlagSummary,
  formatAnswerForDisplay,
  computeCompletionPct,
  parseBP,
  getQuestionText,
  type TriageQuestion,
  type AnswerMap,
  type RedFlagResult,
} from '@/lib/ai/triage-engine'

// ── Fixture helpers ─────────────────────────────────
function makeQ(
  id: string,
  sort_order: number,
  type: TriageQuestion['question_type'] = 'yes_no',
  overrides: Partial<TriageQuestion> = {}
): TriageQuestion {
  return {
    id,
    question_text: `Question ${sort_order}`,
    question_type: type,
    options: [],
    is_required: false,
    sort_order,
    section: null,
    help_text: null,
    unit: null,
    min_value: null,
    max_value: null,
    branch_logic: [],
    red_flag_rules: [],
    ...overrides,
  }
}

// ══════════════════════════════════════════════════
// BRANCHING LOGIC
// ══════════════════════════════════════════════════
describe('resolveVisibleQuestions — branch logic', () => {
  const q1 = makeQ('q1', 1, 'yes_no')
  const q2 = makeQ('q2', 2, 'text')
  const q3 = makeQ('q3', 3, 'text', {
    branch_logic: [{
      conditions: [{ question_id: 'q1', operator: 'eq', value: 'yes' }],
      action: 'show',
    }],
  })
  const questions = [q1, q2, q3]

  test('shows all questions when no branch logic', () => {
    const answers: AnswerMap = {}
    const visible = resolveVisibleQuestions([q1, q2], answers)
    expect(visible).toHaveLength(2)
  })

  test('hides conditional question when condition not met', () => {
    const answers: AnswerMap = { q1: 'no' }
    const visible = resolveVisibleQuestions(questions, answers)
    expect(visible.find(q => q.id === 'q3')).toBeUndefined()
  })

  test('shows conditional question when condition met', () => {
    const answers: AnswerMap = { q1: 'yes' }
    const visible = resolveVisibleQuestions(questions, answers)
    expect(visible.find(q => q.id === 'q3')).toBeDefined()
  })

  test('conditional question hidden with no answers', () => {
    const answers: AnswerMap = {}
    const visible = resolveVisibleQuestions(questions, answers)
    expect(visible.find(q => q.id === 'q3')).toBeUndefined()
  })

  test('section headers always visible', () => {
    const header = makeQ('h1', 0, 'section_header')
    const visible = resolveVisibleQuestions([header, q1], {})
    expect(visible.find(q => q.id === 'h1')).toBeDefined()
  })

  test('question_ref_order fallback works', () => {
    const q4 = makeQ('q4', 4, 'text', {
      branch_logic: [{
        conditions: [{ question_ref_order: 1, operator: 'eq', value: 'yes' }],
        action: 'show',
      }],
    })
    const visible = resolveVisibleQuestions([q1, q4], { q1: 'yes' })
    expect(visible.find(q => q.id === 'q4')).toBeDefined()
  })

  test('OR logic — shows if any condition met', () => {
    const q5 = makeQ('q5', 5, 'text', {
      branch_logic: [{
        conditions: [
          { question_id: 'q1', operator: 'eq', value: 'yes' },
          { question_id: 'q2', operator: 'eq', value: 'severe' },
        ],
        logic: 'OR',
        action: 'show',
      }],
    })
    // Only q1 answered with yes
    const visible = resolveVisibleQuestions([q1, q2, q5], { q1: 'yes', q2: '' })
    expect(visible.find(q => q.id === 'q5')).toBeDefined()
  })

  test('AND logic — hides if only one condition met', () => {
    const q6 = makeQ('q6', 6, 'text', {
      branch_logic: [{
        conditions: [
          { question_id: 'q1', operator: 'eq', value: 'yes' },
          { question_id: 'q2', operator: 'eq', value: 'severe' },
        ],
        logic: 'AND',
        action: 'show',
      }],
    })
    const visible = resolveVisibleQuestions([q1, q2, q6], { q1: 'yes', q2: 'mild' })
    expect(visible.find(q => q.id === 'q6')).toBeUndefined()
  })
})

// ══════════════════════════════════════════════════
// RED FLAG EVALUATION
// ══════════════════════════════════════════════════
describe('evaluateRedFlags — per question rules', () => {
  test('eq operator — yes triggers flag', () => {
    const q = makeQ('q1', 1, 'yes_no', {
      red_flag_rules: [{ operator: 'eq', value: 'yes', level: 'urgent', message: 'Chest pain' }],
    })
    const result = evaluateRedFlags(q, 'yes')
    expect(result.triggered).toBe(true)
    expect(result.level).toBe('urgent')
    expect(result.message).toBe('Chest pain')
  })

  test('eq operator — no does not trigger', () => {
    const q = makeQ('q1', 1, 'yes_no', {
      red_flag_rules: [{ operator: 'eq', value: 'yes', level: 'urgent', message: 'Flag' }],
    })
    const result = evaluateRedFlags(q, 'no')
    expect(result.triggered).toBe(false)
    expect(result.level).toBe('none')
  })

  test('gte operator — BP 180+ triggers urgent', () => {
    const q = makeQ('q1', 1, 'vitals_single', {
      red_flag_rules: [{ operator: 'gte', value: '180', level: 'urgent', message: 'Hypertensive urgency' }],
    })
    expect(evaluateRedFlags(q, '185').triggered).toBe(true)
    expect(evaluateRedFlags(q, '180').triggered).toBe(true)
    expect(evaluateRedFlags(q, '179').triggered).toBe(false)
  })

  test('lt operator — HR below threshold triggers', () => {
    const q = makeQ('q1', 1, 'vitals_single', {
      red_flag_rules: [{ operator: 'lt', value: '40', level: 'urgent', message: 'Bradycardia' }],
    })
    expect(evaluateRedFlags(q, '35').triggered).toBe(true)
    expect(evaluateRedFlags(q, '40').triggered).toBe(false)
    expect(evaluateRedFlags(q, '50').triggered).toBe(false)
  })

  test('gt operator — scale > 8 triggers needs_review', () => {
    const q = makeQ('q1', 1, 'scale', {
      red_flag_rules: [{ operator: 'gte', value: '8', level: 'needs_review', message: 'Severe pain' }],
    })
    expect(evaluateRedFlags(q, '9').triggered).toBe(true)
    expect(evaluateRedFlags(q, '8').triggered).toBe(true)
    expect(evaluateRedFlags(q, '7').triggered).toBe(false)
  })

  test('contains operator — text match triggers', () => {
    const q = makeQ('q1', 1, 'text', {
      red_flag_rules: [{ operator: 'contains', value: 'chest', level: 'urgent', message: 'Chest symptom' }],
    })
    expect(evaluateRedFlags(q, 'severe chest pain').triggered).toBe(true)
    expect(evaluateRedFlags(q, 'back pain').triggered).toBe(false)
  })

  test('no rules — never triggers', () => {
    const q = makeQ('q1', 1, 'yes_no')
    expect(evaluateRedFlags(q, 'yes').triggered).toBe(false)
  })

  test('case insensitive eq match', () => {
    const q = makeQ('q1', 1, 'yes_no', {
      red_flag_rules: [{ operator: 'eq', value: 'YES', level: 'needs_review', message: 'Flag' }],
    })
    expect(evaluateRedFlags(q, 'yes').triggered).toBe(true)
    expect(evaluateRedFlags(q, 'Yes').triggered).toBe(true)
  })
})

// ══════════════════════════════════════════════════
// SESSION-LEVEL RED FLAG AGGREGATION
// ══════════════════════════════════════════════════
describe('computeSessionRedFlagLevel', () => {
  test('no flags → none', () => {
    const flags: RedFlagResult[] = [
      { triggered: false, level: 'none', message: null },
      { triggered: false, level: 'none', message: null },
    ]
    expect(computeSessionRedFlagLevel(flags)).toBe('none')
  })

  test('any needs_review → needs_review', () => {
    const flags: RedFlagResult[] = [
      { triggered: false, level: 'none', message: null },
      { triggered: true, level: 'needs_review', message: 'Flag' },
    ]
    expect(computeSessionRedFlagLevel(flags)).toBe('needs_review')
  })

  test('any urgent → urgent (overrides needs_review)', () => {
    const flags: RedFlagResult[] = [
      { triggered: true, level: 'needs_review', message: 'Minor' },
      { triggered: true, level: 'urgent', message: 'Critical' },
    ]
    expect(computeSessionRedFlagLevel(flags)).toBe('urgent')
  })

  test('empty array → none', () => {
    expect(computeSessionRedFlagLevel([])).toBe('none')
  })
})

// ══════════════════════════════════════════════════
// COMPLETION PERCENTAGE
// ══════════════════════════════════════════════════
describe('computeCompletionPct', () => {
  const req1  = makeQ('r1', 1, 'yes_no',  { is_required: true })
  const req2  = makeQ('r2', 2, 'text',    { is_required: true })
  const opt1  = makeQ('o1', 3, 'text',    { is_required: false })
  const header = makeQ('h1', 0, 'section_header')

  test('0% with no answers', () => {
    expect(computeCompletionPct([req1, req2], {})).toBe(0)
  })

  test('50% with half required answered', () => {
    expect(computeCompletionPct([req1, req2], { r1: 'yes' })).toBe(50)
  })

  test('100% with all required answered', () => {
    expect(computeCompletionPct([req1, req2], { r1: 'yes', r2: 'some text' })).toBe(100)
  })

  test('optional questions do not affect percentage', () => {
    expect(computeCompletionPct([req1, opt1], { r1: 'yes' })).toBe(100)
  })

  test('section headers excluded from count', () => {
    expect(computeCompletionPct([header, req1], { r1: 'yes' })).toBe(100)
  })

  test('100% with no required questions', () => {
    expect(computeCompletionPct([opt1], {})).toBe(100)
  })
})

// ══════════════════════════════════════════════════
// ANSWER DISPLAY FORMATTING
// ══════════════════════════════════════════════════
describe('formatAnswerForDisplay', () => {
  test('yes_no yes → Yes', () => {
    expect(formatAnswerForDisplay(makeQ('q', 1, 'yes_no'), 'yes')).toBe('Yes')
  })

  test('yes_no no → No', () => {
    expect(formatAnswerForDisplay(makeQ('q', 1, 'yes_no'), 'no')).toBe('No')
  })

  test('scale formats as N / 10', () => {
    const q = makeQ('q', 1, 'scale', { max_value: 10 })
    expect(formatAnswerForDisplay(q, '7')).toBe('7 / 10')
  })

  test('single_choice maps value to label', () => {
    const q = makeQ('q', 1, 'single_choice', {
      options: [{ value: 'pressure', label: 'Pressure / heaviness' }],
    })
    expect(formatAnswerForDisplay(q, 'pressure')).toBe('Pressure / heaviness')
  })

  test('single_choice falls back to value if label not found', () => {
    const q = makeQ('q', 1, 'single_choice', { options: [] })
    expect(formatAnswerForDisplay(q, 'unknown')).toBe('unknown')
  })

  test('multi_choice joins labels', () => {
    const q = makeQ('q', 1, 'multi_choice', {
      options: [
        { value: 'aspirin', label: 'Aspirin' },
        { value: 'clopidogrel', label: 'Clopidogrel' },
      ],
    })
    expect(formatAnswerForDisplay(q, 'aspirin, clopidogrel')).toBe('Aspirin, Clopidogrel')
  })

  test('vitals_bp formats as systolic/diastolic mmHg', () => {
    expect(formatAnswerForDisplay(makeQ('q', 1, 'vitals_bp'), '120/80')).toBe('120/80 mmHg')
  })

  test('vitals_single appends unit', () => {
    const q = makeQ('q', 1, 'vitals_single', { unit: 'bpm' })
    expect(formatAnswerForDisplay(q, '72')).toBe('72 bpm')
  })

  test('number appends unit', () => {
    const q = makeQ('q', 1, 'number', { unit: 'kg' })
    expect(formatAnswerForDisplay(q, '75')).toBe('75 kg')
  })

  test('empty value returns dash', () => {
    expect(formatAnswerForDisplay(makeQ('q', 1, 'text'), '')).toBe('—')
  })
})

// ══════════════════════════════════════════════════
// VITALS BP PARSER
// ══════════════════════════════════════════════════
describe('parseBP', () => {
  test('parses valid BP string', () => {
    const result = parseBP('120/80')
    expect(result.systolic).toBe(120)
    expect(result.diastolic).toBe(80)
  })

  test('returns nulls for invalid format', () => {
    const result = parseBP('invalid')
    expect(result.systolic).toBeNull()
    expect(result.diastolic).toBeNull()
  })

  test('handles whitespace in value', () => {
    const result = parseBP('130 / 85')
    expect(result.systolic).toBe(130)
    expect(result.diastolic).toBe(85)
  })
})

// ══════════════════════════════════════════════════
// LOCALISATION
// ══════════════════════════════════════════════════
describe('getQuestionText localisation', () => {
  const q = makeQ('q1', 1, 'yes_no', {
    question_text: 'Do you have chest pain?',
    question_text_hi: 'क्या आपको सीने में दर्द है?',
    question_text_te: 'మీకు గుండె నొప్పి ఉందా?',
  })

  test('returns English by default', () => {
    expect(getQuestionText(q, 'en')).toBe('Do you have chest pain?')
  })

  test('returns Hindi when available', () => {
    expect(getQuestionText(q, 'hi')).toBe('क्या आपको सीने में दर्द है?')
  })

  test('returns Telugu when available', () => {
    expect(getQuestionText(q, 'te')).toBe('మీకు గుండె నొప్పి ఉందా?')
  })

  test('falls back to English when translation missing', () => {
    const qNoHi = { ...q, question_text_hi: null }
    expect(getQuestionText(qNoHi, 'hi')).toBe('Do you have chest pain?')
  })
})

// ══════════════════════════════════════════════════
// RED FLAG SUMMARY BUILDER
// ══════════════════════════════════════════════════
describe('buildRedFlagSummary', () => {
  test('returns empty string when no flags', () => {
    const q = makeQ('q1', 1, 'yes_no')
    const flags = [{ questionId: 'q1', result: { triggered: false, level: 'none' as const, message: null } }]
    expect(buildRedFlagSummary([q], {}, flags)).toBe('')
  })

  test('includes flag message in summary', () => {
    const q = makeQ('q1', 1, 'yes_no', {
      red_flag_rules: [{ operator: 'eq', value: 'yes', level: 'urgent', message: 'Chest pain reported' }],
    })
    const flags = [{ questionId: 'q1', result: { triggered: true, level: 'urgent' as const, message: 'Chest pain reported' } }]
    const summary = buildRedFlagSummary([q], { q1: 'yes' }, flags)
    expect(summary).toContain('Chest pain reported')
  })

  test('includes multiple flags', () => {
    const q1 = makeQ('q1', 1, 'yes_no')
    const q2 = makeQ('q2', 2, 'vitals_single')
    const flags = [
      { questionId: 'q1', result: { triggered: true, level: 'urgent' as const, message: 'Syncope reported' } },
      { questionId: 'q2', result: { triggered: true, level: 'needs_review' as const, message: 'Tachycardia' } },
    ]
    const summary = buildRedFlagSummary([q1, q2], {}, flags)
    expect(summary).toContain('Syncope reported')
    expect(summary).toContain('Tachycardia')
  })
})
