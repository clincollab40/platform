/**
 * M5 — Virtual Triage Nurse — Unit Tests
 *
 * Self-contained: all logic inlined as pure functions.
 * FIXES:
 *   1. Red flag levels corrected: 'urgent' > 'needs_review' > 'none'
 *   2. BP parser handles whitespace around slash
 *   3. InsightPanel triage completion score logic added
 *   4. Protocol type validation added (matches DB ENUM)
 */

// ── Branch logic (visibility) ────────────────────────────────────
describe('M5 — triageBranchLogic', () => {
  type Operator = 'eq' | 'neq' | 'gte' | 'lte' | 'gt' | 'lt' | 'contains'
  interface Condition  { question_id?: string; operator: Operator; value: string }
  interface BranchRule { conditions: Condition[]; logic?: 'AND' | 'OR'; action: 'show' | 'hide' }
  interface Question   { id: string; branch_logic: BranchRule[] }

  function evalCondition(cond: Condition, answers: Record<string, string>): boolean {
    const actual = (answers[cond.question_id ?? ''] ?? '').toLowerCase()
    const target = cond.value.toLowerCase()
    switch (cond.operator) {
      case 'eq':       return actual === target
      case 'neq':      return actual !== target
      case 'gte':      return parseFloat(actual) >= parseFloat(target)
      case 'lte':      return parseFloat(actual) <= parseFloat(target)
      case 'gt':       return parseFloat(actual) > parseFloat(target)
      case 'lt':       return parseFloat(actual) < parseFloat(target)
      case 'contains': return actual.includes(target)
      default:         return false
    }
  }

  function isVisible(q: Question, answers: Record<string, string>): boolean {
    if (q.branch_logic.length === 0) return true
    return q.branch_logic.some(rule => {
      const logic = rule.logic ?? 'OR'
      const met = logic === 'AND'
        ? rule.conditions.every(c => evalCondition(c, answers))
        : rule.conditions.some(c => evalCondition(c, answers))
      return rule.action === 'show' ? met : !met
    })
  }

  const q_chestPain: Question  = { id: 'q1', branch_logic: [] }
  const q_radiation: Question  = {
    id: 'q2',
    branch_logic: [{ conditions: [{ question_id: 'q1', operator: 'eq', value: 'yes' }], action: 'show' }],
  }
  const q_severity: Question = {
    id: 'q3',
    branch_logic: [{
      conditions: [
        { question_id: 'q1', operator: 'eq', value: 'yes' },
        { question_id: 'q2', operator: 'eq', value: 'yes' },
      ],
      logic: 'AND',
      action: 'show',
    }],
  }

  test('question with no branch logic always visible',       () => expect(isVisible(q_chestPain, {})).toBe(true))
  test('conditional hidden when condition not met',          () => expect(isVisible(q_radiation, { q1: 'no' })).toBe(false))
  test('conditional shown when condition met',               () => expect(isVisible(q_radiation, { q1: 'yes' })).toBe(true))
  test('conditional hidden with no answers',                 () => expect(isVisible(q_radiation, {})).toBe(false))
  test('AND logic hidden when only one condition met',       () => expect(isVisible(q_severity, { q1: 'yes', q2: 'no' })).toBe(false))
  test('AND logic shown when both conditions met',           () => expect(isVisible(q_severity, { q1: 'yes', q2: 'yes' })).toBe(true))

  const q_or: Question = {
    id: 'q4',
    branch_logic: [{
      conditions: [
        { question_id: 'q1', operator: 'eq', value: 'yes' },
        { question_id: 'q2', operator: 'eq', value: 'severe' },
      ],
      logic: 'OR',
      action: 'show',
    }],
  }
  test('OR logic shown when one condition met',  () => expect(isVisible(q_or, { q1: 'yes', q2: '' })).toBe(true))
  test('OR logic hidden when none met',          () => expect(isVisible(q_or, { q1: 'no',  q2: '' })).toBe(false))
})

// ── Red flag evaluation ──────────────────────────────────────────
describe('M5 — redFlagEvaluation', () => {
  type Level = 'urgent' | 'needs_review' | 'none'
  interface Rule { operator: string; value: string; level: Level; message: string }

  function evalRedFlags(rules: Rule[], answer: string): { triggered: boolean; level: Level; message: string | null } {
    for (const rule of rules) {
      const a = answer.toLowerCase()
      const v = rule.value.toLowerCase()
      let hit = false
      switch (rule.operator) {
        case 'eq':       hit = a === v; break
        case 'gte':      hit = parseFloat(a) >= parseFloat(rule.value); break
        case 'gt':       hit = parseFloat(a) > parseFloat(rule.value); break
        case 'lt':       hit = parseFloat(a) < parseFloat(rule.value); break
        case 'lte':      hit = parseFloat(a) <= parseFloat(rule.value); break
        case 'contains': hit = a.includes(v); break
      }
      if (hit) return { triggered: true, level: rule.level, message: rule.message }
    }
    return { triggered: false, level: 'none', message: null }
  }

  test('eq yes triggers urgent flag',             () => {
    const r = evalRedFlags([{ operator:'eq', value:'yes', level:'urgent', message:'Chest pain reported' }], 'yes')
    expect(r.triggered).toBe(true)
    expect(r.level).toBe('urgent')
  })
  test('eq no does not trigger',                  () => {
    const r = evalRedFlags([{ operator:'eq', value:'yes', level:'urgent', message:'Flag' }], 'no')
    expect(r.triggered).toBe(false)
  })
  test('gte 180 triggers at exactly 180',         () => {
    const r = evalRedFlags([{ operator:'gte', value:'180', level:'urgent', message:'Hypertensive urgency' }], '180')
    expect(r.triggered).toBe(true)
  })
  test('gte 180 does not trigger at 179',         () => {
    const r = evalRedFlags([{ operator:'gte', value:'180', level:'urgent', message:'Hypertensive urgency' }], '179')
    expect(r.triggered).toBe(false)
  })
  test('lt 40 triggers at 35',                    () => {
    const r = evalRedFlags([{ operator:'lt', value:'40', level:'urgent', message:'Bradycardia' }], '35')
    expect(r.triggered).toBe(true)
  })
  test('lt 40 does not trigger at 40',            () => {
    const r = evalRedFlags([{ operator:'lt', value:'40', level:'urgent', message:'Bradycardia' }], '40')
    expect(r.triggered).toBe(false)
  })
  test('contains chest triggers',                 () => {
    const r = evalRedFlags([{ operator:'contains', value:'chest', level:'urgent', message:'Chest symptom' }], 'severe chest pain')
    expect(r.triggered).toBe(true)
  })
  test('contains with no match does not trigger', () => {
    const r = evalRedFlags([{ operator:'contains', value:'chest', level:'urgent', message:'Chest symptom' }], 'back pain')
    expect(r.triggered).toBe(false)
  })
  test('case insensitive eq match',               () => {
    const r = evalRedFlags([{ operator:'eq', value:'YES', level:'needs_review', message:'Flag' }], 'yes')
    expect(r.triggered).toBe(true)
  })
  test('no rules never triggers',                 () => {
    const r = evalRedFlags([], 'yes')
    expect(r.triggered).toBe(false)
  })
})

// ── Session-level red flag aggregation ───────────────────────────
describe('M5 — sessionRedFlagAggregation', () => {
  type Level = 'urgent' | 'needs_review' | 'none'
  function aggregateRedFlags(flags: Array<{ triggered: boolean; level: Level }>): Level {
    if (flags.some(f => f.triggered && f.level === 'urgent'))       return 'urgent'
    if (flags.some(f => f.triggered && f.level === 'needs_review')) return 'needs_review'
    return 'none'
  }

  test('no flags → none',                            () => expect(aggregateRedFlags([])).toBe('none'))
  test('untriggered flags → none',                   () => expect(aggregateRedFlags([{ triggered:false, level:'needs_review' }])).toBe('none'))
  test('needs_review triggered → needs_review',      () => expect(aggregateRedFlags([{ triggered:true, level:'needs_review' }])).toBe('needs_review'))
  test('urgent overrides needs_review',              () => expect(aggregateRedFlags([
    { triggered:true, level:'needs_review' },
    { triggered:true, level:'urgent' },
  ])).toBe('urgent'))
  test('urgent alone → urgent',                      () => expect(aggregateRedFlags([{ triggered:true, level:'urgent' }])).toBe('urgent'))
  test('mixed triggered and not triggered',          () => expect(aggregateRedFlags([
    { triggered:false, level:'urgent' },
    { triggered:true,  level:'needs_review' },
  ])).toBe('needs_review'))
})

// ── Session completion percentage ────────────────────────────────
describe('M5 — sessionCompletionPct', () => {
  function computeCompletion(required: string[], answers: Record<string, string>): number {
    if (required.length === 0) return 100
    const answered = required.filter(id => answers[id] && answers[id].trim().length > 0).length
    return Math.round((answered / required.length) * 100)
  }

  test('0% with no answers',             () => expect(computeCompletion(['q1', 'q2'], {})).toBe(0))
  test('50% with half answered',         () => expect(computeCompletion(['q1', 'q2'], { q1: 'yes' })).toBe(50))
  test('100% with all answered',         () => expect(computeCompletion(['q1', 'q2'], { q1: 'yes', q2: 'no' })).toBe(100))
  test('100% with no required questions',() => expect(computeCompletion([], {})).toBe(100))
  test('empty answer not counted',       () => expect(computeCompletion(['q1'], { q1: '' })).toBe(0))
  test('whitespace-only not counted',    () => expect(computeCompletion(['q1'], { q1: '   ' })).toBe(0))
})

// ── Vitals BP parser ─────────────────────────────────────────────
describe('M5 — vitalsBPParser', () => {
  function parseBP(val: string): { systolic: number | null; diastolic: number | null } {
    const match = val.replace(/\s/g, '').match(/^(\d+)\/(\d+)$/)
    if (!match) return { systolic: null, diastolic: null }
    return { systolic: parseInt(match[1]), diastolic: parseInt(match[2]) }
  }

  test('parses normal BP',                  () => { const r = parseBP('120/80'); expect(r.systolic).toBe(120); expect(r.diastolic).toBe(80) })
  test('parses hypertensive BP',            () => { const r = parseBP('180/110'); expect(r.systolic).toBe(180) })
  test('handles spaces around slash',        () => { const r = parseBP('130 / 85'); expect(r.systolic).toBe(130); expect(r.diastolic).toBe(85) })
  test('returns nulls for invalid format',   () => { const r = parseBP('invalid'); expect(r.systolic).toBeNull() })
  test('returns nulls for single number',    () => { const r = parseBP('120'); expect(r.diastolic).toBeNull() })
  test('returns nulls for empty string',     () => { const r = parseBP(''); expect(r.systolic).toBeNull() })
})

// ── Triage protocol types ────────────────────────────────────────
describe('M5 — triageProtocolTypes', () => {
  // Must match protocol_type ENUM in DB migration
  const VALID_PROTOCOLS = [
    'chest_pain', 'dyspnoea', 'palpitations', 'syncope',
    'pre_procedure_cardiac', 'post_procedure_cardiac',
    'headache', 'seizure', 'stroke_tia', 'pre_procedure_neuro',
    'joint_pain', 'back_pain', 'pre_procedure_ortho',
    'general_pre_consult', 'custom',
  ]
  const isValid = (p: string) => VALID_PROTOCOLS.includes(p)

  test('chest_pain valid',              () => expect(isValid('chest_pain')).toBe(true))
  test('dyspnoea valid',                () => expect(isValid('dyspnoea')).toBe(true))
  test('pre_procedure_cardiac valid',   () => expect(isValid('pre_procedure_cardiac')).toBe(true))
  test('custom valid',                  () => expect(isValid('custom')).toBe(true))
  test('"fever" not in ENUM',           () => expect(isValid('fever')).toBe(false))
  test('empty string invalid',          () => expect(isValid('')).toBe(false))
  test('all defined protocols valid',   () => expect(VALID_PROTOCOLS.every(isValid)).toBe(true))
})

// ── InsightPanel triage score ────────────────────────────────────
describe('M5 — triageInsightScore', () => {
  function computeTriageScore(totalSessions: number, completedSessions: number, urgentCount: number): number {
    if (totalSessions === 0) return 0
    const completionRate = Math.round((completedSessions / totalSessions) * 100)
    const urgencyPenalty = Math.min(20, urgentCount * 5)
    return Math.max(0, completionRate - urgencyPenalty)
  }

  test('no sessions = 0 score',           () => expect(computeTriageScore(0, 0, 0)).toBe(0))
  test('100% completion no urgent = 100', () => expect(computeTriageScore(10, 10, 0)).toBe(100))
  test('50% completion no urgent = 50',   () => expect(computeTriageScore(10, 5, 0)).toBe(50))
  test('each urgent reduces by 5',        () => expect(computeTriageScore(10, 10, 3)).toBe(85))
  test('urgency penalty capped at 20',    () => expect(computeTriageScore(10, 10, 10)).toBe(80))
  test('score never goes below 0',        () => expect(computeTriageScore(10, 0, 10)).toBe(0))
})
