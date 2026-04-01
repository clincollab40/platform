/**
 * ClinCollab Synthesis Agent — Tool Registry
 *
 * Each tool is a pure async function:
 * - Takes a context payload
 * - Returns Result<ToolOutput> — NEVER throws
 * - Has its own error boundary and timeout
 * - Writes its own trace to the DB
 * - Has no knowledge of other tools
 *
 * Tool isolation is the key architectural guarantee:
 * if the triage tool fails, the referral tool still runs.
 */

import { createClient } from '@supabase/supabase-js'
import { callExternalService, log, moduleBoundary } from '../../packages/shared-utils/resilience'
import type { Result, ClinCollab } from '../../packages/types'
import { ok, err } from '../../packages/types'

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// ── Tool output types ─────────────────────────────────────────
export interface TriageToolOutput {
  source: 'triage_self_report'
  patientName: string
  redFlagLevel: ClinCollab.RedFlagLevel
  redFlagSummary: string | null
  aiSynopsis: string | null
  answers: ClinCollab.TriageAnswer[]
  completedAt: string | null
}

export interface ReferralToolOutput {
  source: 'referral_summary'
  referenceNo: string
  chiefComplaint: string
  soapNotes: string | null
  procedureRecommended: string | null
  urgency: ClinCollab.UrgencyLevel
  vitals: Record<string, string>
  medications: { name: string; dose?: string }[]
  allergies: string | null
  comorbidities: string | null
  ecgFindings: string | null
  labSummary: string | null
}

export interface AppointmentToolOutput {
  source: 'appointment_history'
  upcomingAppointment: {
    slotDate: string
    slotTime: string
    reason: string | null
  } | null
  recentAppointments: {
    slotDate: string
    reason: string | null
    status: string
  }[]
  totalAppointments: number
}

export interface ChatbotToolOutput {
  source: 'chatbot_interaction'
  sessionCount: number
  lastInteraction: string | null
  topIntents: string[]
  bookedViaChat: boolean
}

export interface SpecialistNotesToolOutput {
  source: 'specialist_notes'
  networkNotes: string[]      // notes from referrer profile
  caseMessages: string[]      // messages from case thread
}

// Union of all tool outputs
export type ToolOutput =
  | TriageToolOutput
  | ReferralToolOutput
  | AppointmentToolOutput
  | ChatbotToolOutput
  | SpecialistNotesToolOutput

// ── Tool 1: Triage data reader ────────────────────────────────
export async function triageDataTool(
  triageSessionId: string,
  specialistId: string
): Promise<Result<TriageToolOutput>> {
  return moduleBoundary('M6:triage_tool', async () => {
    const db = svc()

    const { data: session, error: se } = await db
      .from('triage_sessions')
      .select('id, patient_name, red_flag_level, red_flag_summary, ai_synopsis, completed_at')
      .eq('id', triageSessionId)
      .eq('specialist_id', specialistId)
      .single()

    if (se || !session) throw new Error(`Triage session not found: ${triageSessionId}`)

    const { data: answers } = await db
      .from('triage_answers')
      .select(`
        answer_value, answer_display, is_red_flag, red_flag_level,
        triage_questions ( question_text, question_type, options, unit, section, sort_order )
      `)
      .eq('session_id', triageSessionId)
      .order('answered_at')

    const mappedAnswers: ClinCollab.TriageAnswer[] = (answers || []).map(a => ({
      question_id:   (a.triage_questions as any)?.id || '',
      question_text: (a.triage_questions as any)?.question_text || '',
      question_type: (a.triage_questions as any)?.question_type || 'text',
      answer_value:  a.answer_value,
      answer_display:a.answer_display,
      is_red_flag:   a.is_red_flag,
      red_flag_level:a.red_flag_level as ClinCollab.RedFlagLevel,
      section:       (a.triage_questions as any)?.section,
      unit:          (a.triage_questions as any)?.unit,
    }))

    return ok({
      source:         'triage_self_report' as const,
      patientName:    session.patient_name,
      redFlagLevel:   session.red_flag_level as ClinCollab.RedFlagLevel,
      redFlagSummary: session.red_flag_summary,
      aiSynopsis:     session.ai_synopsis,
      answers:        mappedAnswers,
      completedAt:    session.completed_at,
    })
  })
}

// ── Tool 2: Referral data reader ─────────────────────────────
export async function referralDataTool(
  referralCaseId: string,
  specialistId: string
): Promise<Result<ReferralToolOutput>> {
  return moduleBoundary('M6:referral_tool', async () => {
    const db = svc()

    const { data: rc, error } = await db
      .from('referral_cases')
      .select('reference_no, chief_complaint, soap_notes, procedure_recommended, urgency, poc_referrer_mobile')
      .eq('id', referralCaseId)
      .eq('specialist_id', specialistId)
      .single()

    if (error || !rc) throw new Error(`Referral case not found: ${referralCaseId}`)

    const { data: clinical } = await db
      .from('referral_clinical_data')
      .select('vitals, medications, allergies, comorbidities, ecg_findings, lab_summary, imaging_summary')
      .eq('case_id', referralCaseId)
      .single()

    return ok({
      source:               'referral_summary' as const,
      referenceNo:          rc.reference_no,
      chiefComplaint:       rc.chief_complaint,
      soapNotes:            rc.soap_notes,
      procedureRecommended: rc.procedure_recommended,
      urgency:              rc.urgency as ClinCollab.UrgencyLevel,
      vitals:               (clinical?.vitals as Record<string, string>) || {},
      medications:          (clinical?.medications as any[]) || [],
      allergies:            clinical?.allergies || null,
      comorbidities:        clinical?.comorbidities || null,
      ecgFindings:          clinical?.ecg_findings || null,
      labSummary:           clinical?.lab_summary || null,
    })
  })
}

// ── Tool 3: Appointment history reader ───────────────────────
export async function appointmentHistoryTool(
  patientName: string,
  patientMobile: string | null,
  specialistId: string
): Promise<Result<AppointmentToolOutput>> {
  return moduleBoundary('M6:appointment_tool', async () => {
    const db = svc()

    // Match by mobile (preferred) or name
    let query = db
      .from('appointments')
      .select(`
        id, reason, status, booked_at,
        appointment_slots ( slot_date, slot_time )
      `)
      .eq('specialist_id', specialistId)
      .order('booked_at', { ascending: false })
      .limit(10)

    if (patientMobile) {
      query = query.eq('patient_mobile', patientMobile)
    } else {
      query = query.ilike('patient_name', `%${patientName}%`)
    }

    const { data: appts } = await query

    const all = (appts || []).map(a => ({
      slotDate: (a.appointment_slots as any)?.slot_date || '',
      slotTime: (a.appointment_slots as any)?.slot_time || '',
      reason:   a.reason,
      status:   a.status,
    }))

    const upcoming = all.find(a =>
      a.status === 'confirmed' && a.slotDate >= new Date().toISOString().split('T')[0]
    )

    return ok({
      source: 'appointment_history' as const,
      upcomingAppointment: upcoming ? {
        slotDate: upcoming.slotDate,
        slotTime: upcoming.slotTime,
        reason:   upcoming.reason,
      } : null,
      recentAppointments: all.slice(0, 5),
      totalAppointments:  all.length,
    })
  })
}

// ── Tool 4: Chatbot interaction reader ───────────────────────
export async function chatbotInteractionTool(
  patientMobile: string | null,
  specialistId: string
): Promise<Result<ChatbotToolOutput>> {
  return moduleBoundary('M6:chatbot_tool', async () => {
    if (!patientMobile) {
      return ok({
        source:          'chatbot_interaction' as const,
        sessionCount:    0,
        lastInteraction: null,
        topIntents:      [],
        bookedViaChat:   false,
      })
    }

    const db = svc()

    const { data: sessions } = await db
      .from('chat_sessions')
      .select('outcome, last_message_at, appointment_id')
      .eq('specialist_id', specialistId)
      .eq('patient_mobile', patientMobile)
      .order('last_message_at', { ascending: false })
      .limit(5)

    // Fetch most common intents from messages
    const { data: messages } = await db
      .from('chat_messages')
      .select('intent')
      .eq('specialist_id', specialistId)
      .not('intent', 'is', null)
      .limit(20)

    const intentCounts: Record<string, number> = {}
    ;(messages || []).forEach(m => {
      if (m.intent) intentCounts[m.intent] = (intentCounts[m.intent] || 0) + 1
    })

    const topIntents = Object.entries(intentCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([intent]) => intent)

    return ok({
      source:          'chatbot_interaction' as const,
      sessionCount:    (sessions || []).length,
      lastInteraction: sessions?.[0]?.last_message_at || null,
      topIntents,
      bookedViaChat:   (sessions || []).some(s => s.appointment_id),
    })
  })
}

// ── Tool 5: Specialist notes reader ──────────────────────────
export async function specialistNotesTool(
  patientName: string,
  referralCaseId: string | null,
  specialistId: string
): Promise<Result<SpecialistNotesToolOutput>> {
  return moduleBoundary('M6:notes_tool', async () => {
    const db = svc()
    const networkNotes: string[] = []
    const caseMessages: string[] = []

    // Fetch referrer notes if case exists
    if (referralCaseId) {
      const { data: msgs } = await db
        .from('case_messages')
        .select('content, sender_type, message_type')
        .eq('case_id', referralCaseId)
        .eq('specialist_id', specialistId)
        .neq('message_type', 'system_event')
        .order('created_at', { ascending: false })
        .limit(5)

      ;(msgs || []).forEach(m => {
        const prefix = m.sender_type === 'specialist' ? 'Specialist: ' : 'Referring doctor: '
        caseMessages.push(`${prefix}${m.content.slice(0, 200)}`)
      })
    }

    return ok({
      source:       'specialist_notes' as const,
      networkNotes,
      caseMessages,
    })
  })
}
