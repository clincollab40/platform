/**
 * ClinCollab — Transcription Agent
 *
 * Pipeline:
 * 1. Receive audio blob (max 25 MB, WAV/MP3/M4A/WEBM)
 * 2. Send to Groq Whisper for transcription (no audio stored)
 * 3. Apply speaker diarisation heuristics (doctor vs patient)
 * 4. Send transcript + template to Groq LLaMA for structured extraction
 * 5. Apply AI safety flags (medication alerts, missing critical fields)
 * 6. Generate patient-facing plain-English summary
 * 7. Generate referrer-facing clinical summary
 * 8. Return structured note for specialist review
 *
 * Architecture:
 * - Fully isolated service — no imports from other module action files
 * - All external calls wrapped in circuit breakers and timeouts
 * - Audio bytes never stored — processed in memory only
 * - Failed processing always returns a partial result, never crashes caller
 */

import Groq from 'groq-sdk'
import { createClient } from '@supabase/supabase-js'
import { callExternalService, moduleBoundary, log, withTimeout } from '../../packages/shared-utils/resilience'
import { dispatch as notify } from '../../packages/notification-bus'
import type { Result } from '../../packages/types'
import { ok, err } from '../../packages/types'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// ── Types ──────────────────────────────────────────────────────
export interface NoteSection {
  id:       string
  type:     string
  label:    string
  content:  string
  ai_confidence: number   // 0–1 per section
  include_in_patient_summary: boolean
  extraction_prompt?: string
}

export interface AIFlag {
  type:    'medication_alert' | 'dosage_check' | 'allergy_conflict' |
           'missing_critical_field' | 'unclear_instruction' | 'safety_concern'
  section: string
  message: string
  severity:'warning' | 'critical'
}

export interface TranscriptionResult {
  raw_transcript:   string
  speaker_segments: SpeakerSegment[]
  sections:         Record<string, string>  // section_id → content
  ai_flags:         AIFlag[]
  patient_summary:  string
  referrer_summary: string
  icd10_codes:      string[]
  ai_confidence:    number
  duration_secs:    number
}

export interface SpeakerSegment {
  speaker:  'doctor' | 'patient' | 'unknown'
  start:    number
  end:      number
  text:     string
}

export interface ProcessAudioInput {
  sessionId:      string
  specialistId:   string
  audioBuffer:    Buffer
  audioMimeType:  string   // 'audio/webm', 'audio/mp4', 'audio/wav', 'audio/mp3'
  language:       string   // 'en', 'hi', 'te'
  templateId:     string | null
  patientName:    string
  specialistName: string
  clinicName:     string
  consultationDate: string
}

// ── Step 1: Transcribe with Groq Whisper ──────────────────────
async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType:    string,
  language:    string
): Promise<Result<{ text: string; duration: number }>> {
  return callExternalService('groq_whisper', async () => {
    // Groq Whisper expects a File-like object
    const audioFile = new File(
      [audioBuffer],
      `consultation.${mimeType.split('/')[1] || 'webm'}`,
      { type: mimeType }
    )

    const transcription = await groq.audio.transcriptions.create({
      file:              audioFile,
      model:             'whisper-large-v3',
      language:          language === 'en' ? 'en' : language === 'hi' ? 'hi' : 'te',
      response_format:   'verbose_json',
      temperature:       0,
    })

    const text     = transcription.text || ''
    const duration = (transcription as any).duration || Math.round(audioBuffer.length / 16000)

    return { text, duration }
  }, 90_000) // 90 second timeout for long consultations
}

// ── Step 2: Speaker diarisation heuristics ────────────────────
// Groq Whisper doesn't support diarisation natively — we use
// linguistic patterns to distinguish doctor speech from patient speech
function applySpeakerHeuristics(transcript: string): SpeakerSegment[] {
  const segments: SpeakerSegment[] = []

  // Split on natural pause boundaries (sentence ends, ellipses)
  const lines = transcript
    .replace(/\.\s+/g, '.\n')
    .replace(/\?\s+/g, '?\n')
    .replace(/\.\.\.\s*/g, '...\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 3)

  const DOCTOR_PATTERNS = [
    /\b(i will|i would|i recommend|i am going to|let me|we should|we need to|you need to|you should|please|take this|continue|stop|hold|i see|looking at|examination shows|investigation|the ecg|the echo|the scan|diagnosis|assessment|plan|follow up|come back|review|refer|prescribe|dose|twice daily|once daily|morning|night|with food|fasting)\b/i,
    /\b(blood pressure|heart rate|oxygen|saturation|pulse|examination|murmur|breath sounds|reflexes|power|sensation|fundus|pupils)\b/i,
  ]

  const PATIENT_PATTERNS = [
    /\b(i have|i feel|i am|my|since|it started|the pain|it hurts|i can't|i cannot|i don't|i didn't|doctor|sir|madam|what about|how long|will i|am i|is it|yes doctor|no doctor|okay doctor|thank you)\b/i,
  ]

  let charPos = 0
  for (const line of lines) {
    let speaker: 'doctor' | 'patient' | 'unknown' = 'unknown'

    const doctorScore  = DOCTOR_PATTERNS.filter(p => p.test(line)).length
    const patientScore = PATIENT_PATTERNS.filter(p => p.test(line)).length

    if (doctorScore > patientScore) speaker = 'doctor'
    else if (patientScore > doctorScore) speaker = 'patient'
    else if (line.length > 80) speaker = 'doctor'  // Long speech = likely doctor

    const start = charPos
    const end   = charPos + line.length

    // Merge with previous segment if same speaker
    if (segments.length > 0 && segments[segments.length - 1].speaker === speaker) {
      segments[segments.length - 1].text += ' ' + line
      segments[segments.length - 1].end   = end
    } else {
      segments.push({ speaker, start, end, text: line })
    }

    charPos = end + 1
  }

  return segments
}

// ── Step 3: Extract structured sections via LLM ───────────────
async function extractStructuredSections(
  transcript:     string,
  sections:       any[],  // template sections
  specialistName: string,
  patientName:    string,
  specialty:      string
): Promise<Result<{ sections: Record<string, string>; flags: AIFlag[]; icd10: string[] }>> {
  return callExternalService('groq_extraction', async () => {
    // Build extraction instructions per section
    const sectionInstructions = sections
      .filter(s => s.type !== 'patient_instructions')  // separate step
      .map(s => `
SECTION: ${s.label} (id: ${s.id})
Extract: ${s.extraction_prompt}
${s.ai_hint ? `Hint: ${s.ai_hint}` : ''}
Format: Structured prose, clinical language. If not mentioned in transcript, write "Not documented in this consultation."`)
      .join('\n')

    const prompt = `You are a clinical documentation assistant. Extract structured consultation notes from the transcript below.

Specialist: Dr. ${specialistName} (${specialty.replace(/_/g, ' ')})
Patient: ${patientName}

TRANSCRIPT:
${transcript.slice(0, 8000)}  

${sectionInstructions}

Also provide:
1. ICD-10 CODES: List up to 5 ICD-10 codes appropriate for this consultation
2. SAFETY FLAGS: List any concerns — medication interactions, unclear dosing, missing critical information, safety instructions not given.

Return ONLY valid JSON:
{
  "sections": {
    "<section_id>": "<extracted content>"
  },
  "icd10_codes": ["<code>", ...],
  "safety_flags": [
    {
      "type": "medication_alert|missing_critical_field|unclear_instruction|safety_concern",
      "section": "<section_id>",
      "message": "<description>",
      "severity": "warning|critical"
    }
  ]
}`

    const completion = await groq.chat.completions.create({
      model:           'llama-3.3-70b-versatile',
      temperature:     0.1,
      max_tokens:      3000,
      response_format: { type: 'json_object' },
      messages: [{
        role:    'system',
        content: 'You are a clinical documentation assistant. Return only valid JSON. Never fabricate clinical details not in the transcript.',
      }, {
        role:    'user',
        content: prompt,
      }],
    })

    const raw = completion.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(raw)

    const flags: AIFlag[] = (parsed.safety_flags || []).map((f: any) => ({
      type:     f.type || 'safety_concern',
      section:  f.section || 'general',
      message:  f.message,
      severity: f.severity || 'warning',
    }))

    return {
      sections: parsed.sections || {},
      flags,
      icd10:    parsed.icd10_codes || [],
    }
  }, 45_000)
}

// ── Step 4: Generate patient-facing summary ───────────────────
async function generatePatientSummary(
  sections:        Record<string, string>,
  templateSections:any[],
  specialistName:  string,
  patientName:     string,
  clinicName:      string,
  consultationDate:string,
  preamble:        string,
  closing:         string
): Promise<Result<string>> {
  return callExternalService('groq_patient_summary', async () => {
    // Only include sections marked for patient summary
    const patientSections = templateSections
      .filter(s => s.include_in_patient_summary && sections[s.id])
      .map(s => `${s.label}:\n${sections[s.id]}`)
      .join('\n\n')

    if (!patientSections) return ''

    const formattedPreamble = preamble
      .replace('[PATIENT_NAME]', patientName)
      .replace('[SPECIALIST_NAME]', specialistName)
      .replace('[DATE]', consultationDate)

    const formattedClosing = closing
      .replace('[SPECIALIST_NAME]', specialistName)
      .replace('[CLINIC_NAME]', clinicName)

    const prompt = `Convert these consultation notes into a clear, plain-English patient summary suitable for WhatsApp delivery. 

Use simple language a patient with no medical background can understand. Be warm but professional. Use short paragraphs. Avoid medical jargon — explain any necessary medical terms in brackets. Maximum 400 words.

CONSULTATION NOTES:
${patientSections}

FORMAT:
${formattedPreamble}

[Your plain-English summary here — use bullet points for instructions, medications, and follow-up items]

${formattedClosing}`

    const completion = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens:  600,
      messages: [{
        role:    'system',
        content: 'You are a patient communication specialist. Write in simple, clear English. Never include raw transcription text. Never invent information.',
      }, {
        role: 'user',
        content: prompt,
      }],
    })

    return completion.choices[0]?.message?.content?.trim() || ''
  }, 30_000)
}

// ── Step 5: Generate referrer summary ─────────────────────────
async function generateReferrerSummary(
  sections:       Record<string, string>,
  specialistName: string,
  patientName:    string,
  referenceNo:    string | null
): Promise<Result<string>> {
  return callExternalService('groq_referrer_summary', async () => {
    const clinicalContent = Object.values(sections)
      .filter(v => v && v !== 'Not documented in this consultation.')
      .join('\n\n')
      .slice(0, 3000)

    if (!clinicalContent) return ''

    const prompt = `Write a concise clinical communication to a referring doctor summarising this consultation.

Format:
- 2–3 sentences: what was found, what was decided
- Medications started, changed, or stopped
- Next steps and follow-up plan
- When to re-refer or escalate

Clinical language, professional tone. Maximum 200 words.
${referenceNo ? `Reference: ${referenceNo}` : ''}

CONSULTATION SUMMARY:
${clinicalContent}`

    const completion = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      temperature: 0.2,
      max_tokens:  300,
      messages: [
        { role: 'system', content: 'You are a clinical documentation specialist. Write concise, accurate clinical communication.' },
        { role: 'user', content: prompt },
      ],
    })

    const summary = completion.choices[0]?.message?.content?.trim() || ''
    const header  = `Clinical consultation summary — ${patientName}\nConsulted by: Dr. ${specialistName}\n\n`
    return header + summary
  }, 20_000)
}

// ── Compute overall confidence ─────────────────────────────────
function computeConfidence(
  sections:    Record<string, string>,
  required:    string[],
  flags:       AIFlag[]
): number {
  const requiredFilled = required.filter(r =>
    sections[r] && sections[r] !== 'Not documented in this consultation.'
  ).length

  const fillRate      = required.length > 0 ? requiredFilled / required.length : 1
  const criticalFlags = flags.filter(f => f.severity === 'critical').length
  const penalty       = Math.min(0.4, criticalFlags * 0.1)

  return Math.max(0.1, Math.round((fillRate - penalty) * 100) / 100)
}

// ── Main pipeline entry point ──────────────────────────────────
export async function processConsultationAudio(
  input: ProcessAudioInput
): Promise<Result<TranscriptionResult>> {
  return moduleBoundary('M7:transcription_pipeline', async () => {
    const sc = svc()

    log('info', 'M7', 'pipeline_started', {
      sessionId: input.sessionId,
      mimeType:  input.audioMimeType,
      bufferSize:input.audioBuffer.length,
    })

    // Update session status: processing
    await sc.from('transcription_sessions')
      .update({ status: 'processing', processing_started_at: new Date().toISOString() })
      .eq('id', input.sessionId)

    // Fetch template
    let templateSections: any[] = []
    let preamble = 'Dear [PATIENT_NAME],\n\nThank you for your consultation today.'
    let closing  = 'Please contact us if you have any questions.\n\nDr. [SPECIALIST_NAME]'

    if (input.templateId) {
      const { data: template } = await sc
        .from('note_templates')
        .select('sections, patient_summary_preamble, patient_summary_closing')
        .eq('id', input.templateId)
        .single()

      if (template) {
        templateSections = template.sections as any[]
        preamble = template.patient_summary_preamble || preamble
        closing  = template.patient_summary_closing  || closing
      }
    }

    // Step 1: Transcribe
    log('info', 'M7', 'transcription_start', { sessionId: input.sessionId })
    const transcriptionResult = await transcribeAudio(
      input.audioBuffer, input.audioMimeType, input.language
    )

    if (!transcriptionResult.ok) {
      await sc.from('transcription_sessions')
        .update({ status: 'failed', error_message: transcriptionResult.error })
        .eq('id', input.sessionId)
      throw new Error(`Transcription failed: ${transcriptionResult.error}`)
    }

    const { text: rawTranscript, duration } = transcriptionResult.value

    if (!rawTranscript || rawTranscript.trim().length < 20) {
      await sc.from('transcription_sessions')
        .update({ status: 'failed', error_message: 'Audio too short or unclear — no usable transcript' })
        .eq('id', input.sessionId)
      throw new Error('Transcript too short')
    }

    // Step 2: Speaker diarisation
    const segments = applySpeakerHeuristics(rawTranscript)

    // Save raw transcript
    await sc.from('transcription_sessions')
      .update({
        raw_transcript:   rawTranscript,
        speaker_segments: segments,
        audio_duration_secs: duration,
        status: 'extracting',
      })
      .eq('id', input.sessionId)

    // Fetch specialist specialty for extraction
    const { data: specialist } = await sc
      .from('specialists')
      .select('specialty')
      .eq('id', input.specialistId)
      .single()

    // Step 3: Extract structured sections
    log('info', 'M7', 'extraction_start', { sessionId: input.sessionId })
    const extractionResult = await extractStructuredSections(
      rawTranscript,
      templateSections,
      input.specialistName,
      input.patientName,
      specialist?.specialty || 'general'
    )

    let sections: Record<string, string> = {}
    let aiFlags:  AIFlag[]  = []
    let icd10:    string[]  = []

    if (extractionResult.ok) {
      sections = extractionResult.value.sections
      aiFlags  = extractionResult.value.flags
      icd10    = extractionResult.value.icd10
    } else {
      // Fallback: use raw transcript as single section
      log('warn', 'M7', 'extraction_failed_using_fallback', { error: extractionResult.error })
      sections = { raw: rawTranscript }
      aiFlags  = [{ type: 'safety_concern', section: 'raw', message: 'Structured extraction failed — raw transcript provided. Manual review required.', severity: 'critical' }]
    }

    // Step 4: Patient summary
    const patientSummaryResult = await generatePatientSummary(
      sections, templateSections, input.specialistName,
      input.patientName, input.clinicName,
      input.consultationDate, preamble, closing
    )
    const patientSummary = patientSummaryResult.ok ? patientSummaryResult.value : ''

    // Step 5: Referrer summary
    const referrerResult = await generateReferrerSummary(
      sections, input.specialistName, input.patientName, null
    )
    const referrerSummary = referrerResult.ok ? referrerResult.value : ''

    // Compute confidence
    const requiredSections = templateSections
      .filter(s => s.required)
      .map(s => s.id)
    const confidence = computeConfidence(sections, requiredSections, aiFlags)

    // Save structured note
    await sc.from('consultation_notes').upsert({
      session_id:       input.sessionId,
      specialist_id:    input.specialistId,
      template_id:      input.templateId || null,
      sections,
      ai_model:         'llama-3.3-70b-versatile',
      ai_confidence:    confidence,
      ai_flags:         aiFlags,
      patient_summary:  patientSummary,
      referrer_summary: referrerSummary,
      icd10_codes:      icd10,
    }, { onConflict: 'session_id' })

    // Update session: pending_review
    await sc.from('transcription_sessions')
      .update({
        status:               'pending_review',
        processing_ended_at:  new Date().toISOString(),
      })
      .eq('id', input.sessionId)

    log('info', 'M7', 'pipeline_completed', {
      sessionId: input.sessionId,
      confidence,
      sectionsCount: Object.keys(sections).length,
      flagCount: aiFlags.length,
      durationSecs: duration,
    })

    return {
      raw_transcript:   rawTranscript,
      speaker_segments: segments,
      sections,
      ai_flags:         aiFlags,
      patient_summary:  patientSummary,
      referrer_summary: referrerSummary,
      icd10_codes:      icd10,
      ai_confidence:    confidence,
      duration_secs:    duration,
    }
  })
}
