/**
 * M7 — Consultation Transcription Agent — Unit Tests
 *
 * Self-contained: all logic inlined as pure functions.
 * FIXES:
 *   1. Status machine updated: failed → processing (retry) included
 *   2. Audio validation uses correct 25MB Groq Whisper limit (not 10MB)
 *   3. ICD-10 regex corrected: allows 1-4 decimal digits (not just 1-2)
 *   4. InsightPanel approval rate score formula added
 *   5. Consultation type validation aligned with DB ENUM
 */

// ── Status machine transitions ────────────────────────────────────
describe('M7 — transcriptionStatusMachine', () => {
  const TRANSITIONS: Record<string, string[]> = {
    recording:      ['processing', 'cancelled'],
    processing:     ['extracting', 'failed', 'cancelled'],
    extracting:     ['pending_review', 'failed'],
    pending_review: ['approved', 'cancelled'],
    approved:       ['sent_to_patient'],
    sent_to_patient:[],
    failed:         ['processing'],   // retry
    cancelled:      [],
  }
  const can = (from: string, to: string) => (TRANSITIONS[from] ?? []).includes(to)

  test('recording → processing valid',             () => expect(can('recording', 'processing')).toBe(true))
  test('recording → cancelled valid',              () => expect(can('recording', 'cancelled')).toBe(true))
  test('processing → extracting valid',            () => expect(can('processing', 'extracting')).toBe(true))
  test('processing → failed valid',                () => expect(can('processing', 'failed')).toBe(true))
  test('extracting → pending_review valid',        () => expect(can('extracting', 'pending_review')).toBe(true))
  test('pending_review → approved valid',          () => expect(can('pending_review', 'approved')).toBe(true))
  test('approved → sent_to_patient valid',         () => expect(can('approved', 'sent_to_patient')).toBe(true))
  test('failed → processing (retry) valid',        () => expect(can('failed', 'processing')).toBe(true))
  test('sent_to_patient is terminal',              () => expect(can('sent_to_patient', 'approved')).toBe(false))
  test('cancelled is terminal',                    () => expect(can('cancelled', 'pending_review')).toBe(false))
  test('approved → processing invalid (no undo)',  () => expect(can('approved', 'processing')).toBe(false))
  test('pending_review → sent_to_patient skips',   () => expect(can('pending_review', 'sent_to_patient')).toBe(false))
  test('recording → approved skip invalid',        () => expect(can('recording', 'approved')).toBe(false))
})

// ── AI flag severity aggregation ─────────────────────────────────
describe('M7 — aiFlagSeverityAggregation', () => {
  function getHighestSeverity(flags: Array<{ severity: string }>): 'none' | 'warning' | 'critical' {
    if (flags.some(f => f.severity === 'critical')) return 'critical'
    if (flags.some(f => f.severity === 'warning'))  return 'warning'
    return 'none'
  }

  test('no flags → none',                     () => expect(getHighestSeverity([])).toBe('none'))
  test('only warning → warning',              () => expect(getHighestSeverity([{ severity:'warning' }])).toBe('warning'))
  test('only critical → critical',            () => expect(getHighestSeverity([{ severity:'critical' }])).toBe('critical'))
  test('critical overrides warning',          () => expect(getHighestSeverity([{ severity:'warning' }, { severity:'critical' }])).toBe('critical'))
  test('multiple warnings → warning',         () => expect(getHighestSeverity([{ severity:'warning' }, { severity:'warning' }])).toBe('warning'))
  test('unknown severity → none',             () => expect(getHighestSeverity([{ severity:'info' }])).toBe('none'))
})

// ── Audio file validation ─────────────────────────────────────────
describe('M7 — audioFileValidation', () => {
  const MAX_SIZE_MB = 25
  const VALID_TYPES = ['audio/webm', 'audio/mp4', 'audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/m4a', 'audio/ogg']

  function validateAudio(file: { size: number; type: string }): { valid: boolean; error?: string } {
    if (file.size === 0)                         return { valid: false, error: 'Audio file is empty' }
    if (file.size > MAX_SIZE_MB * 1024 * 1024)  return { valid: false, error: `File too large: ${Math.round(file.size/1024/1024)}MB exceeds ${MAX_SIZE_MB}MB limit` }
    if (!VALID_TYPES.includes(file.type))        return { valid: false, error: `Unsupported format: ${file.type}` }
    return { valid: true }
  }

  test('valid WebM passes',              () => expect(validateAudio({ size: 5*1024*1024, type:'audio/webm' }).valid).toBe(true))
  test('valid MP4 passes',               () => expect(validateAudio({ size: 2*1024*1024, type:'audio/mp4' }).valid).toBe(true))
  test('valid WAV passes',               () => expect(validateAudio({ size:10*1024*1024, type:'audio/wav' }).valid).toBe(true))
  test('valid OGG passes',               () => expect(validateAudio({ size: 3*1024*1024, type:'audio/ogg' }).valid).toBe(true))
  test('empty file fails',               () => { const r = validateAudio({ size:0, type:'audio/webm' }); expect(r.valid).toBe(false); expect(r.error).toContain('empty') })
  test('26MB file fails',                () => { const r = validateAudio({ size:26*1024*1024, type:'audio/webm' }); expect(r.valid).toBe(false); expect(r.error).toContain('large') })
  test('exactly 25MB passes',            () => expect(validateAudio({ size:25*1024*1024, type:'audio/webm' }).valid).toBe(true))
  test('video/mp4 rejected',             () => { const r = validateAudio({ size:1024, type:'video/mp4' }); expect(r.valid).toBe(false); expect(r.error).toContain('Unsupported') })
  test('application/pdf rejected',       () => expect(validateAudio({ size:1024, type:'application/pdf' }).valid).toBe(false))
  test('7 valid MIME types defined',     () => expect(VALID_TYPES.length).toBe(7))
})

// ── ICD-10 code format validation ────────────────────────────────
describe('M7 — icd10Validation', () => {
  // Format: 1 uppercase letter + 2 digits + optional (. + 1-4 digits)
  function isValidICD10(code: string): boolean {
    return /^[A-Z]\d{2}(\.\d{1,4})?$/.test(code)
  }

  test('valid 3-char code I25',          () => expect(isValidICD10('I25')).toBe(true))
  test('valid with 1 decimal digit',     () => expect(isValidICD10('I25.1')).toBe(true))
  test('valid with 2 decimal digits',    () => expect(isValidICD10('G43.09')).toBe(true))
  test('valid orthopaedic code M54.5',   () => expect(isValidICD10('M54.5')).toBe(true))
  test('valid cardiac code I21.0',       () => expect(isValidICD10('I21.0')).toBe(true))
  test('valid neurological code G43.0',  () => expect(isValidICD10('G43.0')).toBe(true))
  test('lowercase letter invalid',       () => expect(isValidICD10('i25')).toBe(false))
  test('only 2 digits invalid',          () => expect(isValidICD10('I2')).toBe(false))
  test('plain number invalid',           () => expect(isValidICD10('125')).toBe(false))
  test('empty string invalid',           () => expect(isValidICD10('')).toBe(false))
  test('space in code invalid',          () => expect(isValidICD10('I 25')).toBe(false))
})

// ── AI confidence scoring ─────────────────────────────────────────
describe('M7 — aiConfidenceScoring', () => {
  function computeConfidence(
    sections: Record<string, string>,
    requiredIds: string[],
    flags: Array<{ severity: string }>
  ): number {
    const filled    = requiredIds.filter(id => sections[id] && sections[id] !== 'Not documented in this consultation.').length
    const fillRate  = requiredIds.length > 0 ? filled / requiredIds.length : 1
    const penalty   = Math.min(0.4, flags.filter(f => f.severity === 'critical').length * 0.1)
    return Math.max(0.1, Math.round((fillRate - penalty) * 100) / 100)
  }

  test('all sections filled, no flags = 1.0',          () => expect(computeConfidence({ h:'text', a:'text', p:'text' }, ['h','a','p'], [])).toBe(1))
  test('half sections filled = 0.5',                   () => expect(computeConfidence({ h:'text', a:'Not documented in this consultation.' }, ['h','a'], [])).toBe(0.5))
  test('critical flags reduce by 10% each',            () => expect(computeConfidence({ h:'Done', a:'Done', p:'Done' }, ['h','a','p'], [{ severity:'critical' }, { severity:'critical' }])).toBe(0.8))
  test('confidence never below 0.1',                   () => expect(computeConfidence({}, ['a','b','c','d','e'], [{ severity:'critical' },{ severity:'critical' },{ severity:'critical' },{ severity:'critical' },{ severity:'critical' }])).toBeGreaterThanOrEqual(0.1))
  test('no required sections = 1.0',                   () => expect(computeConfidence({}, [], [])).toBe(1))
  test('"Not documented" treated as unfilled',          () => expect(computeConfidence({ h:'Not documented in this consultation.' }, ['h'], [])).toBe(0.1))
  test('warning flags do not reduce confidence',        () => {
    const withWarnings  = computeConfidence({ h:'Done' }, ['h'], [{ severity:'warning' }])
    const withoutFlags  = computeConfidence({ h:'Done' }, ['h'], [])
    expect(withWarnings).toBe(withoutFlags)
  })
})

// ── Patient summary placeholder replacement ───────────────────────
describe('M7 — placeholderReplacement', () => {
  function replacePlaceholders(template: string, vars: Record<string, string>): string {
    return template.replace(/\[([A-Z_]+)\]/g, (_, key) => vars[key] ?? `[${key}]`)
  }

  test('all placeholders replaced',         () => {
    const result = replacePlaceholders(
      'Dear [PATIENT_NAME], Dr. [SPECIALIST_NAME] saw you on [DATE].',
      { PATIENT_NAME: 'Rajan Kumar', SPECIALIST_NAME: 'Kumar', DATE: '15 April 2024' }
    )
    expect(result).toBe('Dear Rajan Kumar, Dr. Kumar saw you on 15 April 2024.')
  })
  test('missing placeholder kept as-is',    () => {
    const result = replacePlaceholders('Dear [PATIENT_NAME], Dr. [UNKNOWN].', { PATIENT_NAME: 'Test' })
    expect(result).toContain('[UNKNOWN]')
    expect(result).toContain('Test')
  })
  test('no vars leaves all placeholders',   () => expect(replacePlaceholders('Dear [PATIENT_NAME].', {})).toBe('Dear [PATIENT_NAME].'))
  test('no placeholders returns unchanged', () => expect(replacePlaceholders('Hello there.', { A:'B' })).toBe('Hello there.'))
})

// ── Safety: no raw transcript markers in patient summary ──────────
describe('M7 — patientSummarySafety', () => {
  function isSafeSummary(summary: string): boolean {
    return ![
      /\[00:\d{2}:\d{2}\]/,
      /speaker \d:/i,
      /WEBVTT/,
      /transcribed by/i,
    ].some(m => m.test(summary))
  }

  test('clean clinical summary passes',     () => expect(isSafeSummary('Dear Rajan, your BP was 130/80.')).toBe(true))
  test('timestamp marker fails',             () => expect(isSafeSummary('[00:01:23] Doctor: Take aspirin')).toBe(false))
  test('speaker label fails',               () => expect(isSafeSummary('Speaker 1: You should take aspirin.')).toBe(false))
  test('WEBVTT header fails',               () => expect(isSafeSummary('WEBVTT\n\n00:00 --> 00:05')).toBe(false))
  test('multi-line clinical summary passes', () => {
    expect(isSafeSummary(`Dear Mr. Rajan Kumar,\n\nYour BP was 140/90 mmHg.\n\nDr. Kumar`)).toBe(true)
  })
})

// ── Consultation type validation ──────────────────────────────────
describe('M7 — consultationTypeValidation', () => {
  // Matches consultation_type ENUM in DB migration
  const VALID_TYPES = [
    'initial_consultation', 'follow_up', 'procedure_planning',
    'post_procedure_review', 'emergency', 'telemedicine',
  ]
  const isValid = (t: string) => VALID_TYPES.includes(t)

  test('initial_consultation valid',    () => expect(isValid('initial_consultation')).toBe(true))
  test('follow_up valid',               () => expect(isValid('follow_up')).toBe(true))
  test('procedure_planning valid',      () => expect(isValid('procedure_planning')).toBe(true))
  test('telemedicine valid',            () => expect(isValid('telemedicine')).toBe(true))
  test('"routine" not in ENUM',         () => expect(isValid('routine')).toBe(false))
  test('empty string invalid',          () => expect(isValid('')).toBe(false))
  test('all defined types valid',       () => expect(VALID_TYPES.every(isValid)).toBe(true))
})

// ── InsightPanel transcription approval score ─────────────────────
describe('M7 — transcriptionInsightScore', () => {
  // Matches transcription/page.tsx: approvalRate or avgAiConfidence * 100
  function computeTranscriptionScore(
    approvedCount: number,
    totalCount: number,
    avgConfidence: number
  ): number {
    if (totalCount === 0) return 0
    const approvalRate = Math.round((approvedCount / totalCount) * 100)
    return approvalRate > 0 ? approvalRate : Math.round(avgConfidence * 100)
  }

  test('no sessions = 0 score',              () => expect(computeTranscriptionScore(0, 0, 0)).toBe(0))
  test('100% approved = 100 score',          () => expect(computeTranscriptionScore(10, 10, 0.9)).toBe(100))
  test('50% approved = 50 score',            () => expect(computeTranscriptionScore(5, 10, 0.9)).toBe(50))
  test('0 approved falls back to confidence',() => expect(computeTranscriptionScore(0, 5, 0.8)).toBe(80))
  test('confidence 1.0 fallback = 100',      () => expect(computeTranscriptionScore(0, 5, 1.0)).toBe(100))
})
