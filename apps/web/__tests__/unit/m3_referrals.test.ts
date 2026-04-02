/**
 * M3 — Referral Workflow — Unit Tests
 *
 * FIXES from original:
 *   1. Template variable test FIXED: original produced "Dr. Dr. Mehta" (double Dr.)
 *      because template said "Dr. [NAME]" AND variable value was "Dr. Mehta".
 *      Test now uses SPECIALIST_NAME variable with value "Vikram Rao" (no prefix).
 *   2. Added tests for InsightPanel conversion rate logic (new UI)
 *   3. Added referral urgency flag propagation to appointment tests
 */

// ── Referral status machine ──────────────────────────────────────
describe('M3 — referralStatusMachine', () => {
  const TRANSITIONS: Record<string, string[]> = {
    draft:             ['submitted'],
    submitted:         ['queried', 'accepted', 'declined'],
    queried:           ['info_provided', 'cancelled'],
    info_provided:     ['accepted', 'queried', 'declined'],
    accepted:          ['patient_arrived', 'cancelled'],
    patient_arrived:   ['procedure_planned', 'cancelled'],
    procedure_planned: ['completed'],
    completed:         ['closed'],
    closed:            [],
    declined:          [],
    cancelled:         [],
  }
  const can = (from: string, to: string) => (TRANSITIONS[from] ?? []).includes(to)

  test('draft → submitted valid',              () => expect(can('draft', 'submitted')).toBe(true))
  test('submitted → accepted valid',           () => expect(can('submitted', 'accepted')).toBe(true))
  test('submitted → declined valid',           () => expect(can('submitted', 'declined')).toBe(true))
  test('submitted → queried valid',            () => expect(can('submitted', 'queried')).toBe(true))
  test('queried → info_provided valid',        () => expect(can('queried', 'info_provided')).toBe(true))
  test('accepted → patient_arrived valid',     () => expect(can('accepted', 'patient_arrived')).toBe(true))
  test('procedure_planned → completed valid',  () => expect(can('procedure_planned', 'completed')).toBe(true))
  test('completed → closed valid',             () => expect(can('completed', 'closed')).toBe(true))
  test('closed → nothing (terminal)',          () => expect(can('closed', 'submitted')).toBe(false))
  test('declined is terminal',                 () => expect(can('declined', 'accepted')).toBe(false))
  test('cancelled is terminal',                () => expect(can('cancelled', 'accepted')).toBe(false))
  test('submitted → completed skips (invalid)', () => expect(can('submitted', 'completed')).toBe(false))
  test('draft cannot skip to accepted',        () => expect(can('draft', 'accepted')).toBe(false))
})

// ── Reference number format ──────────────────────────────────────
describe('M3 — referenceNumberFormat', () => {
  function generateRefNo(date: Date, seq: number): string {
    const year  = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    return `CC-${year}${month}-${String(seq).padStart(4, '0')}`
  }

  test('format: CC-YYYYMM-NNNN',             () => expect(generateRefNo(new Date('2024-03-15'), 1)).toMatch(/^CC-\d{6}-\d{4}$/))
  test('first case of March 2024',           () => expect(generateRefNo(new Date('2024-03-15'), 1)).toBe('CC-202403-0001'))
  test('100th case zero-padded',             () => expect(generateRefNo(new Date('2024-03-15'), 100)).toBe('CC-202403-0100'))
  test('9999th case',                        () => expect(generateRefNo(new Date('2024-03-15'), 9999)).toBe('CC-202403-9999'))
  test('month zero-padded for January',      () => expect(generateRefNo(new Date('2024-01-01'), 1)).toBe('CC-202401-0001'))
  test('December correctly formatted',       () => expect(generateRefNo(new Date('2024-12-31'), 5)).toBe('CC-202412-0005'))
})

// ── Urgency display ──────────────────────────────────────────────
describe('M3 — urgencyDisplay', () => {
  const urgency = {
    routine:   { label:'Routine',   color:'text-gray-600',  badge:'bg-gray-100' },
    urgent:    { label:'Urgent',    color:'text-amber-600', badge:'bg-amber-50' },
    emergency: { label:'Emergency', color:'text-red-600',   badge:'bg-red-50'   },
  } as Record<string, { label:string; color:string; badge:string }>

  test('routine label correct',     () => expect(urgency.routine.label).toBe('Routine'))
  test('urgent shows amber',        () => expect(urgency.urgent.color).toContain('amber'))
  test('emergency shows red',       () => expect(urgency.emergency.color).toContain('red'))
  test('3 urgency levels covered',  () => expect(Object.keys(urgency).length).toBe(3))
})

// ── Referral token validation ────────────────────────────────────
describe('M3 — referralTokenValidation', () => {
  function isValidToken(t: string): boolean {
    return /^[a-zA-Z0-9_-]{16,64}$/.test(t)
  }

  test('valid 32-char alphanumeric',     () => expect(isValidToken('abcd1234efgh5678ijkl9012mnop3456')).toBe(true))
  test('valid 16-char minimum',          () => expect(isValidToken('abcd1234efgh5678')).toBe(true))
  test('too short (15 chars)',           () => expect(isValidToken('abcd1234efgh567')).toBe(false))
  test('special chars rejected',         () => expect(isValidToken('abcd1234!@#$5678')).toBe(false))
  test('empty token rejected',           () => expect(isValidToken('')).toBe(false))
  test('hyphens and underscores allowed',() => expect(isValidToken('abc-def_ghi-jkl-mno-pqr')).toBe(true))
  test('valid 64-char maximum',          () => expect(isValidToken('a'.repeat(64))).toBe(true))
  test('65-char exceeds maximum',        () => expect(isValidToken('a'.repeat(65))).toBe(false))
})

// ── Document type classification ────────────────────────────────
describe('M3 — documentTypeClassification', () => {
  const VALID = ['prescription','lab_report','ecg','echo_report','imaging','discharge_summary','referral_letter','other']
  const isValid = (t: string) => VALID.includes(t)

  test('ecg valid',                () => expect(isValid('ecg')).toBe(true))
  test('echo_report valid',        () => expect(isValid('echo_report')).toBe(true))
  test('discharge_summary valid',  () => expect(isValid('discharge_summary')).toBe(true))
  test('all 8 types valid',        () => expect(VALID.every(isValid)).toBe(true))
  test('exactly 8 types',          () => expect(VALID.length).toBe(8))
  test('"xray" not valid',         () => expect(isValid('xray')).toBe(false))
  test('"blood_test" not valid',   () => expect(isValid('blood_test')).toBe(false))
})

// ── WhatsApp template substitution (FIXED) ───────────────────────
// FIXED: original test produced "Dr. Dr. Mehta" because:
//   template = "...with Dr. [SPECIALIST_NAME]..."
//   variable = "Dr. Mehta"  → result = "...with Dr. Dr. Mehta..."
// Fix: template uses [SPECIALIST_NAME], variable value is just "Vikram Rao"
describe('M3 — whatsappTemplateSubstitution', () => {
  function applyTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\[(\w+)\]/g, (_, key) => vars[key] ?? `[${key}]`)
  }

  test('all variables replaced — no double Dr.', () => {
    // FIXED: variable value must NOT include "Dr." prefix
    const template = 'Dear [PATIENT_NAME], your appointment with Dr. [SPECIALIST_NAME] is confirmed on [DATE].'
    const result = applyTemplate(template, {
      PATIENT_NAME: 'Rajan Kumar',
      SPECIALIST_NAME: 'Vikram Rao',  // correct: no "Dr." prefix
      DATE: '15 March',
    })
    expect(result).toBe('Dear Rajan Kumar, your appointment with Dr. Vikram Rao is confirmed on 15 March.')
    expect(result).not.toContain('Dr. Dr.')  // guard against the original bug
  })

  test('missing variable kept as placeholder', () => {
    expect(applyTemplate('Hello [NAME]', {})).toBe('Hello [NAME]')
  })

  test('partial substitution works', () => {
    const result = applyTemplate('[GREETING] [NAME]!', { GREETING: 'Namaste' })
    expect(result).toBe('Namaste [NAME]!')
  })

  test('referral notification template', () => {
    const result = applyTemplate(
      'New referral from Dr. [REFERRER]. Patient: [PATIENT]. View: [URL]',
      { REFERRER: 'Sharma', PATIENT: 'Ramesh Kumar', URL: 'https://app.clincollab.com/referrals/c1' }
    )
    expect(result).toContain('Dr. Sharma')
    expect(result).toContain('Ramesh Kumar')
    expect(result).toContain('https://app.clincollab.com')
  })
})

// ── Referral analytics ───────────────────────────────────────────
describe('M3 — referralAnalytics', () => {
  interface Case { status: string; urgency: string; submitted_at: string }
  function summarise(cases: Case[]) {
    const total    = cases.length
    const pending  = cases.filter(c => c.status === 'submitted' || c.status === 'queried').length
    const accepted = cases.filter(c => c.status === 'accepted').length
    const urgent   = cases.filter(c => c.urgency === 'urgent' || c.urgency === 'emergency').length
    const convRate = total > 0 ? Math.round((accepted / total) * 100) : 0
    return { total, pending, accepted, urgent, convRate }
  }

  const cases: Case[] = [
    { status:'submitted',        urgency:'urgent',    submitted_at:'2024-03-10' },
    { status:'accepted',         urgency:'routine',   submitted_at:'2024-03-12' },
    { status:'accepted',         urgency:'emergency', submitted_at:'2024-03-15' },
    { status:'declined',         urgency:'routine',   submitted_at:'2024-03-16' },
    { status:'queried',          urgency:'routine',   submitted_at:'2024-03-18' },
  ]

  test('total count = 5',         () => expect(summarise(cases).total).toBe(5))
  test('pending count = 2',       () => expect(summarise(cases).pending).toBe(2))
  test('accepted count = 2',      () => expect(summarise(cases).accepted).toBe(2))
  test('urgent count = 2',        () => expect(summarise(cases).urgent).toBe(2))
  test('conversion rate = 40%',   () => expect(summarise(cases).convRate).toBe(40))
  test('empty cases → zeros',     () => expect(summarise([]).total).toBe(0))
})

// ── InsightPanel conversion score for referrals (new UI) ─────────
describe('M3 — referralsInsightScore', () => {
  function computeConversionScore(accepted: number, total: number, hasPending: boolean): number {
    if (total === 0) return 0
    const rate = Math.round((accepted / total) * 100)
    return Math.min(100, rate + (hasPending ? 10 : 0))
  }

  test('no cases = 0 score',           () => expect(computeConversionScore(0, 0, false)).toBe(0))
  test('100% accepted = 100 score',    () => expect(computeConversionScore(10, 10, false)).toBe(100))
  test('50% + pending = 60 score',     () => expect(computeConversionScore(5, 10, true)).toBe(60))
  test('score capped at 100',          () => expect(computeConversionScore(10, 10, true)).toBe(100))
  test('0% accepted no pending = 0',   () => expect(computeConversionScore(0, 5, false)).toBe(0))
})
