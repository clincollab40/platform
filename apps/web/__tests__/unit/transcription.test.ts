/**
 * ClinCollab — Module 7 Unit Tests
 * Transcription Agent: speaker heuristics, flag detection,
 * section extraction logic, confidence scoring, safety boundaries,
 * status machine, delivery validation
 */

// ── Inline all testable pure functions ────────────────────────

// Speaker diarisation heuristics (from transcription-pipeline.ts)
function applySpeakerHeuristics(transcript: string) {
  const segments: { speaker: 'doctor' | 'patient' | 'unknown'; text: string }[] = []

  const DOCTOR_PATTERNS = [
    /\b(i will|i would|i recommend|i am going to|let me|we should|we need to|you need to|you should|please|take this|continue|stop|hold|i see|looking at|examination shows|investigation|the ecg|the echo|the scan|diagnosis|assessment|plan|follow up|come back|review|refer|prescribe|dose|twice daily|once daily|morning|night|with food|fasting)\b/i,
    /\b(blood pressure|heart rate|oxygen|saturation|pulse|examination|murmur|breath sounds|reflexes|power|sensation)\b/i,
  ]
  const PATIENT_PATTERNS = [
    /\b(i have|i feel|i am|my|since|it started|the pain|it hurts|i can't|i cannot|i don't|i didn't|doctor|sir|madam|what about|how long|will i|am i|is it|yes doctor|no doctor|okay doctor|thank you)\b/i,
  ]

  const lines = transcript
    .replace(/\.\s+/g, '.\n')
    .replace(/\?\s+/g, '?\n')
    .split('\n').map(l => l.trim()).filter(l => l.length > 3)

  for (const line of lines) {
    const doctorScore  = DOCTOR_PATTERNS.filter(p => p.test(line)).length
    const patientScore = PATIENT_PATTERNS.filter(p => p.test(line)).length
    let speaker: 'doctor' | 'patient' | 'unknown' = 'unknown'
    if (doctorScore > patientScore)       speaker = 'doctor'
    else if (patientScore > doctorScore)  speaker = 'patient'
    else if (line.length > 80)            speaker = 'doctor'

    if (segments.length > 0 && segments[segments.length - 1].speaker === speaker) {
      segments[segments.length - 1].text += ' ' + line
    } else {
      segments.push({ speaker, text: line })
    }
  }
  return segments
}

// Confidence scorer (from transcription-pipeline.ts)
function computeConfidence(
  sections: Record<string, string>,
  requiredIds: string[],
  flags: { severity: string }[]
): number {
  const filled   = requiredIds.filter(id =>
    sections[id] && sections[id] !== 'Not documented in this consultation.'
  ).length
  const fillRate = requiredIds.length > 0 ? filled / requiredIds.length : 1
  const penalty  = Math.min(0.4, flags.filter(f => f.severity === 'critical').length * 0.1)
  return Math.max(0.1, Math.round((fillRate - penalty) * 100) / 100)
}

// Status machine validation
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  recording:      ['processing', 'cancelled'],
  processing:     ['extracting', 'failed', 'cancelled'],
  extracting:     ['pending_review', 'failed'],
  pending_review: ['approved', 'cancelled'],
  approved:       ['sent_to_patient'],
  sent_to_patient:[],
  failed:         ['processing'],  // retry
  cancelled:      [],
}
function canTransition(from: string, to: string): boolean {
  return (VALID_STATUS_TRANSITIONS[from] || []).includes(to)
}

// Flag severity aggregation
function getHighestSeverity(flags: { severity: string }[]): 'none' | 'warning' | 'critical' {
  if (flags.some(f => f.severity === 'critical')) return 'critical'
  if (flags.some(f => f.severity === 'warning'))  return 'warning'
  return 'none'
}

// Audio validation
function validateAudio(file: { size: number; type: string; name: string }): { valid: boolean; error?: string } {
  const MAX_SIZE    = 25 * 1024 * 1024  // 25 MB (Groq Whisper limit)
  const VALID_TYPES = ['audio/webm', 'audio/mp4', 'audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/m4a', 'audio/ogg']

  if (file.size === 0)         return { valid: false, error: 'Audio file is empty' }
  if (file.size > MAX_SIZE)    return { valid: false, error: `File too large: ${Math.round(file.size / 1024 / 1024)}MB exceeds 25MB limit` }
  if (!VALID_TYPES.includes(file.type)) return { valid: false, error: `Unsupported format: ${file.type}` }
  return { valid: true }
}

// Patient summary placeholder replacement
function replacePlaceholders(template: string, vars: Record<string, string>): string {
  return template.replace(/\[([A-Z_]+)\]/g, (_, key) => vars[key] || `[${key}]`)
}

// Section ordering from template
function orderSectionsFromTemplate(
  templateSections: { id: string; sort_order: number }[],
  extractedSections: Record<string, string>
): { id: string; content: string }[] {
  return templateSections
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter(s => extractedSections[s.id] && extractedSections[s.id] !== 'Not documented in this consultation.')
    .map(s => ({ id: s.id, content: extractedSections[s.id] }))
}

// ICD-10 code format validator
function isValidICD10(code: string): boolean {
  return /^[A-Z]\d{2}(\.\d{1,4})?$/.test(code)
}

// Content hash determinism
import { createHash } from 'crypto'
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

// ════════════════════════════════════════════════════════════
// TEST SUITES
// ════════════════════════════════════════════════════════════

describe('Speaker diarisation heuristics', () => {
  test('doctor speech identified by clinical language', () => {
    const segments = applySpeakerHeuristics(
      'I recommend we continue the aspirin. Please take this twice daily.'
    )
    const doctorSegs = segments.filter(s => s.speaker === 'doctor')
    expect(doctorSegs.length).toBeGreaterThan(0)
  })

  test('patient speech identified by personal language', () => {
    const segments = applySpeakerHeuristics(
      'Doctor I have chest pain since two days. It hurts more on exertion.'
    )
    const patientSegs = segments.filter(s => s.speaker === 'patient')
    expect(patientSegs.length).toBeGreaterThan(0)
  })

  test('long utterances default to doctor', () => {
    const longLine = 'The patient presents with chest pain of two weeks duration, radiating to the left arm, associated with breathlessness and diaphoresis, with a background history of hypertension and diabetes.'
    const segments = applySpeakerHeuristics(longLine)
    expect(segments.some(s => s.speaker === 'doctor')).toBe(true)
  })

  test('consecutive same-speaker lines are merged', () => {
    const transcript = 'I recommend aspirin daily. Please continue the beta-blocker.'
    const segments = applySpeakerHeuristics(transcript)
    const doctorSegs = segments.filter(s => s.speaker === 'doctor')
    // Two consecutive doctor lines should merge to one
    expect(doctorSegs.length).toBe(1)
  })

  test('empty transcript returns empty segments', () => {
    const segments = applySpeakerHeuristics('')
    expect(segments).toHaveLength(0)
  })

  test('mixed conversation produces both speakers', () => {
    const transcript = [
      'Doctor I have pain in my chest.',
      'How long has this been happening?',
      'Since three days.',
      'I see. We need to do an ECG.',
    ].join('\n')
    const segments = applySpeakerHeuristics(transcript)
    const speakers = new Set(segments.map(s => s.speaker))
    expect(speakers.size).toBeGreaterThan(1)
  })
})

describe('AI confidence scoring', () => {
  test('all required sections filled, no flags = 100%', () => {
    const score = computeConfidence(
      { history: 'Chief complaint documented', assessment: 'Diagnosis: Stable angina', plan: 'Start aspirin' },
      ['history', 'assessment', 'plan'],
      []
    )
    expect(score).toBe(1)
  })

  test('half required sections filled = 50%', () => {
    const score = computeConfidence(
      { history: 'Chief complaint', assessment: 'Not documented in this consultation.' },
      ['history', 'assessment'],
      []
    )
    expect(score).toBe(0.5)
  })

  test('critical flags reduce confidence by 10% each', () => {
    const score = computeConfidence(
      { history: 'Done', assessment: 'Done', plan: 'Done' },
      ['history', 'assessment', 'plan'],
      [{ severity: 'critical' }, { severity: 'critical' }]
    )
    expect(score).toBe(0.8)
  })

  test('confidence never drops below 10%', () => {
    const score = computeConfidence({}, ['a', 'b', 'c', 'd', 'e'], [
      { severity: 'critical' }, { severity: 'critical' }, { severity: 'critical' },
      { severity: 'critical' }, { severity: 'critical' },
    ])
    expect(score).toBeGreaterThanOrEqual(0.1)
  })

  test('no required sections = 100% confidence', () => {
    const score = computeConfidence({}, [], [])
    expect(score).toBe(1)
  })

  test('"Not documented" values treated as unfilled', () => {
    const score = computeConfidence(
      { history: 'Not documented in this consultation.' },
      ['history'],
      []
    )
    expect(score).toBe(0.1)  // penalty applied to empty required
  })

  test('warning flags do not reduce confidence', () => {
    const withWarnings = computeConfidence(
      { history: 'Done' }, ['history'],
      [{ severity: 'warning' }, { severity: 'warning' }]
    )
    const withoutFlags = computeConfidence({ history: 'Done' }, ['history'], [])
    expect(withWarnings).toBe(withoutFlags)
  })
})

describe('Status machine transitions', () => {
  test('recording → processing valid', () => expect(canTransition('recording', 'processing')).toBe(true))
  test('recording → cancelled valid', () => expect(canTransition('recording', 'cancelled')).toBe(true))
  test('processing → extracting valid', () => expect(canTransition('processing', 'extracting')).toBe(true))
  test('processing → failed valid', () => expect(canTransition('processing', 'failed')).toBe(true))
  test('extracting → pending_review valid', () => expect(canTransition('extracting', 'pending_review')).toBe(true))
  test('pending_review → approved valid', () => expect(canTransition('pending_review', 'approved')).toBe(true))
  test('approved → sent_to_patient valid', () => expect(canTransition('approved', 'sent_to_patient')).toBe(true))
  test('failed → processing valid (retry)', () => expect(canTransition('failed', 'processing')).toBe(true))
  test('sent_to_patient is terminal', () => expect(canTransition('sent_to_patient', 'approved')).toBe(false))
  test('cancelled is terminal', () => expect(canTransition('cancelled', 'pending_review')).toBe(false))
  test('approved → processing invalid (no undo)', () => expect(canTransition('approved', 'processing')).toBe(false))
  test('pending_review → sent_to_patient skips approval', () => expect(canTransition('pending_review', 'sent_to_patient')).toBe(false))
})

describe('AI flag severity aggregation', () => {
  test('no flags → none', () => expect(getHighestSeverity([])).toBe('none'))
  test('only warnings → warning', () => expect(getHighestSeverity([{ severity: 'warning' }])).toBe('warning'))
  test('only critical → critical', () => expect(getHighestSeverity([{ severity: 'critical' }])).toBe('critical'))
  test('mixed → critical wins', () => {
    expect(getHighestSeverity([{ severity: 'warning' }, { severity: 'critical' }])).toBe('critical')
  })
  test('multiple warnings → warning (not escalated)', () => {
    expect(getHighestSeverity([{ severity: 'warning' }, { severity: 'warning' }])).toBe('warning')
  })
})

describe('Audio file validation', () => {
  test('valid WebM audio passes', () => {
    const r = validateAudio({ size: 5 * 1024 * 1024, type: 'audio/webm', name: 'consult.webm' })
    expect(r.valid).toBe(true)
  })

  test('valid MP4 audio passes', () => {
    const r = validateAudio({ size: 2 * 1024 * 1024, type: 'audio/mp4', name: 'consult.mp4' })
    expect(r.valid).toBe(true)
  })

  test('empty file fails', () => {
    const r = validateAudio({ size: 0, type: 'audio/webm', name: 'empty.webm' })
    expect(r.valid).toBe(false)
    expect(r.error).toContain('empty')
  })

  test('file over 25MB fails', () => {
    const r = validateAudio({ size: 26 * 1024 * 1024, type: 'audio/webm', name: 'big.webm' })
    expect(r.valid).toBe(false)
    expect(r.error).toContain('large')
  })

  test('exactly 25MB passes', () => {
    const r = validateAudio({ size: 25 * 1024 * 1024, type: 'audio/webm', name: 'limit.webm' })
    expect(r.valid).toBe(true)
  })

  test('unsupported format fails', () => {
    const r = validateAudio({ size: 1024, type: 'video/mp4', name: 'video.mp4' })
    expect(r.valid).toBe(false)
    expect(r.error).toContain('Unsupported')
  })

  test('WAV format passes', () => {
    const r = validateAudio({ size: 10 * 1024 * 1024, type: 'audio/wav', name: 'consult.wav' })
    expect(r.valid).toBe(true)
  })

  test('document file rejected', () => {
    const r = validateAudio({ size: 1024, type: 'application/pdf', name: 'doc.pdf' })
    expect(r.valid).toBe(false)
  })
})

describe('Placeholder replacement in summaries', () => {
  test('all placeholders replaced', () => {
    const result = replacePlaceholders(
      'Dear [PATIENT_NAME], Dr. [SPECIALIST_NAME] saw you on [DATE] at [CLINIC_NAME].',
      { PATIENT_NAME: 'Rajan Kumar', SPECIALIST_NAME: 'Kumar', DATE: '15 April 2024', CLINIC_NAME: 'Heart Care' }
    )
    expect(result).toBe('Dear Rajan Kumar, Dr. Kumar saw you on 15 April 2024 at Heart Care.')
  })

  test('missing placeholder left as-is', () => {
    const result = replacePlaceholders('Dear [PATIENT_NAME], Dr. [UNKNOWN].', { PATIENT_NAME: 'Test' })
    expect(result).toContain('[UNKNOWN]')
    expect(result).toContain('Test')
  })

  test('empty vars object leaves all placeholders', () => {
    const result = replacePlaceholders('Dear [PATIENT_NAME].', {})
    expect(result).toBe('Dear [PATIENT_NAME].')
  })

  test('no placeholders in template returns unchanged', () => {
    const result = replacePlaceholders('Hello there.', { PATIENT_NAME: 'Test' })
    expect(result).toBe('Hello there.')
  })
})

describe('Section ordering from template', () => {
  const templateSections = [
    { id: 'history', sort_order: 1 },
    { id: 'assessment', sort_order: 3 },
    { id: 'plan', sort_order: 2 },
  ]

  test('sections ordered by sort_order', () => {
    const result = orderSectionsFromTemplate(templateSections, {
      history: 'Patient presents with chest pain',
      assessment: 'Stable angina',
      plan: 'Start aspirin',
    })
    expect(result[0].id).toBe('history')
    expect(result[1].id).toBe('plan')
    expect(result[2].id).toBe('assessment')
  })

  test('sections not in extraction are excluded', () => {
    const result = orderSectionsFromTemplate(templateSections, {
      history: 'Present', // only history extracted
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('history')
  })

  test('"Not documented" sections excluded', () => {
    const result = orderSectionsFromTemplate(templateSections, {
      history: 'Not documented in this consultation.',
      assessment: 'Stable angina',
      plan: 'Start aspirin',
    })
    expect(result.find(s => s.id === 'history')).toBeUndefined()
    expect(result).toHaveLength(2)
  })

  test('empty extracted sections returns empty', () => {
    const result = orderSectionsFromTemplate(templateSections, {})
    expect(result).toHaveLength(0)
  })
})

describe('ICD-10 code validation', () => {
  test('valid 3-char code', () => expect(isValidICD10('I25')).toBe(true))
  test('valid code with decimal', () => expect(isValidICD10('I25.1')).toBe(true))
  test('valid neurological code', () => expect(isValidICD10('G43.0')).toBe(true))
  test('valid orthopaedic code', () => expect(isValidICD10('M54.5')).toBe(true))
  test('valid cardiac code', () => expect(isValidICD10('I21.0')).toBe(true))
  test('lowercase code invalid', () => expect(isValidICD10('i25')).toBe(false))
  test('too short code invalid', () => expect(isValidICD10('I2')).toBe(false))
  test('plain number invalid', () => expect(isValidICD10('125')).toBe(false))
  test('empty string invalid', () => expect(isValidICD10('')).toBe(false))
})

describe('Content hashing for delivery audit', () => {
  test('same content produces same hash', () => {
    const h1 = hashContent('Hello patient summary')
    const h2 = hashContent('Hello patient summary')
    expect(h1).toBe(h2)
  })

  test('different content produces different hash', () => {
    expect(hashContent('Summary A')).not.toBe(hashContent('Summary B'))
  })

  test('hash is 64 hex characters (SHA-256)', () => {
    const h = hashContent('test')
    expect(h).toHaveLength(64)
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true)
  })

  test('empty string has valid hash', () => {
    const h = hashContent('')
    expect(h).toHaveLength(64)
  })
})

describe('Safety: patient summary never contains raw transcript markers', () => {
  function isSafeSummary(summary: string): boolean {
    const UNSAFE_MARKERS = [
      /\[00:\d{2}:\d{2}\]/,         // timestamps
      /speaker \d:/i,               // speaker labels
      /WEBVTT/,                      // WebVTT format
      /transcribed by/i,             // transcription watermarks
    ]
    return !UNSAFE_MARKERS.some(m => m.test(summary))
  }

  test('clean summary passes', () => {
    expect(isSafeSummary('Dear Rajan, your BP was 130/80.')).toBe(true)
  })

  test('timestamp in summary is flagged', () => {
    expect(isSafeSummary('[00:01:23] Doctor: Take aspirin')).toBe(false)
  })

  test('speaker label in summary is flagged', () => {
    expect(isSafeSummary('Speaker 1: You should take aspirin.')).toBe(false)
  })

  test('WEBVTT header in summary is flagged', () => {
    expect(isSafeSummary('WEBVTT\n\n00:00:01.000 --> 00:00:05.000')).toBe(false)
  })

  test('normal clinical summary passes', () => {
    const summary = `Dear Mr. Rajan Kumar,

Thank you for your consultation with Dr. Kumar today.

Your blood pressure was 140/90 mmHg and we discussed starting amlodipine 5mg once daily.

Please return in 4 weeks for a review.

Dr. Kumar, Heart Care Clinic`
    expect(isSafeSummary(summary)).toBe(true)
  })
})
