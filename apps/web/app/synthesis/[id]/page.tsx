import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import SynthesisBriefClient from './synthesis-brief-client'

export default async function SynthesisBriefPage({ params }: { params: { id: string } }) {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: specialist } = await db
    .from('specialists')
    .select('id, name, specialty')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  // ── Core case + referring doctor + documents ──────────────────────────────
  const { data: referralCase } = await db
    .from('referral_cases')
    .select(`
      id, reference_no, patient_name, patient_mobile, patient_dob, patient_gender,
      chief_complaint, soap_notes, procedure_recommended, urgency, status,
      created_at, submitted_at, accepted_at,
      poc_specialist_name, poc_specialist_mobile,
      referring_doctors (
        id, name, specialty, clinic_name, city, mobile
      ),
      referral_clinical_data (
        id, vitals, medications, allergies, comorbidities,
        ecg_findings, echo_findings, lab_summary, imaging_summary, other_findings,
        created_at
      ),
      referral_documents (
        id, file_name, file_type, mime_type, storage_path, size_bytes,
        uploaded_by, created_at
      )
    `)
    .eq('id', params.id)
    .eq('specialist_id', specialist.id)
    .single()

  if (!referralCase) notFound()

  // ── Parallel: triage session, appointments, synthesis job ─────────────────
  const [
    { data: triageSessions },
    { data: appointments },
    { data: synthJob },
  ] = await Promise.all([
    // All triage sessions for this case (via FK referral_case_id)
    db
      .from('triage_sessions')
      .select(`
        id, status, red_flag_level, red_flag_summary, ai_synopsis,
        language, channel, completed_at, started_at, created_at,
        poc_reviewed_at, poc_notes,
        triage_protocols ( name, protocol_type ),
        triage_answers (
          id, answer_value, answer_display, is_red_flag, red_flag_level, red_flag_message, answered_at,
          triage_questions ( question_text, question_text_hi, section, question_type )
        )
      `)
      .eq('referral_case_id', params.id)
      .eq('specialist_id', specialist.id)
      .order('created_at', { ascending: false }),

    // Confirmed appointments for this case
    db
      .from('appointments')
      .select(`
        id, status, reason, notes, created_at,
        appointment_slots ( slot_date, slot_time, duration_minutes )
      `)
      .eq('referral_case_id', params.id)
      .eq('specialist_id', specialist.id)
      .order('created_at', { ascending: false }),

    // Latest synthesis job for this case
    db
      .from('synthesis_jobs')
      .select(`
        id, status, clinical_brief, data_completeness, created_at, completed_at,
        agent_traces ( tool_name, tool_status, output_summary, duration_ms, executed_at ),
        synthesis_findings ( id, category, finding, significance, source, is_red_flag, red_flag_message )
      `)
      .eq('referral_case_id', params.id)
      .eq('specialist_id', specialist.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Pick the most recently completed triage session
  const primaryTriage = (triageSessions || []).find(t => t.status === 'completed')
    || (triageSessions || [])[0]
    || null

  return (
    <SynthesisBriefClient
      referralCase={{
        ...referralCase,
        referring_doctor: (referralCase.referring_doctors as any) || null,
        clinical_data:    ((referralCase.referral_clinical_data as any[])?.[0]) || null,
        documents:        (referralCase.referral_documents as any[]) || [],
      }}
      triageSession={primaryTriage}
      appointments={appointments || []}
      synthesisJob={synthJob || null}
      specialist={specialist}
    />
  )
}
