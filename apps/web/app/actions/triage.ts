'use server'

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  evaluateRedFlags,
  computeSessionRedFlagLevel,
  buildRedFlagSummary,
  generateClinicalSynopsis,
  resolveVisibleQuestions,
  type TriageQuestion,
  type AnswerMap,
} from '@/lib/ai/triage-engine'
import { z } from 'zod'

// ── Helpers ────────────────────────────────────────
async function getAuthSpecialist() {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')
  const supabase = createServiceRoleClient()
  const { data: s } = await supabase
    .from('specialists')
    .select('id, name, specialty, role')
    .eq('google_id', user.id)
    .single()
  if (!s) redirect('/onboarding')
  return { supabase, specialist: s }
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// ══════════════════════════════════════════════════
// PROTOCOL MANAGEMENT
// ══════════════════════════════════════════════════

// ── Create protocol (blank or from template) ───────
export async function createProtocolAction(formData: FormData) {
  const { supabase, specialist } = await getAuthSpecialist()

  const name         = (formData.get('name') as string)?.trim()
  const description  = (formData.get('description') as string)?.trim()
  const protocolType = formData.get('protocol_type') as string || 'new_patient'
  const templateId   = formData.get('template_id') as string | null

  if (!name) return { error: 'Protocol name is required.' }

  // Create protocol
  const { data: protocol, error } = await supabase
    .from('triage_protocols')
    .insert({
      specialist_id:    specialist.id,
      name,
      description:      description || null,
      specialty_context:specialist.specialty,
      protocol_type:    protocolType as any,
    })
    .select('id')
    .single()

  if (error || !protocol) return { error: 'Could not create protocol.' }

  // If template selected, copy template questions
  if (templateId) {
    const { data: template } = await supabase
      .from('triage_protocol_templates')
      .select('questions')
      .eq('id', templateId)
      .single()

    if (template?.questions) {
      const questions = (template.questions as any[]).map(q => ({
        protocol_id:    protocol.id,
        specialist_id:  specialist.id,
        question_text:  q.question_text,
        question_type:  q.question_type,
        options:        q.options || [],
        is_required:    q.is_required || false,
        sort_order:     q.sort_order || 0,
        section:        q.section || null,
        help_text:      q.help_text || null,
        unit:           q.unit || null,
        min_value:      q.min_value || null,
        max_value:      q.max_value || null,
        branch_logic:   q.branch_logic || [],
        red_flag_rules: q.red_flag_rules || [],
      }))

      await supabase.from('triage_questions').insert(questions)
    }
  }

  revalidatePath('/triage/builder')
  return { success: true, id: protocol.id }
}

// ── Update protocol metadata ───────────────────────
export async function updateProtocolAction(id: string, formData: FormData) {
  const { supabase, specialist } = await getAuthSpecialist()

  const { error } = await supabase
    .from('triage_protocols')
    .update({
      name:             (formData.get('name') as string)?.trim(),
      description:      (formData.get('description') as string)?.trim() || null,
      protocol_type:    formData.get('protocol_type') as any,
      welcome_message:  (formData.get('welcome_message') as string)?.trim() || null,
      completion_message:(formData.get('completion_message') as string)?.trim() || null,
      is_active:        formData.get('is_active') === 'true',
      is_default:       formData.get('is_default') === 'true',
    })
    .eq('id', id)
    .eq('specialist_id', specialist.id)

  if (error) return { error: 'Could not update protocol.' }

  revalidatePath('/triage/builder')
  revalidatePath(`/triage/builder?protocol=${id}`)
  return { success: true }
}

// ── Delete protocol ────────────────────────────────
export async function deleteProtocolAction(id: string) {
  const { supabase, specialist } = await getAuthSpecialist()

  const { error } = await supabase
    .from('triage_protocols')
    .delete()
    .eq('id', id)
    .eq('specialist_id', specialist.id)

  if (error) return { error: 'Could not delete protocol.' }

  revalidatePath('/triage/builder')
  return { success: true }
}

// ── Save all questions for a protocol (full replace) ─
const QuestionSchema = z.object({
  id:             z.string().uuid().optional(),
  question_text:  z.string().min(3).max(500),
  question_type:  z.enum(['text','number','yes_no','single_choice','multi_choice','scale','date','vitals_bp','vitals_single','section_header']),
  options:        z.array(z.object({ value: z.string(), label: z.string() })).default([]),
  is_required:    z.boolean().default(false),
  sort_order:     z.number().int(),
  section:        z.string().optional().nullable(),
  help_text:      z.string().optional().nullable(),
  unit:           z.string().optional().nullable(),
  min_value:      z.number().optional().nullable(),
  max_value:      z.number().optional().nullable(),
  branch_logic:   z.array(z.any()).default([]),
  red_flag_rules: z.array(z.any()).default([]),
})

export async function saveQuestionsAction(
  protocolId: string,
  questions: unknown[]
) {
  const { supabase, specialist } = await getAuthSpecialist()

  // Verify protocol belongs to specialist
  const { data: protocol } = await supabase
    .from('triage_protocols')
    .select('id')
    .eq('id', protocolId)
    .eq('specialist_id', specialist.id)
    .single()

  if (!protocol) return { error: 'Protocol not found.' }

  // Validate all questions
  const validated = []
  for (const q of questions) {
    const result = QuestionSchema.safeParse(q)
    if (!result.success) return { error: `Invalid question: ${result.error.issues[0].message}` }
    validated.push(result.data)
  }

  // Delete all existing questions for this protocol
  await supabase
    .from('triage_questions')
    .delete()
    .eq('protocol_id', protocolId)
    .eq('specialist_id', specialist.id)

  // Insert new questions
  if (validated.length > 0) {
    const inserts = validated.map(q => ({
      protocol_id:   protocolId,
      specialist_id: specialist.id,
      question_text: q.question_text,
      question_type: q.question_type,
      options:       q.options,
      is_required:   q.is_required,
      sort_order:    q.sort_order,
      section:       q.section || null,
      help_text:     q.help_text || null,
      unit:          q.unit || null,
      min_value:     q.min_value || null,
      max_value:     q.max_value || null,
      branch_logic:  q.branch_logic,
      red_flag_rules:q.red_flag_rules,
    }))

    const { error } = await supabase.from('triage_questions').insert(inserts)
    if (error) return { error: 'Could not save questions.' }
  }

  // Bump version
  await supabase
    .from('triage_protocols')
    .update({ version: supabase.rpc as any })
    .eq('id', protocolId)

  revalidatePath(`/triage/builder`)
  return { success: true, count: validated.length }
}

// ══════════════════════════════════════════════════
// SESSION MANAGEMENT
// ══════════════════════════════════════════════════

// ── Create a triage session (specialist-initiated) ─
export async function createTriageSessionAction(
  protocolId: string,
  patientName: string,
  patientMobile?: string,
  appointmentId?: string,
  referralCaseId?: string
) {
  const { supabase, specialist } = await getAuthSpecialist()

  if (!patientName?.trim()) return { error: 'Patient name is required.' }

  // Verify protocol belongs to specialist
  const { data: protocol } = await supabase
    .from('triage_protocols')
    .select('id, total_questions:triage_questions(count)')
    .eq('id', protocolId)
    .eq('specialist_id', specialist.id)
    .single()

  if (!protocol) return { error: 'Protocol not found.' }

  const { data: session, error } = await supabase
    .from('triage_sessions')
    .insert({
      specialist_id:   specialist.id,
      protocol_id:     protocolId,
      patient_name:    patientName.trim(),
      patient_mobile:  patientMobile?.trim() || null,
      appointment_id:  appointmentId || null,
      referral_case_id:referralCaseId || null,
      status:          'pending',
    })
    .select('id, access_token')
    .single()

  if (error || !session) return { error: 'Could not create triage session.' }

  const triageUrl = `${process.env.NEXT_PUBLIC_APP_URL}/triage/${session.access_token}`

  // Send WhatsApp if mobile provided
  if (patientMobile?.trim() && process.env.WHATSAPP_API_TOKEN) {
    await sendTriageLinkWhatsApp(
      patientMobile.trim(),
      patientName.trim(),
      specialist.name,
      triageUrl
    )
  }

  revalidatePath('/triage/sessions')
  return { success: true, sessionId: session.id, token: session.access_token, url: triageUrl }
}

// ─────────────────────────────────────────────────
// PUBLIC TRIAGE FLOW (no auth — service role)
// ─────────────────────────────────────────────────

// ── Submit a single answer (called after each question) ─
export async function submitTriageAnswerAction(
  token: string,
  questionId: string,
  answerValue: string,
  answerDisplay: string
) {
  const sc = serviceClient()

  // Validate token and get session
  const { data: session } = await sc
    .from('triage_sessions')
    .select('id, specialist_id, protocol_id, status, token_expires_at')
    .eq('access_token', token)
    .single()

  if (!session) return { error: 'Invalid triage link.' }
  if (new Date(session.token_expires_at) < new Date()) return { error: 'This triage link has expired.' }
  if (session.status === 'completed') return { error: 'This triage has already been submitted.' }

  // Get the question for red flag evaluation
  const { data: question } = await sc
    .from('triage_questions')
    .select('*')
    .eq('id', questionId)
    .eq('specialist_id', session.specialist_id)
    .single()

  if (!question) return { error: 'Question not found.' }

  // Evaluate red flags
  const flagResult = evaluateRedFlags(question as TriageQuestion, answerValue)

  // Upsert the answer
  const { error: answerError } = await sc
    .from('triage_answers')
    .upsert({
      session_id:       session.id,
      specialist_id:    session.specialist_id,
      question_id:      questionId,
      answer_value:     answerValue,
      answer_display:   answerDisplay,
      is_red_flag:      flagResult.triggered,
      red_flag_level:   flagResult.level as any,
      red_flag_message: flagResult.message || null,
    }, { onConflict: 'session_id,question_id' })

  if (answerError) return { error: 'Could not save answer.' }

  // Update session status to in_progress
  if (session.status === 'pending') {
    await sc
      .from('triage_sessions')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', session.id)
  }

  // Trigger urgent red flag WhatsApp alert immediately
  if (flagResult.triggered && flagResult.level === 'urgent') {
    await triggerRedFlagAlert(session.specialist_id, session.id, session.id, flagResult.message || '')
  }

  return { success: true, redFlag: flagResult }
}

// ── Complete triage session ────────────────────────
export async function completeTriage(token: string) {
  const sc = serviceClient()

  const { data: session } = await sc
    .from('triage_sessions')
    .select(`
      id, specialist_id, protocol_id, patient_name,
      patient_age, patient_gender, status
    `)
    .eq('access_token', token)
    .single()

  if (!session || session.status === 'completed') return

  // Fetch all answers
  const { data: answers } = await sc
    .from('triage_answers')
    .select('*, triage_questions(question_text, question_type, options, unit)')
    .eq('session_id', session.id)

  // Fetch all questions
  const { data: questions } = await sc
    .from('triage_questions')
    .select('*')
    .eq('protocol_id', session.protocol_id)
    .order('sort_order')

  const answerMap: AnswerMap = {}
  ;(answers || []).forEach(a => { answerMap[a.question_id] = a.answer_value })

  // Compute session-level red flag
  const flags = (answers || []).map(a => ({
    questionId: a.question_id,
    result: { triggered: a.is_red_flag, level: a.red_flag_level as any, message: a.red_flag_message }
  }))

  const sessionLevel = computeSessionRedFlagLevel(flags.map(f => f.result))
  const redFlagSummary = buildRedFlagSummary(
    (questions || []) as TriageQuestion[],
    answerMap,
    flags
  )

  // Fetch specialist info
  const { data: specialist } = await sc
    .from('specialists')
    .select('name, specialty, whatsapp_number')
    .eq('id', session.specialist_id)
    .single()

  // Generate AI synopsis
  const synopsis = await generateClinicalSynopsis(
    specialist?.name || '',
    specialist?.specialty || '',
    session.patient_name,
    session.patient_age,
    session.patient_gender,
    (questions || []) as TriageQuestion[],
    answerMap,
    redFlagSummary
  )

  // Mark session complete
  await sc
    .from('triage_sessions')
    .update({
      status:          'completed',
      completed_at:    new Date().toISOString(),
      red_flag_level:  sessionLevel,
      red_flag_summary:redFlagSummary || null,
      ai_synopsis:     synopsis || null,
    })
    .eq('id', session.id)

  // Notify specialist
  if (specialist?.whatsapp_number) {
    const urgencyLabel = sessionLevel === 'urgent'
      ? '🔴 URGENT — '
      : sessionLevel === 'needs_review'
      ? '🟡 Review needed — '
      : ''

    const msg = `ClinCollab — Triage complete\n\n${urgencyLabel}${session.patient_name} has completed pre-consultation triage.\n\n${redFlagSummary ? `Flags:\n${redFlagSummary}\n\n` : ''}View summary: ${process.env.NEXT_PUBLIC_APP_URL}/triage/sessions/${session.id}`

    await sendWhatsAppDirect(specialist.whatsapp_number, msg)
  }
}

// ── Trigger urgent red flag alert ─────────────────
async function triggerRedFlagAlert(
  specialistId: string,
  sessionId: string,
  patientSessionId: string,
  message: string
) {
  const sc = serviceClient()
  const { data: spec } = await sc
    .from('specialists')
    .select('whatsapp_number, name')
    .eq('id', specialistId)
    .single()

  if (!spec?.whatsapp_number) return

  const { data: session } = await sc
    .from('triage_sessions')
    .select('patient_name')
    .eq('id', sessionId)
    .single()

  const msg = `ClinCollab — 🔴 URGENT TRIAGE ALERT\n\nDr. ${spec.name},\n\n${session?.patient_name || 'Patient'} is currently completing triage. Urgent flag triggered:\n\n${message}\n\nReview now: ${process.env.NEXT_PUBLIC_APP_URL}/triage/sessions/${sessionId}`

  await sendWhatsAppDirect(spec.whatsapp_number, msg)
}

// ── WhatsApp sender ────────────────────────────────
async function sendWhatsAppDirect(mobile: string, body: string) {
  const token  = process.env.WHATSAPP_API_TOKEN
  const numId  = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !numId) { console.log('[Triage WA]', body); return }

  const digits = mobile.replace(/\D/g, '')
  const to = digits.startsWith('91') ? `+${digits}` : `+91${digits}`

  await fetch(`https://graph.facebook.com/v19.0/${numId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to,
      type: 'text', text: { preview_url: false, body },
    }),
  }).catch(e => console.error('[WA send]', e))
}

async function sendTriageLinkWhatsApp(
  mobile: string, patientName: string,
  specialistName: string, url: string
) {
  const body = `ClinCollab — Pre-consultation triage\n\nDear ${patientName},\n\nDr. ${specialistName} has shared a brief clinical questionnaire to complete before your consultation. It takes approximately 5 minutes.\n\nTap the link to begin:\n${url}\n\nPlease complete this before your appointment.`
  await sendWhatsAppDirect(mobile, body)
}
