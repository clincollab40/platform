'use server'

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import {
  notifySpecialistNewReferral,
  notifyReferrerCaseAccepted,
  notifyReferrerCaseQueried,
  notifyReferrerCaseDeclined,
  notifyReferrerCaseUpdate,
  sendReferralFormLink,
} from '@/lib/whatsapp/notifications'
import { uploadReferralDocument, validateUploadFile, inferDocumentType } from '@/lib/storage/documents'

// ── Schemas ──────────────────────────────────────────
const ReferralSubmitSchema = z.object({
  specialist_id:        z.string().uuid(),
  token:                z.string().min(10),
  patient_name:         z.string().min(2).max(100),
  patient_dob:          z.string().optional(),
  patient_gender:       z.enum(['male', 'female', 'other']).optional(),
  patient_mobile:       z.string().max(15).optional(),
  chief_complaint:      z.string().min(5).max(1000),
  soap_notes:           z.string().max(2000).optional(),
  procedure_recommended:z.string().max(500).optional(),
  urgency:              z.enum(['routine', 'urgent', 'emergency']),
  expected_visit_date:  z.string().optional(),
  poc_referrer_name:    z.string().max(100).optional(),
  poc_referrer_mobile:  z.string().max(15).optional(),
  // Referring doctor identity
  rd_name:              z.string().min(2).max(100),
  rd_mobile:            z.string().min(10).max(15),
  rd_specialty:         z.string().max(100).optional(),
  rd_city:              z.string().max(100).optional(),
  rd_clinic:            z.string().max(150).optional(),
  // Clinical data
  vitals_bp_systolic:   z.string().optional(),
  vitals_bp_diastolic:  z.string().optional(),
  vitals_heart_rate:    z.string().optional(),
  vitals_spo2:          z.string().optional(),
  vitals_weight:        z.string().optional(),
  vitals_rbs:           z.string().optional(),
  medications:          z.string().optional(),
  allergies:            z.string().max(500).optional(),
  comorbidities:        z.string().max(500).optional(),
  ecg_findings:         z.string().max(1000).optional(),
  lab_summary:          z.string().max(1000).optional(),
  imaging_summary:      z.string().max(1000).optional(),
})

// ── Helper ──────────────────────────────────────────
async function getAuthSpecialist() {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')
  const supabase = createServiceRoleClient()

  const { data: specialist } = await supabase
    .from('specialists')
    .select('id, name, specialty, city, role, whatsapp_number')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')
  return { supabase, specialist }
}

// ── GENERATE REFERRAL FORM LINK ─────────────────────
export async function generateReferralLinkAction(referrerId?: string) {
  const { supabase, specialist } = await getAuthSpecialist()

  const { data: token, error } = await supabase
    .from('referral_tokens')
    .insert({
      specialist_id: specialist.id,
      referrer_id: referrerId || null,
      token_type: 'referral_form',
    })
    .select('token')
    .single()

  if (error || !token) return { error: 'Could not generate referral link.' }

  const formUrl = `${process.env.NEXT_PUBLIC_APP_URL}/refer/${token.token}`

  return { success: true, url: formUrl, token: token.token }
}

// ── SEND REFERRAL LINK VIA WHATSAPP ─────────────────
export async function sendReferralLinkAction(referrerId: string, mobile: string) {
  const { supabase, specialist } = await getAuthSpecialist()

  const result = await generateReferralLinkAction(referrerId)
  if (result.error || !result.url) return { error: result.error }

  const { data: referrer } = await supabase
    .from('referrers')
    .select('name')
    .eq('id', referrerId)
    .single()

  await sendReferralFormLink({
    referrerMobile: mobile,
    referrerName: referrer?.name,
    specialistName: specialist.name,
    specialistSpecialty: specialist.specialty.replace(/_/g, ' '),
    formUrl: result.url,
  })

  await supabase.from('audit_logs').insert({
    actor_id: specialist.id,
    actor_role: specialist.role,
    action: 'referral_link_sent',
    resource_type: 'referral_token',
    metadata: { referrer_id: referrerId, mobile },
  })

  return { success: true, url: result.url }
}

// ── SUBMIT REFERRAL (by referring doctor — no auth) ─
export async function submitReferralAction(formData: FormData) {
  // This action uses service role — called from the public referral form
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const raw: Record<string, string> = {}
  formData.forEach((value, key) => {
    if (typeof value === 'string') raw[key] = value
  })

  const parsed = ReferralSubmitSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const d = parsed.data

  // Validate token
  const { data: tokenRow } = await supabase
    .from('referral_tokens')
    .select('id, specialist_id, used_count, max_uses, expires_at')
    .eq('token', d.token)
    .single()

  if (!tokenRow) return { error: 'Invalid referral link. Please request a new one from the specialist.' }
  if (new Date(tokenRow.expires_at) < new Date()) return { error: 'This referral link has expired. Please request a new one.' }
  if (tokenRow.used_count >= tokenRow.max_uses) return { error: 'This referral link has reached its usage limit.' }

  // Upsert referring doctor
  const { data: rd } = await supabase
    .from('referring_doctors')
    .upsert({
      mobile: d.rd_mobile,
      name: d.rd_name,
      specialty: d.rd_specialty || null,
      city: d.rd_city || null,
      clinic_name: d.rd_clinic || null,
    }, { onConflict: 'mobile' })
    .select('id')
    .single()

  if (!rd) return { error: 'Could not process referring doctor details.' }

  // Find matching referrer in specialist's network
  const { data: referrer } = await supabase
    .from('referrers')
    .select('id')
    .eq('specialist_id', tokenRow.specialist_id)
    .ilike('name', d.rd_name)
    .single()

  // Build vitals JSON
  const vitals: Record<string, string> = {}
  if (d.vitals_bp_systolic)  vitals.bp_systolic  = d.vitals_bp_systolic
  if (d.vitals_bp_diastolic) vitals.bp_diastolic = d.vitals_bp_diastolic
  if (d.vitals_heart_rate)   vitals.heart_rate   = d.vitals_heart_rate
  if (d.vitals_spo2)         vitals.spo2         = d.vitals_spo2
  if (d.vitals_weight)       vitals.weight       = d.vitals_weight
  if (d.vitals_rbs)          vitals.rbs          = d.vitals_rbs

  // Parse medications
  let medications: any[] = []
  try {
    if (d.medications) medications = JSON.parse(d.medications)
  } catch { medications = d.medications ? [{ name: d.medications }] : [] }

  // Create the referral case
  const { data: referralCase, error: caseError } = await supabase
    .from('referral_cases')
    .insert({
      specialist_id:          tokenRow.specialist_id,
      referrer_id:            referrer?.id || null,
      referring_doctor_id:    rd.id,
      patient_name:           d.patient_name,
      patient_dob:            d.patient_dob || null,
      patient_gender:         d.patient_gender || null,
      patient_mobile:         d.patient_mobile || null,
      chief_complaint:        d.chief_complaint,
      soap_notes:             d.soap_notes || null,
      procedure_recommended:  d.procedure_recommended || null,
      urgency:                d.urgency,
      status:                 'submitted',
      expected_visit_date:    d.expected_visit_date || null,
      poc_referrer_name:      d.poc_referrer_name || null,
      poc_referrer_mobile:    d.rd_mobile,
    })
    .select('id, reference_no')
    .single()

  if (caseError || !referralCase) {
    console.error('[Referral] Case creation error:', caseError)
    return { error: 'Could not submit referral. Please try again.' }
  }

  // Create clinical data record
  await supabase.from('referral_clinical_data').insert({
    case_id:       referralCase.id,
    specialist_id: tokenRow.specialist_id,
    vitals,
    medications,
    allergies:      d.allergies || null,
    comorbidities:  d.comorbidities || null,
    ecg_findings:   d.ecg_findings || null,
    lab_summary:    d.lab_summary || null,
    imaging_summary:d.imaging_summary || null,
  })

  // Handle document uploads
  const uploadedDocs: string[] = []
  const files = formData.getAll('documents') as File[]

  for (const file of files.slice(0, 5)) {
    if (!file || file.size === 0) continue

    const validation = validateUploadFile(file)
    if (!validation.valid) continue

    const { path, error: uploadError } = await uploadReferralDocument(
      file, tokenRow.specialist_id, referralCase.id
    )

    if (!uploadError && path) {
      await supabase.from('referral_documents').insert({
        case_id:       referralCase.id,
        specialist_id: tokenRow.specialist_id,
        file_name:     file.name,
        file_type:     inferDocumentType(file.name, file.type),
        mime_type:     file.type,
        storage_path:  path,
        size_bytes:    file.size,
        uploaded_by:   'referring_doctor',
      })
      uploadedDocs.push(path)
    }
  }

  // Increment token usage
  await supabase
    .from('referral_tokens')
    .update({ used_count: tokenRow.used_count + 1 })
    .eq('id', tokenRow.id)

  // Add system message to case thread
  await supabase.from('case_messages').insert({
    case_id:      referralCase.id,
    specialist_id:tokenRow.specialist_id,
    sender_type:  'system',
    sender_id:    'system',
    message_type: 'system_event',
    content:      `Referral submitted by Dr. ${d.rd_name}. ${uploadedDocs.length} document(s) attached.`,
  })

  // Notify specialist
  const { data: specialistData } = await supabase
    .from('specialists')
    .select('name, specialty, whatsapp_number')
    .eq('id', tokenRow.specialist_id)
    .single()

  if (specialistData?.whatsapp_number) {
    await notifySpecialistNewReferral({
      specialistMobile:  specialistData.whatsapp_number,
      specialistName:    specialistData.name,
      referrerName:      d.rd_name,
      patientName:       d.patient_name,
      urgency:           d.urgency,
      referenceNo:       referralCase.reference_no,
      appUrl:            process.env.NEXT_PUBLIC_APP_URL!,
    })
  }

  return {
    success: true,
    referenceNo: referralCase.reference_no,
    caseId: referralCase.id,
  }
}

// ── ACCEPT REFERRAL ──────────────────────────────────
export async function acceptReferralAction(caseId: string, formData: FormData) {
  const { supabase, specialist } = await getAuthSpecialist()

  const expectedDate   = formData.get('expected_visit_date') as string
  const pocName        = formData.get('poc_specialist_name') as string
  const pocMobile      = formData.get('poc_specialist_mobile') as string

  const { data: referralCase, error } = await supabase
    .from('referral_cases')
    .update({
      status:                 'accepted',
      accepted_at:            new Date().toISOString(),
      expected_visit_date:    expectedDate || null,
      poc_specialist_name:    pocName || null,
      poc_specialist_mobile:  pocMobile || null,
    })
    .eq('id', caseId)
    .eq('specialist_id', specialist.id)
    .select('reference_no, patient_name, poc_referrer_mobile, referring_doctor_id')
    .single()

  if (error || !referralCase) return { error: 'Could not accept referral.' }

  // System message
  await supabase.from('case_messages').insert({
    case_id:      caseId,
    specialist_id:specialist.id,
    sender_type:  'specialist',
    sender_id:    specialist.id,
    message_type: 'system_event',
    content:      `Referral accepted by Dr. ${specialist.name}.${expectedDate ? ` Expected visit: ${expectedDate}` : ''}`,
  })

  // Notify referring doctor
  const mobile = referralCase.poc_referrer_mobile
  if (mobile) {
    const { data: rd } = await supabase
      .from('referring_doctors')
      .select('name')
      .eq('id', referralCase.referring_doctor_id)
      .single()

    await notifyReferrerCaseAccepted({
      referrerMobile:      mobile,
      referrerName:        rd?.name || 'Doctor',
      specialistName:      specialist.name,
      patientName:         referralCase.patient_name,
      expectedDate,
      pocSpecialistName:   pocName,
      pocSpecialistMobile: pocMobile,
      referenceNo:         referralCase.reference_no,
    })
  }

  await supabase.from('audit_logs').insert({
    actor_id: specialist.id, actor_role: specialist.role,
    action: 'referral_accepted', resource_type: 'referral_case', resource_id: caseId,
  })

  revalidatePath('/referrals')
  revalidatePath(`/referrals/${caseId}`)
  return { success: true }
}

// ── QUERY REFERRAL ───────────────────────────────────
export async function queryReferralAction(caseId: string, queryText: string) {
  const { supabase, specialist } = await getAuthSpecialist()

  if (!queryText.trim()) return { error: 'Please enter your clinical query.' }

  const { data: referralCase, error } = await supabase
    .from('referral_cases')
    .update({ status: 'queried', query_text: queryText })
    .eq('id', caseId)
    .eq('specialist_id', specialist.id)
    .select('reference_no, patient_name, poc_referrer_mobile, referring_doctor_id')
    .single()

  if (error || !referralCase) return { error: 'Could not send query.' }

  await supabase.from('case_messages').insert({
    case_id: caseId, specialist_id: specialist.id,
    sender_type: 'specialist', sender_id: specialist.id,
    message_type: 'text', content: queryText,
  })

  // Notify referring doctor with reply link
  const mobile = referralCase.poc_referrer_mobile
  if (mobile) {
    const { data: rd } = await supabase
      .from('referring_doctors')
      .select('name')
      .eq('id', referralCase.referring_doctor_id)
      .single()

    const replyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/refer/reply/${referralCase.reference_no}`
    await notifyReferrerCaseQueried({
      referrerMobile: mobile,
      referrerName:   rd?.name || 'Doctor',
      specialistName: specialist.name,
      patientName:    referralCase.patient_name,
      queryText,
      replyUrl,
      referenceNo:    referralCase.reference_no,
    })
  }

  revalidatePath(`/referrals/${caseId}`)
  return { success: true }
}

// ── DECLINE REFERRAL ─────────────────────────────────
export async function declineReferralAction(caseId: string, reason: string) {
  const { supabase, specialist } = await getAuthSpecialist()

  if (!reason.trim()) return { error: 'Please provide a reason for declining.' }

  const { data: referralCase, error } = await supabase
    .from('referral_cases')
    .update({ status: 'declined', decline_reason: reason })
    .eq('id', caseId)
    .eq('specialist_id', specialist.id)
    .select('reference_no, patient_name, poc_referrer_mobile, referring_doctor_id')
    .single()

  if (error || !referralCase) return { error: 'Could not decline referral.' }

  await supabase.from('case_messages').insert({
    case_id: caseId, specialist_id: specialist.id,
    sender_type: 'specialist', sender_id: specialist.id,
    message_type: 'system_event',
    content: `Referral declined. Reason: ${reason}`,
  })

  const mobile = referralCase.poc_referrer_mobile
  if (mobile) {
    const { data: rd } = await supabase
      .from('referring_doctors')
      .select('name')
      .eq('id', referralCase.referring_doctor_id)
      .single()

    await notifyReferrerCaseDeclined({
      referrerMobile: mobile,
      referrerName:   rd?.name || 'Doctor',
      specialistName: specialist.name,
      patientName:    referralCase.patient_name,
      reason,
      referenceNo:    referralCase.reference_no,
    })
  }

  revalidatePath('/referrals')
  revalidatePath(`/referrals/${caseId}`)
  return { success: true }
}

// ── SEND CASE UPDATE ─────────────────────────────────
export async function sendCaseUpdateAction(caseId: string, formData: FormData) {
  const { supabase, specialist } = await getAuthSpecialist()

  const updateType     = formData.get('update_type') as string
  const structuredData: Record<string, string> = {}

  // Pull all structured fields from form
  formData.forEach((value, key) => {
    if (key !== 'update_type' && typeof value === 'string' && value.trim()) {
      structuredData[key] = value
    }
  })

  const { data: update, error } = await supabase
    .from('case_updates')
    .insert({
      case_id:         caseId,
      specialist_id:   specialist.id,
      update_type:     updateType as any,
      structured_data: structuredData,
    })
    .select('id')
    .single()

  if (error || !update) return { error: 'Could not send update.' }

  // Build human-readable summary for WhatsApp
  const summaryLines: string[] = []
  if (structuredData.summary)        summaryLines.push(structuredData.summary)
  if (structuredData.procedure_name) summaryLines.push(`Procedure: ${structuredData.procedure_name}`)
  if (structuredData.outcome)        summaryLines.push(`Outcome: ${structuredData.outcome}`)
  if (structuredData.follow_up_date) summaryLines.push(`Follow-up: ${structuredData.follow_up_date}`)
  if (structuredData.medications)    summaryLines.push(`Medications: ${structuredData.medications}`)
  if (structuredData.notes)          summaryLines.push(structuredData.notes)

  const updateSummary = summaryLines.join('\n')

  // Add to case thread
  await supabase.from('case_messages').insert({
    case_id: caseId, specialist_id: specialist.id,
    sender_type: 'specialist', sender_id: specialist.id,
    message_type: 'clinical_update',
    content: updateSummary || updateType.replace(/_/g, ' '),
  })

  // Notify referring doctor
  const { data: referralCase } = await supabase
    .from('referral_cases')
    .select('reference_no, patient_name, poc_referrer_mobile, referring_doctor_id')
    .eq('id', caseId)
    .single()

  if (referralCase?.poc_referrer_mobile) {
    const { data: rd } = await supabase
      .from('referring_doctors')
      .select('name')
      .eq('id', referralCase.referring_doctor_id)
      .single()

    await notifyReferrerCaseUpdate({
      referrerMobile: referralCase.poc_referrer_mobile,
      referrerName:   rd?.name || 'Doctor',
      specialistName: specialist.name,
      patientName:    referralCase.patient_name,
      updateType,
      updateSummary,
      referenceNo:    referralCase.reference_no,
    })

    await supabase.from('case_updates')
      .update({ whatsapp_delivered: true })
      .eq('id', update.id)
  }

  revalidatePath(`/referrals/${caseId}`)
  return { success: true }
}

// ── SEND MESSAGE ─────────────────────────────────────
export async function sendCaseMessageAction(caseId: string, content: string) {
  const { supabase, specialist } = await getAuthSpecialist()

  if (!content.trim()) return { error: 'Message cannot be empty.' }

  const { error } = await supabase.from('case_messages').insert({
    case_id:      caseId,
    specialist_id:specialist.id,
    sender_type:  'specialist',
    sender_id:    specialist.id,
    message_type: 'text',
    content:      content.trim(),
  })

  if (error) return { error: 'Could not send message.' }

  revalidatePath(`/referrals/${caseId}`)
  return { success: true }
}
