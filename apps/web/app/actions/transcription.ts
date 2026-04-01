'use server'

import crypto from 'crypto'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient }                from '@supabase/supabase-js'
import { redirect }                    from 'next/navigation'
import { revalidatePath }              from 'next/cache'

// ── Inline boundary (avoids cross-package resolution in server actions) ───
type BR<T> = { ok: true; value: T } | { ok: false; error: string }
async function boundary<T>(name: string, fn: () => Promise<T>): Promise<BR<T>> {
  try   { return { ok: true, value: await fn() } }
  catch (e) { console.error(`[M7:${name}]`, e); return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

async function getAuth() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const { data: s } = await supabase.from('specialists')
    .select('id, name, specialty, role, whatsapp_number').eq('google_id', user.id).single()
  if (!s) redirect('/onboarding')
  return { supabase, specialist: s }
}

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function dispatchTranscription(sessionId: string) {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) return
  fetch(`${url}/api/transcription`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
    body:    JSON.stringify({ sessionId }),
  }).catch(e => console.error('[M7] dispatch error:', e))
}

// ════════════════════════════════════════════════════════════
// TEMPLATE MANAGEMENT
// ════════════════════════════════════════════════════════════

export async function listTemplateDefaultsAction() {
  return boundary('list_defaults', async () => {
    const { supabase } = await getAuth()
    const { data } = await supabase
      .from('note_template_defaults')
      .select('id, specialty, consultation_type, name, description')
      .order('specialty')
    return data || []
  })
}

export async function createTemplateAction(formData: FormData) {
  return boundary('create_template', async () => {
    const { supabase, specialist } = await getAuth()

    const name             = (formData.get('name') as string)?.trim()
    const consultationType = formData.get('consultation_type') as string
    const defaultId        = formData.get('default_id') as string | null

    if (!name) throw new Error('Template name is required')

    let sections: any[] = []
    let preamble: string | null = null
    let closing:  string | null = null

    if (defaultId) {
      const { data: def } = await supabase
        .from('note_template_defaults')
        .select('sections, patient_summary_preamble, patient_summary_closing')
        .eq('id', defaultId).single()
      if (def) {
        sections = def.sections as any[]
        preamble = def.patient_summary_preamble
        closing  = def.patient_summary_closing
      }
    }

    const { data, error } = await supabase.from('note_templates').insert({
      specialist_id:             specialist.id,
      name,
      specialty_context:         specialist.specialty,
      consultation_type:         consultationType as any,
      sections,
      patient_summary_preamble:  preamble,
      patient_summary_closing:   closing,
    }).select('id').single()

    if (error || !data) throw new Error('Could not create template')
    revalidatePath('/transcription/templates')
    return { id: data.id }
  })
}

export async function saveTemplateSectionsAction(templateId: string, sections: unknown[]) {
  return boundary('save_sections', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('note_templates')
      .update({ sections })
      .eq('id', templateId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not save template sections')
    revalidatePath('/transcription/templates')
    return true
  })
}

export async function listTemplatesAction() {
  return boundary('list_templates', async () => {
    const { supabase, specialist } = await getAuth()
    const { data } = await supabase.from('note_templates')
      .select('id, name, consultation_type, is_active, is_default, specialty_context')
      .eq('specialist_id', specialist.id).order('created_at', { ascending: false })
    return data || []
  })
}

// ════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ════════════════════════════════════════════════════════════

export async function createSessionAction(
  patientName:    string,
  templateId:     string | null,
  consultType:    string,
  patientMobile?: string,
  appointmentId?: string,
  referralCaseId?:string
) {
  return boundary('create_session', async () => {
    const { supabase, specialist } = await getAuth()

    if (!patientName?.trim()) throw new Error('Patient name required')

    const { data, error } = await supabase.from('transcription_sessions').insert({
      specialist_id:   specialist.id,
      template_id:     templateId  || null,
      patient_name:    patientName.trim(),
      patient_mobile:  patientMobile?.trim() || null,
      appointment_id:  appointmentId  || null,
      referral_case_id:referralCaseId || null,
      consultation_type: consultType as any,
      status:          'recording',
      recording_started_at: new Date().toISOString(),
    }).select('id').single()

    if (error || !data) throw new Error('Could not create session')
    revalidatePath('/transcription')
    return { sessionId: data.id }
  })
}

export async function submitAudioAction(sessionId: string, formData: FormData) {
  return boundary('submit_audio', async () => {
    const { supabase, specialist } = await getAuth()

    // Verify session belongs to specialist
    const { data: session } = await supabase.from('transcription_sessions')
      .select('id, status, template_id, patient_name, patient_mobile')
      .eq('id', sessionId).eq('specialist_id', specialist.id).single()

    if (!session) throw new Error('Session not found')
    if (!['recording', 'failed'].includes(session.status)) throw new Error('Session is not in recording state')

    const audioFile = formData.get('audio') as File
    if (!audioFile || audioFile.size === 0) throw new Error('No audio file provided')

    // Validate file size — Groq Whisper limit is 25 MB
    if (audioFile.size > 25 * 1024 * 1024) throw new Error('Audio file exceeds 25 MB limit')

    // Mark as processing and update recording end time
    await supabase.from('transcription_sessions').update({
      status: 'processing',
      recording_ended_at: new Date().toISOString(),
    }).eq('id', sessionId)

    // Fetch clinic name for patient summary
    let chatbotConfig: { clinic_name?: string } | null = null
    try {
      const { data: cc } = await supabase.from('chatbot_configs')
        .select('clinic_name').eq('specialist_id', specialist.id).single()
      chatbotConfig = cc
    } catch { /* chatbot not configured — use specialist name */ }

    // Fetch template info
    let templateId: string | null = session.template_id

    // Store audio temporarily for processing API route
    // We pass session metadata — audio bytes go directly to the API
    const processingFormData = new FormData()
    processingFormData.append('audio', audioFile)
    processingFormData.append('sessionId', sessionId)
    processingFormData.append('specialistId', specialist.id)
    processingFormData.append('specialistName', specialist.name)
    processingFormData.append('patientName', session.patient_name)
    processingFormData.append('clinicName', chatbotConfig?.clinic_name || 'the clinic')
    processingFormData.append('consultationDate', new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }))
    processingFormData.append('templateId', templateId || '')
    processingFormData.append('language', 'en')

    // Dispatch to transcription API route for isolated processing
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (appUrl) {
      fetch(`${appUrl}/api/transcription`, {
        method:  'POST',
        headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
        body:    processingFormData,
      }).catch(e => console.error('[M7] transcription dispatch error:', e))
    }

    revalidatePath('/transcription')
    return { sessionId, status: 'processing' }
  })
}

export async function listSessionsAction(limit = 50) {
  return boundary('list_sessions', async () => {
    const { supabase, specialist } = await getAuth()
    const { data } = await supabase.from('transcription_sessions')
      .select(`
        id, patient_name, consultation_type, status,
        audio_duration_secs, recording_started_at, created_at,
        note_templates ( name ),
        consultation_notes ( ai_confidence, ai_flags )
      `)
      .eq('specialist_id', specialist.id)
      .order('created_at', { ascending: false })
      .limit(limit)
    return data || []
  })
}

export async function getSessionAction(sessionId: string) {
  return boundary('get_session', async () => {
    const { supabase, specialist } = await getAuth()
    const { data } = await supabase.from('transcription_sessions')
      .select(`
        *,
        note_templates ( * ),
        consultation_notes ( * )
      `)
      .eq('id', sessionId).eq('specialist_id', specialist.id).single()
    if (!data) throw new Error('Session not found')
    return data
  })
}

// ════════════════════════════════════════════════════════════
// REVIEW AND APPROVAL
// ════════════════════════════════════════════════════════════

export async function amendNoteAction(
  sessionId: string,
  sectionId: string,
  newContent: string
) {
  return boundary('amend_note', async () => {
    const { supabase, specialist } = await getAuth()

    const { data: note } = await supabase.from('consultation_notes')
      .select('sections, amendments').eq('session_id', sessionId).single()

    if (!note) throw new Error('Note not found')

    const oldContent   = (note.sections as any)[sectionId] || ''
    const newSections  = { ...note.sections as any, [sectionId]: newContent }
    const amendment    = { section: sectionId, old_value: oldContent, new_value: newContent, amended_at: new Date().toISOString() }
    const amendments   = [...((note.amendments as any[]) || []), amendment]

    const { error } = await supabase.from('consultation_notes')
      .update({ sections: newSections, amendments })
      .eq('session_id', sessionId)

    if (error) throw new Error('Could not save amendment')
    revalidatePath(`/transcription/${sessionId}`)
    return true
  })
}

export async function approveNoteAction(sessionId: string, reviewNotes?: string) {
  return boundary('approve_note', async () => {
    const { supabase, specialist } = await getAuth()

    const { error } = await supabase.from('transcription_sessions')
      .update({
        status:      'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: specialist.id,
        review_notes:reviewNotes || null,
      })
      .eq('id', sessionId)
      .eq('specialist_id', specialist.id)
      .in('status', ['pending_review'])

    if (error) throw new Error('Could not approve note')
    revalidatePath(`/transcription/${sessionId}`)
    revalidatePath('/transcription')
    return true
  })
}

// ════════════════════════════════════════════════════════════
// DELIVERY
// ════════════════════════════════════════════════════════════

export async function sendPatientSummaryAction(sessionId: string) {
  return boundary('send_patient_summary', async () => {
    const { supabase, specialist } = await getAuth()

    const { data: session } = await supabase.from('transcription_sessions')
      .select('patient_name, patient_mobile, status')
      .eq('id', sessionId).eq('specialist_id', specialist.id).single()

    if (!session) throw new Error('Session not found')
    if (session.status !== 'approved') throw new Error('Note must be approved before sending to patient')
    if (!session.patient_mobile) throw new Error('Patient mobile number not on record')

    const { data: note } = await supabase.from('consultation_notes')
      .select('patient_summary').eq('session_id', sessionId).single()

    if (!note?.patient_summary) throw new Error('No patient summary available')

    // Send via WhatsApp
    const token  = process.env.WHATSAPP_API_TOKEN
    const numId  = process.env.WHATSAPP_PHONE_NUMBER_ID
    const digits = session.patient_mobile.replace(/\D/g, '')
    const to     = digits.startsWith('91') ? `+${digits}` : `+91${digits}`

    if (token && numId) {
      await fetch(`https://graph.facebook.com/v19.0/${numId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', recipient_type: 'individual', to,
          type: 'text', text: { preview_url: false, body: note.patient_summary },
        }),
      })
    } else {
      console.log('[M7] WA not configured — would send to', to)
    }

    // Update status and log delivery
    await supabase.from('transcription_sessions')
      .update({ status: 'sent_to_patient' }).eq('id', sessionId)

    await supabase.from('transcription_delivery_log').insert({
      session_id:    sessionId,
      specialist_id: specialist.id,
      recipient_type:'patient',
      channel:       'whatsapp',
      summary_type:  'patient_summary',
      content_hash:  crypto.createHash('sha256').update(note.patient_summary).digest('hex'),
    })

    revalidatePath(`/transcription/${sessionId}`)
    return true
  })
}

export async function sendReferrerSummaryAction(sessionId: string, referrerMobile: string) {
  return boundary('send_referrer_summary', async () => {
    const { supabase, specialist } = await getAuth()

    const { data: note } = await supabase.from('consultation_notes')
      .select('referrer_summary').eq('session_id', sessionId).single()

    if (!note?.referrer_summary) throw new Error('No referrer summary available')

    const { data: session } = await supabase.from('transcription_sessions')
      .select('patient_name').eq('id', sessionId).single()

    const token  = process.env.WHATSAPP_API_TOKEN
    const numId  = process.env.WHATSAPP_PHONE_NUMBER_ID
    const digits = referrerMobile.replace(/\D/g, '')
    const to     = digits.startsWith('91') ? `+${digits}` : `+91${digits}`

    if (token && numId) {
      await fetch(`https://graph.facebook.com/v19.0/${numId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', recipient_type: 'individual', to,
          type: 'text', text: { preview_url: false, body: note.referrer_summary },
        }),
      })
    }

    await supabase.from('transcription_delivery_log').insert({
      session_id:    sessionId,
      specialist_id: specialist.id,
      recipient_type:'referring_doctor',
      channel:       'whatsapp',
      summary_type:  'referrer_summary',
      content_hash:  crypto.createHash('sha256').update(note.referrer_summary).digest('hex'),
    })

    return true
  })
}

export async function discardSessionAction(sessionId: string) {
  return boundary('discard', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('transcription_sessions')
      .update({ status: 'cancelled' })
      .eq('id', sessionId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not cancel session')
    revalidatePath('/transcription')
    return true
  })
}

export async function retryTranscriptionAction(sessionId: string) {
  return boundary('retry', async () => {
    const { supabase, specialist } = await getAuth()
    const { data: session } = await supabase.from('transcription_sessions')
      .select('retry_count').eq('id', sessionId).eq('specialist_id', specialist.id).single()
    if (!session) throw new Error('Session not found')
    if (session.retry_count >= 2) throw new Error('Maximum retries reached')
    await supabase.from('transcription_sessions')
      .update({ status: 'processing', retry_count: session.retry_count + 1, error_message: null })
      .eq('id', sessionId)
    dispatchTranscription(sessionId)
    revalidatePath(`/transcription/${sessionId}`)
    return true
  })
}
