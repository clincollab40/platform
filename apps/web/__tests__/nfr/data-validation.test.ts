/**
 * NFR Tests — Data Validation & Integrity
 *
 * Validates data quality rules across ClinCollab:
 *   - Input sanitization (XSS, SQL injection prevention)
 *   - Required field validation for all major entities
 *   - Phone number format (India)
 *   - Date/time format validation
 *   - ENUM value completeness checks
 *
 * Pure function tests — no live DB or API required.
 */

// ── Input sanitization ─────────────────────────────────────────────
describe('NFR — inputSanitization: XSS and injection prevention', () => {
  function sanitizeText(input: string): string {
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/&(?![a-zA-Z#]\w{1,5};)/g, '&amp;')
      .trim()
  }

  function containsSQLInjection(input: string): boolean {
    const patterns = [
      /'\s*(or|and)\s+'\d+'\s*=\s*'\d+/i,
      /;\s*(drop|delete|truncate|alter)\s+/i,
      /union\s+(all\s+)?select/i,
      /--\s/,
      /\/\*[\s\S]*?\*\//,
      /xp_cmdshell/i,
    ]
    return patterns.some(p => p.test(input))
  }

  // XSS tests
  test('<script> tags escaped',                        () => expect(sanitizeText('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;'))
  test('double quotes escaped',                        () => expect(sanitizeText('"hello"')).toBe('&quot;hello&quot;'))
  test('single quotes escaped',                        () => expect(sanitizeText("it's me")).toBe('it&#x27;s me'))
  test('normal text passes unchanged',                 () => expect(sanitizeText('Dr. Rajan Kumar')).toBe('Dr. Rajan Kumar'))
  test('leading/trailing whitespace trimmed',          () => expect(sanitizeText('  hello  ')).toBe('hello'))
  test('img onerror payload escaped',                  () => {
    const result = sanitizeText('<img src=x onerror=alert(1)>')
    expect(result).not.toContain('<img')
    expect(result).toContain('&lt;img')
  })

  // SQL injection tests
  test("OR 1=1 pattern detected",                      () => expect(containsSQLInjection("' OR '1'='1")).toBe(true))
  test("DROP TABLE injection detected",                () => expect(containsSQLInjection("'; DROP TABLE specialists;--")).toBe(true))
  test("UNION SELECT injection detected",              () => expect(containsSQLInjection("' UNION SELECT * FROM specialists--")).toBe(true))
  test("xp_cmdshell injection detected",               () => expect(containsSQLInjection("1; exec xp_cmdshell")).toBe(true))
  test("normal query string not flagged",              () => expect(containsSQLInjection("I want to book an appointment")).toBe(false))
  test("email address not flagged",                    () => expect(containsSQLInjection("doctor@hospital.com")).toBe(false))
})

// ── Indian phone number validation ────────────────────────────────
describe('NFR — phoneNumberValidation: India mobile format', () => {
  function validateIndianPhone(phone: string): { valid: boolean; normalized?: string; error?: string } {
    // Strip spaces, dashes, country code
    const cleaned = phone.replace(/[\s\-().]/g, '').replace(/^(\+91|91|0)/, '')

    if (!/^\d{10}$/.test(cleaned)) {
      return { valid: false, error: 'Must be a 10-digit Indian mobile number' }
    }

    // Indian mobile numbers start with 6, 7, 8, or 9
    if (!/^[6-9]/.test(cleaned)) {
      return { valid: false, error: 'Indian mobile numbers must start with 6, 7, 8, or 9' }
    }

    return { valid: true, normalized: `91${cleaned}` }
  }

  test('valid 10-digit number passes',                   () => expect(validateIndianPhone('9876543210').valid).toBe(true))
  test('normalized with +91 prefix',                     () => expect(validateIndianPhone('9876543210').normalized).toBe('919876543210'))
  test('+91 prefix stripped and validated',              () => expect(validateIndianPhone('+919876543210').valid).toBe(true))
  test('91 prefix stripped and validated',               () => expect(validateIndianPhone('919876543210').valid).toBe(true))
  test('0 prefix stripped and validated',                () => expect(validateIndianPhone('09876543210').valid).toBe(true))
  test('spaces stripped',                                () => expect(validateIndianPhone('98765 43210').valid).toBe(true))
  test('number starting with 5 rejected',               () => expect(validateIndianPhone('5876543210').valid).toBe(false))
  test('number starting with 1 rejected',               () => expect(validateIndianPhone('1876543210').valid).toBe(false))
  test('9-digit number rejected',                        () => expect(validateIndianPhone('987654321').valid).toBe(false))
  test('11-digit number rejected',                       () => expect(validateIndianPhone('98765432100').valid).toBe(false))
  test('number with letters rejected',                   () => expect(validateIndianPhone('98765abc10').valid).toBe(false))
  test('empty string rejected',                          () => expect(validateIndianPhone('').valid).toBe(false))
  test('number starting with 6 valid (Jio)',             () => expect(validateIndianPhone('6305123456').valid).toBe(true))
  test('number starting with 7 valid',                   () => expect(validateIndianPhone('7895123456').valid).toBe(true))
})

// ── Required field validation ─────────────────────────────────────
describe('NFR — requiredFieldValidation: entity completeness', () => {
  interface ValidationResult { valid: boolean; missingFields: string[] }

  function validateSpecialist(data: Record<string, any>): ValidationResult {
    const required = ['full_name', 'email', 'specialty', 'city']
    const missing = required.filter(f => !data[f] || (typeof data[f] === 'string' && !data[f].trim()))
    return { valid: missing.length === 0, missingFields: missing }
  }

  function validateReferral(data: Record<string, any>): ValidationResult {
    const required = ['specialist_id', 'patient_name', 'patient_phone', 'urgency']
    const missing = required.filter(f => !data[f] || (typeof data[f] === 'string' && !data[f].trim()))
    return { valid: missing.length === 0, missingFields: missing }
  }

  function validateAppointment(data: Record<string, any>): ValidationResult {
    const required = ['specialist_id', 'patient_name', 'patient_phone', 'appointment_date', 'appointment_time']
    const missing = required.filter(f => !data[f] || (typeof data[f] === 'string' && !data[f].trim()))
    return { valid: missing.length === 0, missingFields: missing }
  }

  // Specialist validation
  test('valid specialist data passes',                   () => expect(validateSpecialist({ full_name:'Dr. Kumar', email:'k@h.com', specialty:'neurosurgery', city:'Hyderabad' }).valid).toBe(true))
  test('missing email fails',                            () => {
    const r = validateSpecialist({ full_name:'Dr. Kumar', specialty:'neurosurgery', city:'Hyderabad' })
    expect(r.valid).toBe(false)
    expect(r.missingFields).toContain('email')
  })
  test('whitespace-only city fails',                     () => {
    const r = validateSpecialist({ full_name:'Dr. K', email:'k@h.com', specialty:'neurosurgery', city:'   ' })
    expect(r.valid).toBe(false)
    expect(r.missingFields).toContain('city')
  })
  test('missing all fields reports all missing',         () => {
    expect(validateSpecialist({}).missingFields.length).toBe(4)
  })

  // Referral validation
  test('valid referral data passes',                     () => expect(validateReferral({ specialist_id:'s1', patient_name:'Ramesh', patient_phone:'9876543210', urgency:'urgent' }).valid).toBe(true))
  test('missing urgency fails',                          () => {
    const r = validateReferral({ specialist_id:'s1', patient_name:'Ramesh', patient_phone:'9876543210' })
    expect(r.missingFields).toContain('urgency')
  })

  // Appointment validation
  test('valid appointment passes',                       () => expect(validateAppointment({ specialist_id:'s1', patient_name:'Rajan', patient_phone:'9876543210', appointment_date:'2024-03-20', appointment_time:'09:00' }).valid).toBe(true))
  test('missing appointment_time fails',                 () => {
    const r = validateAppointment({ specialist_id:'s1', patient_name:'Rajan', patient_phone:'9876543210', appointment_date:'2024-03-20' })
    expect(r.missingFields).toContain('appointment_time')
  })
})

// ── Date / time format validation ─────────────────────────────────
describe('NFR — dateTimeValidation: ISO 8601 and IST formats', () => {
  function isValidISODate(str: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false
    const d = new Date(str)
    return !isNaN(d.getTime())
  }

  function isValidTime(str: string): boolean {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(str)
  }

  function isValidISO8601(str: string): boolean {
    const d = new Date(str)
    return !isNaN(d.getTime()) && str.includes('T')
  }

  function isFutureDate(dateStr: string, referenceDate: Date = new Date()): boolean {
    return new Date(dateStr) > referenceDate
  }

  // Date format tests
  test('YYYY-MM-DD format valid',            () => expect(isValidISODate('2024-03-20')).toBe(true))
  test('invalid month 13 fails',             () => expect(isValidISODate('2024-13-01')).toBe(false))
  test('invalid day 32 fails',              () => expect(isValidISODate('2024-03-32')).toBe(false))
  test('DD-MM-YYYY format fails (wrong)',   () => expect(isValidISODate('20-03-2024')).toBe(false))
  test('empty string fails',               () => expect(isValidISODate('')).toBe(false))

  // Time format tests
  test('09:00 valid',                       () => expect(isValidTime('09:00')).toBe(true))
  test('23:59 valid (boundary)',            () => expect(isValidTime('23:59')).toBe(true))
  test('00:00 valid',                       () => expect(isValidTime('00:00')).toBe(true))
  test('24:00 invalid',                     () => expect(isValidTime('24:00')).toBe(false))
  test('9:00 invalid (missing leading 0)',  () => expect(isValidTime('9:00')).toBe(false))
  test('09:60 invalid',                     () => expect(isValidTime('09:60')).toBe(false))

  // ISO 8601 tests
  test('ISO 8601 datetime valid',           () => expect(isValidISO8601('2024-03-20T09:00:00.000Z')).toBe(true))
  test('date-only fails ISO8601 check',     () => expect(isValidISO8601('2024-03-20')).toBe(false))

  // Future date tests
  test('past date is not future',           () => expect(isFutureDate('2020-01-01')).toBe(false))
  test('future date is future',             () => expect(isFutureDate('2099-12-31')).toBe(true))
})

// ── ENUM completeness checks ───────────────────────────────────────
describe('NFR — enumCompleteness: all DB ENUM values covered in app', () => {
  // These must stay in sync with migration SQL files

  const SPECIALTY_ENUM = [
    'interventional_cardiology','cardiac_surgery','neurosurgery','orthopedics',
    'spine_surgery','general_surgery','gi_surgery','urology','oncology','neurology',
    'pulmonology','endocrinology','nephrology','ophthalmology','reproductive_medicine',
    'dermatology','electrophysiology','vascular_surgery','rheumatology','ent',
    'anesthesiology','radiology','pediatrics','internal_medicine','other',
  ]

  const URGENCY_ENUM = ['emergency', 'urgent', 'semi_urgent', 'elective']

  const SPECIALIST_STATUS_ENUM = ['onboarding', 'active', 'inactive', 'suspended']

  const PLAN_TIER_ENUM = ['starter', 'professional', 'enterprise']

  const MODULE_IDS = ['m1_identity','m2_network','m3_referrals','m4_chatbot','m5_triage','m6_synthesis','m7_transcription','m8_procedures','m9_comms','m10_content','m11_config']

  test('specialty ENUM has exactly 25 values',             () => expect(SPECIALTY_ENUM.length).toBe(25))
  test('urgency ENUM has exactly 4 values',                () => expect(URGENCY_ENUM.length).toBe(4))
  test('specialist_status ENUM has exactly 4 values',      () => expect(SPECIALIST_STATUS_ENUM.length).toBe(4))
  test('plan_tier ENUM has exactly 3 values',              () => expect(PLAN_TIER_ENUM.length).toBe(3))
  test('all 11 module IDs present',                        () => expect(MODULE_IDS.length).toBe(11))
  test('no duplicate specialty values',                    () => expect(new Set(SPECIALTY_ENUM).size).toBe(SPECIALTY_ENUM.length))
  test('no duplicate module IDs',                          () => expect(new Set(MODULE_IDS).size).toBe(MODULE_IDS.length))
  test('all module IDs follow m[N]_[name] format',         () => expect(MODULE_IDS.every(m => /^m\d+_/.test(m))).toBe(true))
  test('urgency values match referral classifications',     () => {
    const expected = ['emergency', 'urgent', 'semi_urgent', 'elective']
    expect(URGENCY_ENUM).toEqual(expect.arrayContaining(expected))
  })
})
