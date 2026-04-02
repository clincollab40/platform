/**
 * Functional Tests — M3 Referral Lifecycle Workflow
 *
 * Tests the complete referral lifecycle:
 *   Draft → Submitted → Accepted/Rejected → Completed
 *   + Document upload validation, urgency classification, case routing
 *
 * All logic is inlined (pure functions) — no live DB or API required.
 */

// ── Referral status state machine ────────────────────────────────
describe('Functional — referralStatusStateMachine', () => {
  const TRANSITIONS: Record<string, string[]> = {
    draft:        ['submitted', 'cancelled'],
    submitted:    ['accepted', 'rejected', 'cancelled'],
    accepted:     ['in_progress', 'cancelled'],
    rejected:     ['draft'],                  // can revise and resubmit
    in_progress:  ['completed', 'on_hold'],
    on_hold:      ['in_progress', 'cancelled'],
    completed:    [],
    cancelled:    [],
  }

  function canTransition(from: string, to: string): boolean {
    return (TRANSITIONS[from] ?? []).includes(to)
  }

  function transition(status: string, to: string): { ok: boolean; newStatus?: string; error?: string } {
    if (!canTransition(status, to)) {
      return { ok: false, error: `Cannot transition from ${status} to ${to}` }
    }
    return { ok: true, newStatus: to }
  }

  test('draft → submitted valid',          () => expect(canTransition('draft', 'submitted')).toBe(true))
  test('draft → cancelled valid',          () => expect(canTransition('draft', 'cancelled')).toBe(true))
  test('submitted → accepted valid',       () => expect(canTransition('submitted', 'accepted')).toBe(true))
  test('submitted → rejected valid',       () => expect(canTransition('submitted', 'rejected')).toBe(true))
  test('rejected → draft (revise)',        () => expect(canTransition('rejected', 'draft')).toBe(true))
  test('accepted → in_progress valid',     () => expect(canTransition('accepted', 'in_progress')).toBe(true))
  test('in_progress → completed valid',    () => expect(canTransition('in_progress', 'completed')).toBe(true))
  test('in_progress → on_hold valid',      () => expect(canTransition('in_progress', 'on_hold')).toBe(true))
  test('on_hold → in_progress resume',     () => expect(canTransition('on_hold', 'in_progress')).toBe(true))
  test('completed is terminal',            () => expect(canTransition('completed', 'in_progress')).toBe(false))
  test('cancelled is terminal',            () => expect(canTransition('cancelled', 'submitted')).toBe(false))
  test('draft → completed skip invalid',   () => expect(canTransition('draft', 'completed')).toBe(false))

  test('transition returns newStatus on success', () => {
    const result = transition('draft', 'submitted')
    expect(result.ok).toBe(true)
    expect(result.newStatus).toBe('submitted')
  })

  test('transition returns error on invalid',     () => {
    const result = transition('completed', 'draft')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Cannot transition')
  })
})

// ── Urgency classification ─────────────────────────────────────────
describe('Functional — referralUrgencyClassification', () => {
  interface ClinicalData {
    symptoms:          string[]
    vitals_stable:     boolean
    chest_pain:        boolean
    ecg_changes:       boolean
    stemi:             boolean
    fever_gt_39:       boolean
    altered_sensorium: boolean
  }

  function classifyUrgency(data: ClinicalData): 'emergency' | 'urgent' | 'semi_urgent' | 'elective' {
    // Emergency: STEMI or haemodynamic instability
    if (data.stemi || (!data.vitals_stable && data.chest_pain)) return 'emergency'

    // Urgent: ECG changes, altered sensorium, fever > 39°C
    if (data.ecg_changes || data.altered_sensorium || data.fever_gt_39) return 'urgent'

    // Semi-urgent: chest pain with stable vitals, or 2+ concerning symptoms
    if (data.chest_pain || data.symptoms.length >= 2) return 'semi_urgent'

    return 'elective'
  }

  test('STEMI = emergency',                        () => expect(classifyUrgency({ symptoms:[], vitals_stable:true,  chest_pain:false, ecg_changes:false, stemi:true,  fever_gt_39:false, altered_sensorium:false })).toBe('emergency'))
  test('unstable + chest pain = emergency',        () => expect(classifyUrgency({ symptoms:[], vitals_stable:false, chest_pain:true,  ecg_changes:false, stemi:false, fever_gt_39:false, altered_sensorium:false })).toBe('emergency'))
  test('ECG changes = urgent',                     () => expect(classifyUrgency({ symptoms:[], vitals_stable:true,  chest_pain:false, ecg_changes:true,  stemi:false, fever_gt_39:false, altered_sensorium:false })).toBe('urgent'))
  test('altered sensorium = urgent',               () => expect(classifyUrgency({ symptoms:[], vitals_stable:true,  chest_pain:false, ecg_changes:false, stemi:false, fever_gt_39:false, altered_sensorium:true  })).toBe('urgent'))
  test('fever > 39°C = urgent',                    () => expect(classifyUrgency({ symptoms:[], vitals_stable:true,  chest_pain:false, ecg_changes:false, stemi:false, fever_gt_39:true,  altered_sensorium:false })).toBe('urgent'))
  test('chest pain + stable = semi_urgent',        () => expect(classifyUrgency({ symptoms:[], vitals_stable:true,  chest_pain:true,  ecg_changes:false, stemi:false, fever_gt_39:false, altered_sensorium:false })).toBe('semi_urgent'))
  test('2+ symptoms + stable = semi_urgent',       () => expect(classifyUrgency({ symptoms:['dyspnea','palpitations'], vitals_stable:true, chest_pain:false, ecg_changes:false, stemi:false, fever_gt_39:false, altered_sensorium:false })).toBe('semi_urgent'))
  test('1 mild symptom = elective',                () => expect(classifyUrgency({ symptoms:['fatigue'], vitals_stable:true, chest_pain:false, ecg_changes:false, stemi:false, fever_gt_39:false, altered_sensorium:false })).toBe('elective'))
  test('no symptoms = elective',                   () => expect(classifyUrgency({ symptoms:[], vitals_stable:true, chest_pain:false, ecg_changes:false, stemi:false, fever_gt_39:false, altered_sensorium:false })).toBe('elective'))
})

// ── Referral document validation ──────────────────────────────────
describe('Functional — referralDocumentValidation', () => {
  const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic']
  const MAX_SIZE_MB   = 10

  function validateDocument(file: { name: string; type: string; size: number }): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    if (!ALLOWED_TYPES.includes(file.type)) errors.push(`File type ${file.type} not allowed`)
    if (file.size > MAX_SIZE_MB * 1024 * 1024) errors.push(`File exceeds ${MAX_SIZE_MB}MB limit`)
    if (!file.name.trim()) errors.push('File name cannot be empty')
    return { valid: errors.length === 0, errors }
  }

  test('valid PDF passes',                      () => expect(validateDocument({ name:'report.pdf', type:'application/pdf', size:2*1024*1024 }).valid).toBe(true))
  test('valid JPEG passes',                     () => expect(validateDocument({ name:'ecg.jpg', type:'image/jpeg', size:1*1024*1024 }).valid).toBe(true))
  test('valid PNG passes',                      () => expect(validateDocument({ name:'xray.png', type:'image/png', size:3*1024*1024 }).valid).toBe(true))
  test('HEIC (iPhone) passes',                  () => expect(validateDocument({ name:'photo.heic', type:'image/heic', size:4*1024*1024 }).valid).toBe(true))
  test('DOC file rejected',                     () => {
    const r = validateDocument({ name:'report.doc', type:'application/msword', size:1*1024*1024 })
    expect(r.valid).toBe(false)
    expect(r.errors[0]).toContain('not allowed')
  })
  test('file over 10MB rejected',               () => {
    const r = validateDocument({ name:'large.pdf', type:'application/pdf', size:11*1024*1024 })
    expect(r.valid).toBe(false)
    expect(r.errors[0]).toContain('10MB')
  })
  test('exactly 10MB is accepted (boundary)',   () => expect(validateDocument({ name:'exact.pdf', type:'application/pdf', size:10*1024*1024 }).valid).toBe(true))
  test('empty file name rejected',              () => {
    const r = validateDocument({ name:'', type:'application/pdf', size:1*1024*1024 })
    expect(r.valid).toBe(false)
    expect(r.errors[0]).toContain('empty')
  })
})

// ── Referral routing to specialist ───────────────────────────────
describe('Functional — referralCaseRouting', () => {
  interface Specialist { id: string; specialty: string; city: string; is_available: boolean; current_load: number; max_load: number }

  function findBestMatch(specialists: Specialist[], requiredSpecialty: string, preferredCity: string): Specialist | null {
    const eligible = specialists.filter(s =>
      s.specialty === requiredSpecialty &&
      s.is_available &&
      s.current_load < s.max_load
    )
    if (eligible.length === 0) return null

    // Prefer same city, then lowest load
    const sameCity  = eligible.filter(s => s.city === preferredCity)
    const pool      = sameCity.length > 0 ? sameCity : eligible
    return pool.sort((a, b) => a.current_load - b.current_load)[0]
  }

  const specialists: Specialist[] = [
    { id:'s1', specialty:'interventional_cardiology', city:'Hyderabad', is_available:true,  current_load:3, max_load:10 },
    { id:'s2', specialty:'interventional_cardiology', city:'Hyderabad', is_available:true,  current_load:1, max_load:10 },
    { id:'s3', specialty:'interventional_cardiology', city:'Mumbai',    is_available:true,  current_load:0, max_load:10 },
    { id:'s4', specialty:'neurosurgery',              city:'Hyderabad', is_available:true,  current_load:2, max_load:10 },
    { id:'s5', specialty:'interventional_cardiology', city:'Hyderabad', is_available:false, current_load:0, max_load:10 },
    { id:'s6', specialty:'interventional_cardiology', city:'Hyderabad', is_available:true,  current_load:10, max_load:10 }, // at max
  ]

  test('returns lowest-load available specialist in same city', () => {
    const match = findBestMatch(specialists, 'interventional_cardiology', 'Hyderabad')
    expect(match?.id).toBe('s2')  // load 1 < s1 load 3
  })

  test('unavailable specialists excluded',                       () => {
    const match = findBestMatch(specialists, 'interventional_cardiology', 'Hyderabad')
    expect(match?.id).not.toBe('s5')
  })

  test('at-max-load specialists excluded',                       () => {
    const match = findBestMatch(specialists, 'interventional_cardiology', 'Hyderabad')
    expect(match?.id).not.toBe('s6')
  })

  test('falls back to different city if none in preferred city', () => {
    const cardiologistsOnlyMumbai: Specialist[] = [
      { id:'s3', specialty:'interventional_cardiology', city:'Mumbai', is_available:true, current_load:0, max_load:10 },
    ]
    const match = findBestMatch(cardiologistsOnlyMumbai, 'interventional_cardiology', 'Hyderabad')
    expect(match?.id).toBe('s3')
  })

  test('returns null if no specialist matches specialty',        () => {
    expect(findBestMatch(specialists, 'oncology', 'Hyderabad')).toBeNull()
  })

  test('returns null if all specialists at max load',            () => {
    const full: Specialist[] = [
      { id:'x1', specialty:'neurosurgery', city:'Delhi', is_available:true, current_load:10, max_load:10 },
    ]
    expect(findBestMatch(full, 'neurosurgery', 'Delhi')).toBeNull()
  })
})

// ── Referral token validation ──────────────────────────────────────
describe('Functional — referralTokenValidation', () => {
  function isTokenValid(token: { expires_at: string; used_at: string | null; max_uses: number; use_count: number }): {
    valid: boolean; reason?: string
  } {
    const now = new Date()
    if (new Date(token.expires_at) < now)      return { valid: false, reason: 'Token has expired' }
    if (token.used_at !== null && token.max_uses === 1) return { valid: false, reason: 'Single-use token already consumed' }
    if (token.use_count >= token.max_uses)     return { valid: false, reason: 'Token use limit reached' }
    return { valid: true }
  }

  const futureDate  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const pastDate    = new Date(Date.now() - 1 * 60 * 1000).toISOString()

  test('fresh single-use token valid',              () => expect(isTokenValid({ expires_at:futureDate, used_at:null, max_uses:1, use_count:0 }).valid).toBe(true))
  test('expired token invalid',                     () => {
    const r = isTokenValid({ expires_at:pastDate, used_at:null, max_uses:1, use_count:0 })
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('expired')
  })
  test('used single-use token invalid',             () => {
    const r = isTokenValid({ expires_at:futureDate, used_at:new Date().toISOString(), max_uses:1, use_count:1 })
    expect(r.valid).toBe(false)
  })
  test('multi-use token with remaining uses valid', () => {
    expect(isTokenValid({ expires_at:futureDate, used_at:null, max_uses:5, use_count:3 }).valid).toBe(true)
  })
  test('multi-use token at limit invalid',          () => {
    const r = isTokenValid({ expires_at:futureDate, used_at:null, max_uses:5, use_count:5 })
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('limit reached')
  })
})
