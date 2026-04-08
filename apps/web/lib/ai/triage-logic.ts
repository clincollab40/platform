/**
 * ClinCollab Triage Logic — Pure functions + Types
 *
 * This file is SAFE to import in client components.
 * It contains NO server-only imports (no Groq, no Node.js crypto, etc.)
 *
 * For AI-powered functions (synopsis generation), see triage-engine.ts (server-only).
 */

// ── Language type ─────────────────────────────────────────────────────────────
export type Lang = 'en' | 'hi' | 'te' | 'kn' | 'mr' | 'bn'

export const LANG_LABELS: Record<Lang, string> = {
  en: 'English',
  hi: 'हिंदी',
  te: 'తెలుగు',
  kn: 'ಕನ್ನಡ',
  mr: 'मराठी',
  bn: 'বাংলা',
}

// ── Core types ────────────────────────────────────────────────────────────────
export interface TriageQuestion {
  id: string
  question_text: string
  // Localised question text — falls back to question_text if not set
  question_text_hi?: string | null   // Hindi
  question_text_te?: string | null   // Telugu
  question_text_kn?: string | null   // Kannada
  question_text_mr?: string | null   // Marathi
  question_text_bn?: string | null   // Bengali
  question_type: QuestionType
  options: { value: string; label: string }[]
  is_required: boolean
  sort_order: number
  section?: string | null
  help_text?: string | null
  unit?: string | null
  min_value?: number | null
  max_value?: number | null
  branch_logic: BranchRule[]
  red_flag_rules: RedFlagRule[]
  fhir_link_id?: string | null
}

export type QuestionType =
  | 'text' | 'number' | 'yes_no' | 'single_choice'
  | 'multi_choice' | 'scale' | 'date' | 'vitals_bp'
  | 'vitals_single' | 'section_header'

export interface BranchRule {
  conditions: {
    question_id?: string
    question_ref_order?: number
    operator: 'eq' | 'not_eq' | 'gt' | 'lt' | 'contains'
    value: string
  }[]
  logic?: 'AND' | 'OR'
  action: 'show' | 'hide' | 'skip_to'
  target_question_id?: string
}

export interface RedFlagRule {
  operator: 'eq' | 'not_eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'
  value: string
  level: 'needs_review' | 'urgent'
  message: string
}

export interface AnswerMap {
  [questionId: string]: string
}

export interface RedFlagResult {
  triggered: boolean
  level: 'none' | 'needs_review' | 'urgent'
  message: string | null
}

// ── Branch logic resolver ─────────────────────────────────────────────────────
/**
 * Given all protocol questions and answers so far,
 * return only the questions that should currently be visible.
 * Questions with no branch_logic are always shown.
 * Questions with branch_logic are shown only when conditions are met.
 */
export function resolveVisibleQuestions(
  questions: TriageQuestion[],
  answers: AnswerMap
): TriageQuestion[] {
  const orderToId = new Map(questions.map(q => [q.sort_order, q.id]))

  return questions.filter(q => {
    if (q.question_type === 'section_header') return true
    if (!q.branch_logic || q.branch_logic.length === 0) return true

    return q.branch_logic.some(rule => {
      const logic = rule.logic ?? 'AND'
      const results = rule.conditions.map(cond => {
        const qid = cond.question_id
          ?? (cond.question_ref_order ? orderToId.get(cond.question_ref_order) : undefined)
        if (!qid) return false

        const answer  = (answers[qid] ?? '').toLowerCase()
        const condVal = cond.value.toLowerCase()

        switch (cond.operator) {
          case 'eq':       return answer === condVal
          case 'not_eq':   return answer !== condVal
          case 'gt':       return parseFloat(answer) > parseFloat(condVal)
          case 'lt':       return parseFloat(answer) < parseFloat(condVal)
          case 'contains': return answer.includes(condVal)
          default:         return false
        }
      })

      return logic === 'AND' ? results.every(Boolean) : results.some(Boolean)
    })
  })
}

// ── Red flag evaluator ────────────────────────────────────────────────────────
export function evaluateRedFlags(
  question: TriageQuestion,
  answerValue: string
): RedFlagResult {
  if (!question.red_flag_rules || question.red_flag_rules.length === 0) {
    return { triggered: false, level: 'none', message: null }
  }

  const answerNum = parseFloat(answerValue)

  for (const rule of question.red_flag_rules) {
    const ruleNum = parseFloat(rule.value)
    let triggered = false

    switch (rule.operator) {
      case 'eq':       triggered = answerValue.toLowerCase() === rule.value.toLowerCase(); break
      case 'not_eq':   triggered = answerValue.toLowerCase() !== rule.value.toLowerCase(); break
      case 'gt':       triggered = !isNaN(answerNum) && !isNaN(ruleNum) && answerNum > ruleNum; break
      case 'gte':      triggered = !isNaN(answerNum) && !isNaN(ruleNum) && answerNum >= ruleNum; break
      case 'lt':       triggered = !isNaN(answerNum) && !isNaN(ruleNum) && answerNum < ruleNum; break
      case 'lte':      triggered = !isNaN(answerNum) && !isNaN(ruleNum) && answerNum <= ruleNum; break
      case 'contains': triggered = answerValue.toLowerCase().includes(rule.value.toLowerCase()); break
    }

    if (triggered) return { triggered: true, level: rule.level, message: rule.message }
  }

  return { triggered: false, level: 'none', message: null }
}

// ── Session-level red flag aggregator ─────────────────────────────────────────
export function computeSessionRedFlagLevel(
  flags: RedFlagResult[]
): 'none' | 'needs_review' | 'urgent' {
  if (flags.some(f => f.level === 'urgent'))       return 'urgent'
  if (flags.some(f => f.level === 'needs_review')) return 'needs_review'
  return 'none'
}

export function buildRedFlagSummary(
  questions: TriageQuestion[],
  answers: AnswerMap,
  flags: { questionId: string; result: RedFlagResult }[]
): string {
  const triggered = flags.filter(f => f.result.triggered)
  if (triggered.length === 0) return ''

  return triggered
    .map(f => {
      const q = questions.find(q => q.id === f.questionId)
      return `• ${f.result.message || q?.question_text || 'Flag triggered'}`
    })
    .join('\n')
}

// ── Answer display formatter ──────────────────────────────────────────────────
export function formatAnswerForDisplay(
  question: TriageQuestion,
  rawValue: string
): string {
  if (!rawValue) return '—'

  switch (question.question_type) {
    case 'yes_no':
      return rawValue.toLowerCase() === 'yes' ? 'Yes' : 'No'

    case 'single_choice': {
      const opt = question.options.find(o => o.value === rawValue)
      return opt?.label || rawValue
    }

    case 'multi_choice': {
      const vals = rawValue.split(',').map(v => v.trim())
      return vals
        .map(v => question.options.find(o => o.value === v)?.label || v)
        .join(', ')
    }

    case 'scale':
      return `${rawValue} / 10`

    case 'vitals_bp': {
      const parts = rawValue.split('/')
      if (parts.length === 2) return `${parts[0]}/${parts[1]} mmHg`
      return `${rawValue} mmHg`
    }

    case 'vitals_single':
      return question.unit ? `${rawValue} ${question.unit}` : rawValue

    case 'number':
      return question.unit ? `${rawValue} ${question.unit}` : rawValue

    default:
      return rawValue
  }
}

// ── Localised question text ───────────────────────────────────────────────────
/**
 * Returns the question text in the requested language.
 * Falls back to English if the localised version is not set.
 * Patients who answer in their language get clinical questions in the same language.
 */
export function getQuestionText(question: TriageQuestion, language: Lang): string {
  switch (language) {
    case 'hi': return question.question_text_hi || question.question_text
    case 'te': return question.question_text_te || question.question_text
    case 'kn': return question.question_text_kn || question.question_text
    case 'mr': return question.question_text_mr || question.question_text
    case 'bn': return question.question_text_bn || question.question_text
    default:   return question.question_text
  }
}

// ── Vitals BP parser ──────────────────────────────────────────────────────────
export function parseBP(value: string): { systolic: number | null; diastolic: number | null } {
  const parts = value.split('/')
  if (parts.length !== 2) return { systolic: null, diastolic: null }
  const s = parseInt(parts[0], 10)
  const d = parseInt(parts[1], 10)
  return {
    systolic:  isNaN(s) ? null : s,
    diastolic: isNaN(d) ? null : d,
  }
}

// ── Completion percentage ─────────────────────────────────────────────────────
export function computeCompletionPct(
  visibleQuestions: TriageQuestion[],
  answers: AnswerMap
): number {
  const answerable = visibleQuestions.filter(
    q => q.question_type !== 'section_header' && q.is_required
  )
  if (answerable.length === 0) return 100
  const answered = answerable.filter(q => answers[q.id]?.trim())
  return Math.round((answered.length / answerable.length) * 100)
}

// ── FHIR QuestionnaireResponse builder ───────────────────────────────────────
export function buildFhirQuestionnaireResponse(
  sessionId: string,
  protocolId: string,
  patientName: string,
  questions: TriageQuestion[],
  answers: AnswerMap
): object {
  return {
    resourceType: 'QuestionnaireResponse',
    id:           sessionId,
    status:       'completed',
    questionnaire:`Questionnaire/${protocolId}`,
    subject:      { display: patientName },
    authored:     new Date().toISOString(),
    item: questions
      .filter(q => q.question_type !== 'section_header' && answers[q.id])
      .map(q => ({
        linkId:  q.fhir_link_id || q.id,
        text:    q.question_text,
        answer: [{ valueString: answers[q.id] }],
      })),
  }
}
