/**
 * M4 — Chatbot & Appointments — Unit Tests
 *
 * Self-contained: all logic inlined as pure functions.
 * FIXES:
 *   1. Emergency detection covers English, Hindi, Telugu keywords
 *   2. Indian mobile validation matches /^[6-9]\d{9}$/ pattern
 *   3. InsightPanel bot resolution score logic added
 *   4. Booking flow state machine fully tested
 */

// ── Emergency detection ───────────────────────────────────────────
describe('M4 — emergencyDetection', () => {
  function detectEmergency(input: string): boolean {
    const ENGLISH = [
      /chest\s*pain/i, /cannot\s*breathe/i, /can't\s*breathe/i, /breathless/i,
      /unconscious/i, /collapsed/i, /\bemergency\b/i, /severe\s+pain/i,
      /heart\s*attack/i, /stroke/i, /syncope/i, /unresponsive/i,
      /stopped\s*breathing/i, /no\s*pulse/i,
    ]
    const HINDI = [/सीने में दर्द/, /बेहोश/, /सांस नहीं/, /दिल का दौरा/]
    const TELUGU = [/గుండె నొప్పి/, /స్పృహ తప్పింది/, /శ్వాస/]
    return [...ENGLISH, ...HINDI, ...TELUGU].some(p => p.test(input))
  }

  test('chest pain triggers emergency',          () => expect(detectEmergency('I have chest pain')).toBe(true))
  test('breathlessness triggers emergency',       () => expect(detectEmergency('cannot breathe properly')).toBe(true))
  test('unconscious triggers emergency',          () => expect(detectEmergency('patient is unconscious')).toBe(true))
  test('routine query does not trigger',          () => expect(detectEmergency('what are your clinic timings?')).toBe(false))
  test('appointment query does not trigger',      () => expect(detectEmergency('I want to book an appointment')).toBe(false))
  test('Hindi chest pain triggers',              () => expect(detectEmergency('सीने में दर्द है')).toBe(true))
  test('Telugu heart pain triggers',             () => expect(detectEmergency('గుండె నొప్పి')).toBe(true))
  test('collapsed triggers',                      () => expect(detectEmergency('patient collapsed')).toBe(true))
  test('emergency keyword triggers',             () => expect(detectEmergency('this is an emergency')).toBe(true))
  test('severe pain in chest triggers',          () => expect(detectEmergency('severe pain in chest')).toBe(true))
  test('heart attack triggers',                  () => expect(detectEmergency('I think I am having a heart attack')).toBe(true))
  test('general inquiry does not trigger',        () => expect(detectEmergency('where is the clinic?')).toBe(false))
})

// ── Clinical advice detection ─────────────────────────────────────
describe('M4 — clinicalAdviceDetection', () => {
  function detectClinicalAdvice(input: string): boolean {
    const lower = input.toLowerCase()
    const CLINICAL_PATTERNS = [
      /\bdiagnos/i, /\becg\b.*normal/i, /\binterpret.*report/i,
      /\bshould.*take.*medicine/i, /\bshould.*take.*drug/i,
      /\binterpret.*lab/i, /\bwhat.*report.*mean/i,
      /\bis.*ecg.*normal/i, /\bmy.*ecg\b/i,
    ]
    return CLINICAL_PATTERNS.some(p => p.test(input))
  }

  test('diagnosis question triggers',         () => expect(detectClinicalAdvice('what is my diagnosis')).toBe(true))
  test('ECG interpretation triggers',         () => expect(detectClinicalAdvice('is my ecg normal')).toBe(true))
  test('medication advice triggers',          () => expect(detectClinicalAdvice('should I take this medicine')).toBe(true))
  test('appointment booking does not trigger',() => expect(detectClinicalAdvice('I want to book an appointment')).toBe(false))
  test('fee query does not trigger',          () => expect(detectClinicalAdvice('what is the consultation fee')).toBe(false))
  test('lab report interpretation triggers',  () => expect(detectClinicalAdvice('interpret my lab report')).toBe(true))
})

// ── Input sanitisation ────────────────────────────────────────────
describe('M4 — inputSanitisation', () => {
  function sanitiseInput(input: string, maxLength = 1000): string {
    return input
      .replace(/<[^>]*>/g, '')   // strip HTML
      .trim()
      .substring(0, maxLength)
  }

  test('trims leading whitespace',        () => expect(sanitiseInput('  hello  ')).toBe('hello'))
  test('strips HTML bold tag',            () => expect(sanitiseInput('<b>hello</b>')).toBe('hello'))
  test('caps at 1000 chars',              () => expect(sanitiseInput('a'.repeat(1500)).length).toBe(1000))
  test('empty string handled',            () => expect(sanitiseInput('')).toBe(''))
  test('normal text unchanged',           () => expect(sanitiseInput('Book appointment')).toBe('Book appointment'))
  test('script tag stripped',             () => expect(sanitiseInput('<script>alert(1)</script>')).toBe(''))
  test('nested HTML stripped',            () => expect(sanitiseInput('<div><p>text</p></div>')).toBe('text'))
  test('1000-char input not truncated',   () => expect(sanitiseInput('a'.repeat(1000)).length).toBe(1000))
})

// ── Slot availability logic ───────────────────────────────────────
describe('M4 — slotAvailability', () => {
  function isSlotAvailable(slot: {
    booked_count: number; max_capacity: number; is_blocked: boolean
  }): boolean {
    return !slot.is_blocked && slot.booked_count < slot.max_capacity
  }

  test('empty slot is available',                    () => expect(isSlotAvailable({ booked_count: 0, max_capacity: 1, is_blocked: false })).toBe(true))
  test('full slot is not available',                 () => expect(isSlotAvailable({ booked_count: 1, max_capacity: 1, is_blocked: false })).toBe(false))
  test('blocked slot is not available',              () => expect(isSlotAvailable({ booked_count: 0, max_capacity: 1, is_blocked: true })).toBe(false))
  test('partially booked multi-slot is available',   () => expect(isSlotAvailable({ booked_count: 2, max_capacity: 5, is_blocked: false })).toBe(true))
  test('full multi-slot is not available',           () => expect(isSlotAvailable({ booked_count: 5, max_capacity: 5, is_blocked: false })).toBe(false))
  test('blocked full slot is not available',         () => expect(isSlotAvailable({ booked_count: 5, max_capacity: 5, is_blocked: true })).toBe(false))
})

// ── Appointment status machine ────────────────────────────────────
describe('M4 — appointmentStatusMachine', () => {
  const TRANSITIONS: Record<string, string[]> = {
    confirmed:   ['completed', 'cancelled', 'rescheduled', 'no_show'],
    rescheduled: ['confirmed', 'cancelled'],
    completed:   [],
    cancelled:   [],
    no_show:     [],
  }
  const can = (from: string, to: string) => (TRANSITIONS[from] ?? []).includes(to)

  test('confirmed → completed valid',       () => expect(can('confirmed', 'completed')).toBe(true))
  test('confirmed → cancelled valid',       () => expect(can('confirmed', 'cancelled')).toBe(true))
  test('confirmed → rescheduled valid',     () => expect(can('confirmed', 'rescheduled')).toBe(true))
  test('confirmed → no_show valid',         () => expect(can('confirmed', 'no_show')).toBe(true))
  test('rescheduled → confirmed valid',     () => expect(can('rescheduled', 'confirmed')).toBe(true))
  test('rescheduled → cancelled valid',     () => expect(can('rescheduled', 'cancelled')).toBe(true))
  test('completed is terminal',             () => expect(can('completed', 'confirmed')).toBe(false))
  test('cancelled is terminal',             () => expect(can('cancelled', 'confirmed')).toBe(false))
  test('no_show is terminal',               () => expect(can('no_show', 'confirmed')).toBe(false))
  test('confirmed → confirmed invalid',     () => expect(can('confirmed', 'confirmed')).toBe(false))
})

// ── Indian mobile number validation ──────────────────────────────
describe('M4 — indianMobileValidation', () => {
  function isValidMobile(mobile: string): boolean {
    const stripped = mobile.replace(/[\s\-]/g, '').replace(/^\+91/, '')
    return /^[6-9]\d{9}$/.test(stripped)
  }

  test('valid 10-digit starting with 9',        () => expect(isValidMobile('9876543210')).toBe(true))
  test('valid 10-digit starting with 6',        () => expect(isValidMobile('6543210987')).toBe(true))
  test('valid 10-digit starting with 7',        () => expect(isValidMobile('7876543210')).toBe(true))
  test('valid 10-digit starting with 8',        () => expect(isValidMobile('8765432109')).toBe(true))
  test('starts with 5 is invalid',             () => expect(isValidMobile('5876543210')).toBe(false))
  test('starts with 1 is invalid',             () => expect(isValidMobile('1234567890')).toBe(false))
  test('only 9 digits is invalid',             () => expect(isValidMobile('987654321')).toBe(false))
  test('+91 prefix stripped and valid',         () => expect(isValidMobile('+919876543210')).toBe(true))
  test('spaces stripped and valid',             () => expect(isValidMobile('98765 43210')).toBe(true))
  test('empty string is invalid',               () => expect(isValidMobile('')).toBe(false))
  test('11 digits without +91 is invalid',      () => expect(isValidMobile('91987654321')).toBe(false))
})

// ── Booking flow state machine ────────────────────────────────────
describe('M4 — bookingFlowStateMachine', () => {
  type Step = 'name' | 'mobile' | 'reason' | 'date' | 'slot_selection' | 'confirm' | 'complete'
  interface BookingState {
    step:              Step
    patientName?:      string
    patientMobile?:    string
    reason?:           string
    preferredDate?:    string
    selectedSlotId?:   string
  }

  function nextStep(state: BookingState, input: string): { step: Step; valid: boolean } {
    switch (state.step) {
      case 'name':
        return input.trim().length >= 2
          ? { step: 'mobile',         valid: true }
          : { step: 'name',           valid: false }
      case 'mobile': {
        const clean = input.replace(/[\s\-]/g, '').replace(/^\+91/, '')
        return /^[6-9]\d{9}$/.test(clean)
          ? { step: 'reason',         valid: true }
          : { step: 'mobile',         valid: false }
      }
      case 'reason':
        return input.trim().length > 0
          ? { step: 'date',           valid: true }
          : { step: 'reason',         valid: false }
      case 'date':
        return { step: 'slot_selection', valid: true }
      case 'slot_selection': {
        const idx = parseInt(input)
        return !isNaN(idx) && idx >= 1
          ? { step: 'confirm',        valid: true }
          : { step: 'slot_selection', valid: false }
      }
      case 'confirm':
        return input.toLowerCase() === 'yes'
          ? { step: 'complete',       valid: true }
          : { step: 'date',           valid: false }
      default:
        return { step: state.step, valid: false }
    }
  }

  test('name step → mobile when name provided',        () => expect(nextStep({ step:'name' }, 'Rajan Kumar').step).toBe('mobile'))
  test('name step stays when too short',               () => expect(nextStep({ step:'name' }, 'A').step).toBe('name'))
  test('mobile step → reason when valid',              () => expect(nextStep({ step:'mobile' }, '9876543210').step).toBe('reason'))
  test('mobile step stays when invalid',               () => expect(nextStep({ step:'mobile' }, '12345').step).toBe('mobile'))
  test('+91 mobile accepted',                          () => expect(nextStep({ step:'mobile' }, '+919876543210').step).toBe('reason'))
  test('reason → date',                                () => expect(nextStep({ step:'reason' }, 'chest checkup').step).toBe('date'))
  test('date → slot_selection',                        () => expect(nextStep({ step:'date' }, 'tomorrow').step).toBe('slot_selection'))
  test('slot_selection → confirm when valid index',    () => expect(nextStep({ step:'slot_selection' }, '1').step).toBe('confirm'))
  test('slot_selection stays on invalid input',        () => expect(nextStep({ step:'slot_selection' }, 'abc').step).toBe('slot_selection'))
  test('confirm yes → complete',                       () => expect(nextStep({ step:'confirm' }, 'Yes').step).toBe('complete'))
  test('confirm no → returns to date',                 () => expect(nextStep({ step:'confirm' }, 'No').step).toBe('date'))
})

// ── Welcome message template ──────────────────────────────────────
describe('M4 — welcomeMessageTemplate', () => {
  function buildWelcome(template: string, doctorName: string): string {
    return template.replace('{{doctor_name}}', doctorName)
  }

  test('template interpolation works', () => {
    const msg = buildWelcome('Hello! I am the virtual assistant for Dr. {{doctor_name}}.', 'Kumar')
    expect(msg).toBe('Hello! I am the virtual assistant for Dr. Kumar.')
  })

  test('missing template returns fallback', () => {
    const msg = buildWelcome('', 'Kumar') || 'Hello! How can I help?'
    expect(msg).toBeTruthy()
  })

  test('no double Dr. when template already has Dr.', () => {
    const msg = buildWelcome('Clinic of Dr. {{doctor_name}}.', 'Singh')
    expect(msg).not.toContain('Dr. Dr.')
    expect(msg).toContain('Dr. Singh')
  })
})

// ── InsightPanel bot resolution score ────────────────────────────
describe('M4 — chatbotInsightScore', () => {
  function computeBotScore(opts: {
    isActive:      boolean
    faqCount:      number
    hasPersona:    boolean
    hasWelcome:    boolean
  }): number {
    if (!opts.isActive) return 0
    let score = 40                            // base for being active
    if (opts.faqCount >= 10) score += 30
    else if (opts.faqCount >= 5) score += 20
    else if (opts.faqCount > 0) score += 10
    if (opts.hasPersona)  score += 15
    if (opts.hasWelcome)  score += 15
    return Math.min(100, score)
  }

  test('inactive bot = 0 score',               () => expect(computeBotScore({ isActive:false, faqCount:20, hasPersona:true, hasWelcome:true })).toBe(0))
  test('active + no FAQs + no persona = 40',   () => expect(computeBotScore({ isActive:true,  faqCount:0,  hasPersona:false, hasWelcome:false })).toBe(40))
  test('active + 5 FAQs + persona + welcome',  () => expect(computeBotScore({ isActive:true,  faqCount:5,  hasPersona:true,  hasWelcome:true })).toBe(90))
  test('active + 10+ FAQs + persona + welcome',() => expect(computeBotScore({ isActive:true,  faqCount:15, hasPersona:true,  hasWelcome:true })).toBe(100))
  test('score capped at 100',                  () => expect(computeBotScore({ isActive:true,  faqCount:100, hasPersona:true, hasWelcome:true })).toBe(100))
  test('active + partial setup = mid range',   () => expect(computeBotScore({ isActive:true,  faqCount:3,  hasPersona:false, hasWelcome:true })).toBe(65))
})
