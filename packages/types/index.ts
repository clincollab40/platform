/**
 * @clincollab/types
 * Canonical type definitions shared across all modules and services.
 * NO business logic here. Types only.
 *
 * Principle: modules import FROM this package, never from each other.
 * If M6 needs a type from M3, it imports ClinCollab.ReferralCase — not from apps/web/app/referrals/
 */

export namespace ClinCollab {

  // ── Identity (Module 1) ────────────────────────────────────────
  export interface Specialist {
    id: string
    name: string
    specialty: string
    city: string
    role: 'specialist' | 'admin'
    google_id: string
    whatsapp_number?: string | null
    created_at: string
  }

  // ── Network (Module 2) ─────────────────────────────────────────
  export interface Referrer {
    id: string
    specialist_id: string
    name: string
    specialty?: string | null
    city?: string | null
    clinic_name?: string | null
    clinic_area?: string | null
    mobile?: string | null
    whatsapp_number?: string | null
    engagement_status: 'active' | 'drifting' | 'silent' | 'new'
    last_referral_date?: string | null
    total_referrals: number
  }

  // ── Referrals (Module 3) ───────────────────────────────────────
  export type ReferralStatus =
    | 'draft' | 'submitted' | 'queried' | 'info_provided'
    | 'accepted' | 'patient_arrived' | 'procedure_planned'
    | 'completed' | 'closed' | 'declined' | 'cancelled'

  export type UrgencyLevel = 'routine' | 'urgent' | 'emergency'

  export interface ReferralCase {
    id: string
    specialist_id: string
    reference_no: string
    patient_name: string
    patient_dob?: string | null
    patient_gender?: string | null
    patient_mobile?: string | null
    chief_complaint: string
    soap_notes?: string | null
    procedure_recommended?: string | null
    urgency: UrgencyLevel
    status: ReferralStatus
    submitted_at: string
    accepted_at?: string | null
    completed_at?: string | null
  }

  export interface ClinicalData {
    case_id: string
    vitals: Record<string, string>
    medications: { name: string; dose?: string; frequency?: string }[]
    allergies?: string | null
    comorbidities?: string | null
    ecg_findings?: string | null
    lab_summary?: string | null
    imaging_summary?: string | null
  }

  // ── Appointments (Module 4) ────────────────────────────────────
  export type AppointmentStatus = 'confirmed' | 'rescheduled' | 'cancelled' | 'completed' | 'no_show'
  export type BookingChannel = 'whatsapp' | 'web_widget' | 'manual' | 'referral'

  export interface Appointment {
    id: string
    specialist_id: string
    slot_id: string
    patient_name: string
    patient_mobile: string
    reason?: string | null
    channel: BookingChannel
    status: AppointmentStatus
    referral_case_id?: string | null
    booked_at: string
    slot_date: string
    slot_time: string
  }

  // ── Triage (Module 5) ─────────────────────────────────────────
  export type RedFlagLevel = 'none' | 'needs_review' | 'urgent'
  export type TriageStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'expired'

  export interface TriageSession {
    id: string
    specialist_id: string
    protocol_id: string
    patient_name: string
    patient_mobile?: string | null
    patient_age?: number | null
    patient_gender?: string | null
    status: TriageStatus
    red_flag_level: RedFlagLevel
    red_flag_summary?: string | null
    ai_synopsis?: string | null
    completed_at?: string | null
    appointment_id?: string | null
    referral_case_id?: string | null
  }

  export interface TriageAnswer {
    question_id: string
    question_text: string
    question_type: string
    answer_value: string
    answer_display?: string | null
    is_red_flag: boolean
    red_flag_level: RedFlagLevel
    section?: string | null
    unit?: string | null
  }

  // ── Synthesis (Module 6) ──────────────────────────────────────
  export type SynthesisJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial'

  export interface SynthesisJob {
    id: string
    specialist_id: string
    patient_identifier: string   // name + mobile hash — no raw PHI in job record
    trigger: SynthesisTrigger
    status: SynthesisJobStatus
    agent_trace?: AgentTrace[]
    output?: SynthesisOutput | null
    error?: string | null
    created_at: string
    completed_at?: string | null
  }

  export type SynthesisTrigger =
    | 'pre_consultation'   // triage completed — generate pre-consult brief
    | 'post_referral'      // referral accepted — synthesise for specialist
    | 'manual'             // specialist requests on demand

  export interface AgentTrace {
    tool: string
    status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
    duration_ms?: number
    result_summary?: string
    error?: string
    timestamp: string
  }

  export interface SynthesisOutput {
    clinical_brief: string            // 3–5 sentence structured clinical summary
    key_findings: KeyFinding[]
    recommended_focus_areas: string[] // What to pay attention to in consultation
    data_completeness_score: number   // 0–100: how much data was available
    sources_used: DataSource[]
    red_flags: SynthesisRedFlag[]
    generated_at: string
  }

  export interface KeyFinding {
    category: string       // e.g. 'Cardiac History', 'Medications', 'Vitals'
    finding: string
    source: DataSource
    significance: 'routine' | 'notable' | 'critical'
  }

  export interface SynthesisRedFlag {
    description: string
    source: DataSource
    level: RedFlagLevel
  }

  export type DataSource =
    | 'triage_self_report'
    | 'referral_summary'
    | 'appointment_history'
    | 'chatbot_interaction'
    | 'specialist_notes'

  // ── Notification events (shared by all modules) ───────────────
  export type NotificationChannel = 'whatsapp' | 'in_app' | 'email'

  export interface NotificationEvent {
    id: string
    specialist_id: string
    module: 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6'
    event_type: string
    recipient_mobile?: string
    recipient_type: 'specialist' | 'referring_doctor' | 'patient'
    message: string
    delivered: boolean
    created_at: string
  }

  // ── Service health (used by all modules) ──────────────────────
  export interface ServiceHealth {
    service: string
    status: 'ok' | 'degraded' | 'down'
    latency_ms?: number
    last_checked: string
    error?: string
  }
}

// ── Result type for safe error handling ────────────────────────
export type Result<T, E = string> =
  | { ok: true;  value: T }
  | { ok: false; error: E }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<T>(error: string): Result<T> {
  return { ok: false, error }
}

  // ── Transcription (Module 7) ──────────────────────────────────
  export type TranscriptionStatus =
    | 'recording' | 'processing' | 'extracting'
    | 'pending_review' | 'approved' | 'sent_to_patient'
    | 'failed' | 'cancelled'

  export type ConsultationType =
    | 'new_opd' | 'follow_up' | 'pre_procedure'
    | 'procedure_note' | 'discharge' | 'emergency' | 'teleconsult'

  export interface TranscriptionSession {
    id:                   string
    specialist_id:        string
    template_id:          string | null
    patient_name:         string
    patient_mobile:       string | null
    patient_age:          number | null
    patient_gender:       string | null
    audio_duration_secs:  number | null
    audio_language:       string
    consultation_type:    ConsultationType
    status:               TranscriptionStatus
    raw_transcript:       string | null
    speaker_segments:     SpeakerSegment[] | null
    error_message:        string | null
    reviewed_at:          string | null
    created_at:           string
    // soft refs
    appointment_id:       string | null
    referral_case_id:     string | null
    triage_session_id:    string | null
    synthesis_job_id:     string | null
  }

  export interface SpeakerSegment {
    speaker: 'doctor' | 'patient' | 'unknown'
    start:   number
    end:     number
    text:    string
  }

  export interface ConsultationNote {
    id:              string
    session_id:      string
    specialist_id:   string
    template_id:     string | null
    sections:        Record<string, string>
    ai_model:        string | null
    ai_confidence:   number | null
    ai_flags:        AIFlag[]
    patient_summary: string | null
    referrer_summary:string | null
    icd10_codes:     string[]
    amendments:      NoteAmendment[]
    created_at:      string
  }

  export interface AIFlag {
    type:     'medication_alert' | 'dosage_check' | 'allergy_conflict'
            | 'missing_critical_field' | 'unclear_instruction' | 'safety_concern'
    section:  string
    message:  string
    severity: 'warning' | 'critical'
  }

  export interface NoteAmendment {
    section:      string
    old_value:    string
    new_value:    string
    amended_at:   string
  }

  export interface NoteTemplateSection {
    id:                        string
    type:                      string
    label:                     string
    sort_order:                number
    required:                  boolean
    extraction_prompt:         string
    include_in_patient_summary:boolean
    ai_hint?:                  string
  }

  export interface NoteTemplate {
    id:                       string
    specialist_id:            string
    name:                     string
    description:              string | null
    specialty_context:        string | null
    consultation_type:        ConsultationType
    is_active:                boolean
    is_default:               boolean
    sections:                 NoteTemplateSection[]
    patient_summary_preamble: string | null
    patient_summary_closing:  string | null
    speaker_labels:           boolean
    auto_approve:             boolean
    language:                 string
  }
