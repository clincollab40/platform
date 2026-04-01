/**
 * Module 3 — Unit Tests
 * Referral workflow: status transitions, urgency, token validation, analytics
 */

// ── Reference number format ─────────────────────────
describe('reference number format', () => {
  function isValidRefNo(ref: string) {
    return /^CC-\d{8}-[A-Z0-9]{6}$/.test(ref)
  }

  test('valid format passes', () =>
    expect(isValidRefNo('CC-20240315-A1B2C3')).toBe(true))
  test('wrong prefix fails', () =>
    expect(isValidRefNo('RC-20240315-A1B2C3')).toBe(false))
  test('wrong date length fails', () =>
    expect(isValidRefNo('CC-2024031-A1B2C3')).toBe(false))
  test('short suffix fails', () =>
    expect(isValidRefNo('CC-20240315-A1B2')).toBe(false))
})

// ── Status machine transitions ──────────────────────
describe('referral status transitions', () => {
  const VALID_TRANSITIONS: Record<string, string[]> = {
    submitted:         ['accepted', 'queried', 'declined'],
    queried:           ['info_provided', 'accepted', 'declined'],
    info_provided:     ['accepted', 'queried', 'declined'],
    accepted:          ['patient_arrived', 'cancelled'],
    patient_arrived:   ['procedure_planned', 'cancelled'],
    procedure_planned: ['completed', 'cancelled'],
    completed:         ['closed'],
    closed:            [],
    declined:          [],
    cancelled:         [],
  }

  function canTransition(from: string, to: string) {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false
  }

  test('submitted → accepted is valid',          () => expect(canTransition('submitted', 'accepted')).toBe(true))
  test('submitted → queried is valid',            () => expect(canTransition('submitted', 'queried')).toBe(true))
  test('submitted → declined is valid',           () => expect(canTransition('submitted', 'declined')).toBe(true))
  test('accepted → patient_arrived is valid',     () => expect(canTransition('accepted', 'patient_arrived')).toBe(true))
  test('closed → anything is invalid',            () => expect(canTransition('closed', 'accepted')).toBe(false))
  test('declined → anything is invalid',          () => expect(canTransition('declined', 'accepted')).toBe(false))
  test('completed → closed is valid',             () => expect(canTransition('completed', 'closed')).toBe(true))
  test('submitted → completed skips steps',       () => expect(canTransition('submitted', 'completed')).toBe(false))
})

// ── Token validation ────────────────────────────────
describe('referral token validation', () => {
  function validateToken(token: {
    expires_at: string; used_count: number; max_uses: number
  }) {
    if (new Date(token.expires_at) < new Date()) return { valid: false, reason: 'expired' }
    if (token.used_count >= token.max_uses)       return { valid: false, reason: 'limit_reached' }
    return { valid: true }
  }

  const future = new Date(Date.now() + 86400000 * 30).toISOString()
  const past   = new Date(Date.now() - 86400000).toISOString()

  test('valid token passes',               () => expect(validateToken({ expires_at: future, used_count: 5, max_uses: 100 }).valid).toBe(true))
  test('expired token fails',              () => expect(validateToken({ expires_at: past,   used_count: 0, max_uses: 100 }).valid).toBe(false))
  test('maxed out token fails',            () => expect(validateToken({ expires_at: future, used_count: 100, max_uses: 100 }).valid).toBe(false))
  test('one use remaining passes',         () => expect(validateToken({ expires_at: future, used_count: 99, max_uses: 100 }).valid).toBe(true))
  test('expired reason is correct',        () => expect(validateToken({ expires_at: past,   used_count: 0, max_uses: 100 }).reason).toBe('expired'))
  test('limit reason is correct',          () => expect(validateToken({ expires_at: future, used_count: 100, max_uses: 100 }).reason).toBe('limit_reached'))
})

// ── Urgency classification ──────────────────────────
describe('urgency display', () => {
  const URGENCY_CONFIG: Record<string, { label: string; priority: number }> = {
    emergency: { label: 'Emergency', priority: 0 },
    urgent:    { label: 'Urgent',    priority: 1 },
    routine:   { label: 'Routine',   priority: 2 },
  }

  function sortByUrgency(cases: { urgency: string }[]) {
    return [...cases].sort((a, b) =>
      (URGENCY_CONFIG[a.urgency]?.priority ?? 99) -
      (URGENCY_CONFIG[b.urgency]?.priority ?? 99)
    )
  }

  test('emergency sorts first', () => {
    const cases = [
      { urgency: 'routine' }, { urgency: 'emergency' }, { urgency: 'urgent' }
    ]
    const sorted = sortByUrgency(cases)
    expect(sorted[0].urgency).toBe('emergency')
    expect(sorted[1].urgency).toBe('urgent')
    expect(sorted[2].urgency).toBe('routine')
  })
})

// ── Referral analytics calculation ─────────────────
describe('referral analytics', () => {
  type Case = { status: string; submitted_at: string }

  function getAnalytics(cases: Case[]) {
    const now = Date.now()
    const thirtyDaysAgo = now - 86400000 * 30
    const sixtyDaysAgo  = now - 86400000 * 60

    return {
      total: cases.length,
      thisMonth: cases.filter(c =>
        new Date(c.submitted_at).getTime() >= thirtyDaysAgo
      ).length,
      lastMonth: cases.filter(c => {
        const t = new Date(c.submitted_at).getTime()
        return t < thirtyDaysAgo && t >= sixtyDaysAgo
      }).length,
      completed: cases.filter(c =>
        ['completed', 'closed'].includes(c.status)
      ).length,
    }
  }

  function daysAgo(n: number) {
    return new Date(Date.now() - 86400000 * n).toISOString()
  }

  const cases: Case[] = [
    { status: 'completed',  submitted_at: daysAgo(5) },
    { status: 'accepted',   submitted_at: daysAgo(10) },
    { status: 'submitted',  submitted_at: daysAgo(15) },
    { status: 'closed',     submitted_at: daysAgo(45) },
    { status: 'declined',   submitted_at: daysAgo(50) },
  ]

  test('total count is correct',      () => expect(getAnalytics(cases).total).toBe(5))
  test('this month count is correct', () => expect(getAnalytics(cases).thisMonth).toBe(3))
  test('last month count is correct', () => expect(getAnalytics(cases).lastMonth).toBe(2))
  test('completed count is correct',  () => expect(getAnalytics(cases).completed).toBe(2))
})

// ── Mobile number formatting ────────────────────────
describe('Indian mobile number formatting', () => {
  function formatIndianMobile(mobile: string): string {
    const digits = mobile.replace(/\D/g, '')
    if (digits.startsWith('91') && digits.length === 12) return `+${digits}`
    if (digits.length === 10) return `+91${digits}`
    return `+${digits}`
  }

  test('10 digit number gets +91 prefix',        () => expect(formatIndianMobile('9876543210')).toBe('+919876543210'))
  test('91 prefixed number stays same',           () => expect(formatIndianMobile('919876543210')).toBe('+919876543210'))
  test('spaces and dashes stripped',              () => expect(formatIndianMobile('98765 43210')).toBe('+919876543210'))
  test('+91 format cleaned',                      () => expect(formatIndianMobile('+91-9876543210')).toBe('+919876543210'))
})

// ── File upload validation ──────────────────────────
describe('referral document upload validation', () => {
  const MAX_SIZE = 10 * 1024 * 1024
  const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'application/pdf']

  function validateFile(name: string, size: number, type: string) {
    if (size > MAX_SIZE)          return { valid: false, error: 'exceeds 10MB' }
    if (!ALLOWED.includes(type))  return { valid: false, error: 'unsupported type' }
    return { valid: true }
  }

  test('valid JPEG passes',               () => expect(validateFile('ecg.jpg',   1024*100, 'image/jpeg')).toEqual({ valid: true }))
  test('valid PDF passes',                () => expect(validateFile('lab.pdf',   1024*500, 'application/pdf')).toEqual({ valid: true }))
  test('oversized file fails',            () => expect(validateFile('big.pdf',   MAX_SIZE + 1, 'application/pdf')).toEqual({ valid: false, error: 'exceeds 10MB' }))
  test('unsupported type fails',          () => expect(validateFile('doc.docx',  1024, 'application/docx')).toEqual({ valid: false, error: 'unsupported type' }))
  test('exactly 10MB passes',             () => expect(validateFile('exact.pdf', MAX_SIZE, 'application/pdf')).toEqual({ valid: true }))
})

// ── WhatsApp notification content ──────────────────
describe('WhatsApp notification content', () => {
  function buildAcceptedMessage(
    referrerName: string, specialistName: string,
    patientName: string, expectedDate: string, referenceNo: string
  ) {
    return `ClinCollab — Referral accepted\n\nDr. ${referrerName},\n\nYour referral for ${patientName} has been accepted by Dr. ${specialistName}.`
  }

  test('accepted message contains key details', () => {
    const msg = buildAcceptedMessage('Mehta', 'Kumar', 'Rajan', '2024-04-01', 'CC-20240315-ABC123')
    expect(msg).toContain('Dr. Mehta')
    expect(msg).toContain('Rajan')
    expect(msg).toContain('Dr. Kumar')
  })
})
