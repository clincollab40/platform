/**
 * WhatsApp Referrer Intake Webhook
 * ─────────────────────────────────
 * Referring doctors text a dedicated WhatsApp number to share patient details.
 * This webhook processes their messages conversationally, step by step,
 * and automatically creates a referral_case + referral_clinical_data record
 * once all required fields are collected.
 *
 * Flow:
 *   Referring Dr texts "New patient" or any message
 *   → System greets and starts collecting fields per intake config
 *   → Each reply advances the state machine
 *   → On completion → creates referral_case, notifies specialist
 *
 * NOTE: This route handles a SEPARATE WhatsApp number configured for
 * referrer intake (WHATSAPP_REFERRER_PHONE_NUMBER_ID env var).
 * The main chatbot uses WHATSAPP_PHONE_NUMBER_ID.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

// ── WhatsApp send helper ───────────────────────────────────────────────────
async function sendWA(to: string, body: string) {
  const token         = process.env.WHATSAPP_API_TOKEN
  const phoneNumberId = process.env.WHATSAPP_REFERRER_PHONE_NUMBER_ID
                     || process.env.WHATSAPP_PHONE_NUMBER_ID

  if (!token || !phoneNumberId) {
    console.log('[ReferrerIntake] WA not configured — would send:', { to, body: body.slice(0, 80) })
    return
  }

  await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.startsWith('+') ? to : `+91${to.replace(/\D/g,'')}`,
      type: 'text',
      text: { preview_url: false, body },
    }),
  }).catch(err => console.error('[ReferrerIntake] WA send error:', err))
}

// ── GET: Meta verification challenge ──────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// ── POST: Incoming WhatsApp message ───────────────────────────────────────
export async function POST(req: NextRequest) {
  const bodyText = await req.text()
  // Acknowledge immediately — Meta requires <5s
  processReferrerMessage(bodyText).catch(err =>
    console.error('[ReferrerIntake] Processing error:', err)
  )
  return new NextResponse('OK', { status: 200 })
}

// ── Main async processor ───────────────────────────────────────────────────
async function processReferrerMessage(bodyText: string) {
  let payload: any
  try { payload = JSON.parse(bodyText) } catch { return }

  const value   = payload?.entry?.[0]?.changes?.[0]?.value
  if (value?.statuses) return // delivery receipts — ignore

  const message = value?.messages?.[0]
  if (!message) return

  const fromNumber  = message.from
  const contactName = value?.contacts?.[0]?.profile?.name || null
  const phoneNumberId = value?.metadata?.phone_number_id

  // Handle text and document messages
  let messageText = ''
  let mediaId: string | null = null

  if (message.type === 'text') {
    messageText = message.text?.body || ''
  } else if (['document','image'].includes(message.type)) {
    mediaId = message.document?.id || message.image?.id || null
    messageText = `[${message.type === 'image' ? 'Image' : 'Document'} received]`
  } else {
    return // unsupported message type
  }

  if (!fromNumber) return

  // Find which specialist owns this referrer phone number
  // Specialists configure their referrer intake number via chatbot_configs
  const { data: config } = await db
    .from('chatbot_configs')
    .select('specialist_id, specialists(id, name, specialty, whatsapp_number)')
    .eq('whatsapp_number', phoneNumberId)
    .limit(1)
    .maybeSingle()

  // Fallback: find any specialist (single-tenant shortcut)
  const specialistId: string | null = (config?.specialist_id as string) || null
  if (!specialistId) {
    console.log('[ReferrerIntake] No specialist for phone_number_id:', phoneNumberId)
    return
  }

  // ── Find or create intake session ─────────────────────────────────────
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { data: existingSession } = await db
    .from('referrer_whatsapp_sessions')
    .select('*')
    .eq('specialist_id', specialistId)
    .eq('referring_mobile', fromNumber)
    .eq('is_active', true)
    .gte('last_message_at', twentyFourHoursAgo)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Load intake config for this specialist
  const { data: intakeConfig } = await db
    .from('referrer_intake_configs')
    .select('*')
    .eq('specialist_id', specialistId)
    .maybeSingle()

  // Default config if not set
  const cfg = intakeConfig || {
    require_patient_name: true, require_patient_mobile: true,
    require_patient_gender: true, require_chief_complaint: true,
    require_soap_notes: false, require_urgency: true,
    require_procedure: false, require_vitals_bp: false,
    require_vitals_hr: false, require_vitals_spo2: false,
    require_vitals_weight: false, require_ecg_findings: false,
    require_lab_summary: false, require_medications: false,
    require_allergies: false, require_comorbidities: false,
    require_document_upload: false,
    welcome_message: 'Hello Doctor! Please share your patient details.',
    completion_message: 'Thank you! Case created. We will confirm acceptance shortly.',
  }

  let session = existingSession
  let isNew = false

  if (!session) {
    // Check if this is a known referring doctor
    const { data: refDoctor } = await db
      .from('referring_doctors')
      .select('id, name')
      .eq('mobile', fromNumber.replace(/^\+91/, ''))
      .maybeSingle()

    const { data: newSession } = await db
      .from('referrer_whatsapp_sessions')
      .insert({
        specialist_id: specialistId,
        referring_mobile: fromNumber,
        referring_name: contactName || refDoctor?.name || null,
        current_step: 'welcome',
        collected_data: {},
      })
      .select('*')
      .single()

    session = newSession
    isNew = true
  }

  if (!session) return

  // ── State machine ───────────────────────────────────────────────────────
  const collectedData: Record<string, any> = session.collected_data || {}
  let nextStep = session.current_step
  let responseText = ''

  // Handle "restart" or "new patient" keyword at any stage
  const lowerMsg = messageText.toLowerCase().trim()
  const isRestart = ['restart', 'new', 'new patient', 'reset', 'start'].some(k => lowerMsg === k)

  if (isRestart && session.current_step !== 'welcome') {
    // Reset session
    await db.from('referrer_whatsapp_sessions').update({
      current_step: 'patient_name',
      collected_data: {},
      last_message_at: new Date().toISOString(),
      message_count: (session.message_count || 0) + 1,
    }).eq('id', session.id)

    await sendWA(fromNumber, 'Starting fresh. Please tell me the *patient\'s full name*:')
    return
  }

  // Process current step
  switch (session.current_step) {
    case 'welcome': {
      responseText = `${cfg.welcome_message}\n\nI need a few details about the patient. Let\'s start:\n\nWhat is the *patient\'s full name*?`
      nextStep = 'patient_name'
      break
    }

    case 'patient_name': {
      if (messageText.trim().length < 2) {
        responseText = 'Please enter the patient\'s full name (at least 2 characters).'
        nextStep = 'patient_name'
        break
      }
      collectedData.patient_name = messageText.trim()
      if (cfg.require_patient_mobile) {
        responseText = `Got it — *${collectedData.patient_name}*.\n\nWhat is the patient\'s *mobile number*? (10 digits, or type "skip")`
        nextStep = 'patient_mobile'
      } else if (cfg.require_patient_gender) {
        responseText = 'What is the patient\'s *gender*?\nReply: *male*, *female*, or *other*'
        nextStep = 'patient_gender'
      } else {
        nextStep = 'chief_complaint'
        responseText = 'What is the patient\'s *chief complaint*? (main symptom or reason for referral)'
      }
      break
    }

    case 'patient_mobile': {
      if (lowerMsg !== 'skip') {
        const digits = messageText.replace(/\D/g, '')
        if (digits.length < 10) {
          responseText = 'Please enter a valid 10-digit mobile number, or type "skip".'
          nextStep = 'patient_mobile'
          break
        }
        collectedData.patient_mobile = digits.slice(-10)
      }
      if (cfg.require_patient_gender) {
        responseText = 'What is the patient\'s *gender*?\nReply: *male*, *female*, or *other*'
        nextStep = 'patient_gender'
      } else {
        responseText = 'What is the patient\'s *chief complaint*? (main symptom or reason for referral)'
        nextStep = 'chief_complaint'
      }
      break
    }

    case 'patient_gender': {
      const g = lowerMsg
      const gender = g.includes('female') ? 'female' : g.includes('male') ? 'male' : g.includes('other') ? 'other' : null
      if (!gender) {
        responseText = 'Please reply *male*, *female*, or *other*.'
        nextStep = 'patient_gender'
        break
      }
      collectedData.patient_gender = gender
      responseText = 'What is the patient\'s *chief complaint*? (main symptom or reason for referral)'
      nextStep = 'chief_complaint'
      break
    }

    case 'chief_complaint': {
      if (messageText.trim().length < 5) {
        responseText = 'Please describe the chief complaint in at least 5 characters.'
        nextStep = 'chief_complaint'
        break
      }
      collectedData.chief_complaint = messageText.trim()

      if (cfg.require_soap_notes) {
        responseText = 'Please share a brief *SOAP note* (Subjective, Objective, Assessment, Plan). Type "skip" to skip.'
        nextStep = 'soap_notes'
      } else if (cfg.require_urgency) {
        responseText = 'How *urgent* is this case?\nReply: *routine*, *urgent*, or *emergency*'
        nextStep = 'urgency'
      } else if (cfg.require_vitals_bp || cfg.require_vitals_hr || cfg.require_vitals_spo2) {
        responseText = buildVitalsPrompt(cfg)
        nextStep = 'vitals'
      } else if (cfg.require_ecg_findings) {
        responseText = 'Any *ECG findings*? Type "skip" to skip.'
        nextStep = 'ecg'
      } else if (cfg.require_lab_summary) {
        responseText = 'Any *lab results* to share? (brief summary). Type "skip" to skip.'
        nextStep = 'lab'
      } else if (cfg.require_medications) {
        responseText = 'Current *medications*? (list main ones). Type "skip" to skip.'
        nextStep = 'medications'
      } else if (cfg.require_procedure) {
        responseText = 'What *procedure* are you recommending? Type "skip" to skip.'
        nextStep = 'procedure'
      } else if (cfg.require_document_upload) {
        responseText = 'Please send any *documents* (discharge summary, ECG, lab reports) as attachments. Type "done" when finished.'
        nextStep = 'documents'
      } else {
        nextStep = 'confirm'
        responseText = buildConfirmMessage(collectedData)
      }
      break
    }

    case 'soap_notes': {
      if (lowerMsg !== 'skip') collectedData.soap_notes = messageText.trim()
      if (cfg.require_urgency) {
        responseText = 'How *urgent* is this case?\nReply: *routine*, *urgent*, or *emergency*'
        nextStep = 'urgency'
      } else {
        nextStep = 'confirm'
        responseText = buildConfirmMessage(collectedData)
      }
      break
    }

    case 'urgency': {
      const urg = lowerMsg.includes('emergency') ? 'emergency' :
                  lowerMsg.includes('urgent')    ? 'urgent'    : 'routine'
      collectedData.urgency = urg
      if (cfg.require_vitals_bp || cfg.require_vitals_hr || cfg.require_vitals_spo2) {
        responseText = buildVitalsPrompt(cfg)
        nextStep = 'vitals'
      } else if (cfg.require_ecg_findings) {
        responseText = 'Any *ECG findings*? Type "skip" to skip.'
        nextStep = 'ecg'
      } else if (cfg.require_lab_summary) {
        responseText = 'Any *lab results* to share? Type "skip" to skip.'
        nextStep = 'lab'
      } else if (cfg.require_medications) {
        responseText = 'Current *medications*? Type "skip" to skip.'
        nextStep = 'medications'
      } else if (cfg.require_procedure) {
        responseText = 'What *procedure* are you recommending? Type "skip" to skip.'
        nextStep = 'procedure'
      } else if (cfg.require_document_upload) {
        responseText = 'Please send any documents as attachments. Type "done" when finished.'
        nextStep = 'documents'
      } else {
        nextStep = 'confirm'
        responseText = buildConfirmMessage(collectedData)
      }
      break
    }

    case 'vitals': {
      // Parse "120/80 HR 72 SpO2 98" style input
      const vitals: Record<string, string> = {}
      const bpMatch = messageText.match(/(\d{2,3})\s*[\/\-]\s*(\d{2,3})/)
      if (bpMatch) { vitals.bp_systolic = bpMatch[1]!; vitals.bp_diastolic = bpMatch[2]! }
      const hrMatch = messageText.match(/(?:hr|heart\s*rate|pulse)[:\s]*(\d{2,3})/i)
      if (hrMatch) vitals.heart_rate = hrMatch[1]!
      const spo2Match = messageText.match(/(?:spo2|o2|oxygen)[:\s]*(\d{2,3})/i)
      if (spo2Match) vitals.spo2 = spo2Match[1]!
      const wtMatch = messageText.match(/(?:weight|wt)[:\s]*(\d{2,3})/i)
      if (wtMatch) vitals.weight = wtMatch[1]!

      if (lowerMsg !== 'skip' && Object.keys(vitals).length > 0) {
        collectedData.vitals = vitals
      }

      if (cfg.require_ecg_findings) {
        responseText = 'Any *ECG findings*? Type "skip" to skip.'
        nextStep = 'ecg'
      } else if (cfg.require_lab_summary) {
        responseText = 'Any *lab results*? Type "skip" to skip.'
        nextStep = 'lab'
      } else if (cfg.require_medications) {
        responseText = 'Current *medications*? Type "skip" to skip.'
        nextStep = 'medications'
      } else if (cfg.require_procedure) {
        responseText = 'What *procedure* are you recommending? Type "skip" to skip.'
        nextStep = 'procedure'
      } else {
        nextStep = 'confirm'
        responseText = buildConfirmMessage(collectedData)
      }
      break
    }

    case 'ecg': {
      if (lowerMsg !== 'skip') collectedData.ecg_findings = messageText.trim()
      if (cfg.require_lab_summary) {
        responseText = 'Any *lab results*? (brief summary). Type "skip" to skip.'
        nextStep = 'lab'
      } else if (cfg.require_medications) {
        responseText = 'Current *medications*? Type "skip" to skip.'
        nextStep = 'medications'
      } else if (cfg.require_procedure) {
        responseText = 'What *procedure* are you recommending? Type "skip" to skip.'
        nextStep = 'procedure'
      } else {
        nextStep = 'confirm'
        responseText = buildConfirmMessage(collectedData)
      }
      break
    }

    case 'lab': {
      if (lowerMsg !== 'skip') collectedData.lab_summary = messageText.trim()
      if (cfg.require_medications) {
        responseText = 'Current *medications*? Type "skip" to skip.'
        nextStep = 'medications'
      } else if (cfg.require_procedure) {
        responseText = 'What *procedure* are you recommending? Type "skip" to skip.'
        nextStep = 'procedure'
      } else {
        nextStep = 'confirm'
        responseText = buildConfirmMessage(collectedData)
      }
      break
    }

    case 'medications': {
      if (lowerMsg !== 'skip') collectedData.medications = messageText.trim()
      if (cfg.require_procedure) {
        responseText = 'What *procedure* are you recommending? Type "skip" to skip.'
        nextStep = 'procedure'
      } else {
        nextStep = 'confirm'
        responseText = buildConfirmMessage(collectedData)
      }
      break
    }

    case 'procedure': {
      if (lowerMsg !== 'skip') collectedData.procedure_recommended = messageText.trim()
      if (cfg.require_document_upload) {
        responseText = 'Please send any documents (discharge summary, ECG, lab reports). Type "done" when finished.'
        nextStep = 'documents'
      } else {
        nextStep = 'confirm'
        responseText = buildConfirmMessage(collectedData)
      }
      break
    }

    case 'documents': {
      if (mediaId) {
        // Document received — increment count, continue waiting
        const currentCount = (collectedData.documents_count || 0) + 1
        collectedData.documents_count = currentCount
        collectedData.pending_media_ids = [...(collectedData.pending_media_ids || []), mediaId]
        responseText = `Document ${currentCount} received ✓. Send more documents or type *done* to complete.`
        nextStep = 'documents'
      } else if (lowerMsg === 'done' || lowerMsg === 'skip') {
        nextStep = 'confirm'
        responseText = buildConfirmMessage(collectedData)
      } else {
        responseText = 'Please send documents as WhatsApp attachments, or type *done* if finished.'
        nextStep = 'documents'
      }
      break
    }

    case 'confirm': {
      if (lowerMsg === 'yes' || lowerMsg === 'confirm' || lowerMsg === 'ok' || lowerMsg === 'send') {
        // CREATE THE CASE
        const caseResult = await createReferralCase(
          specialistId,
          fromNumber,
          contactName,
          collectedData,
          session.id
        )

        if (caseResult.error) {
          responseText = `Sorry, there was an error creating the case: ${caseResult.error}. Please try again.`
          nextStep = 'confirm'
        } else {
          // Mark session complete
          await db.from('referrer_whatsapp_sessions').update({
            current_step: 'complete',
            is_active: false,
            referral_case_id: caseResult.caseId,
            completed_at: new Date().toISOString(),
            collected_data: collectedData,
            last_message_at: new Date().toISOString(),
            message_count: (session.message_count || 0) + 1,
          }).eq('id', session.id)

          responseText = `${cfg.completion_message}\n\nCase reference: *${caseResult.referenceNo}*\n\nType "New patient" to refer another patient.`

          // Notify specialist
          await notifySpecialist(specialistId, collectedData, caseResult.referenceNo!)

          return // Session complete — don't update below
        }
      } else if (lowerMsg === 'no' || lowerMsg === 'edit' || lowerMsg === 'change') {
        responseText = 'What would you like to change? Type "restart" to start over.'
        nextStep = 'confirm'
      } else {
        responseText = buildConfirmMessage(collectedData) + '\n\nType *yes* to confirm or *no* to edit.'
        nextStep = 'confirm'
      }
      break
    }

    case 'complete': {
      // Session was already completed — offer new patient
      if (lowerMsg.includes('new') || lowerMsg.includes('patient') || lowerMsg.includes('start')) {
        await db.from('referrer_whatsapp_sessions').update({
          current_step: 'patient_name',
          is_active: true,
          referral_case_id: null,
          completed_at: null,
          collected_data: {},
          last_message_at: new Date().toISOString(),
        }).eq('id', session.id)
        responseText = 'Starting a new referral. What is the *patient\'s full name*?'
        return
      }
      responseText = 'Previous case was submitted. Type "New patient" to refer another patient.'
      nextStep = 'complete'
      break
    }

    default: {
      responseText = cfg.welcome_message
      nextStep = 'patient_name'
    }
  }

  // Update session
  await db.from('referrer_whatsapp_sessions').update({
    current_step: nextStep,
    collected_data: collectedData,
    last_message_at: new Date().toISOString(),
    message_count: (session.message_count || 0) + 1,
    referring_name: session.referring_name || contactName || null,
  }).eq('id', session.id)

  await sendWA(fromNumber, responseText)
}

// ── Build vitals prompt based on config ────────────────────────────────────
function buildVitalsPrompt(cfg: any): string {
  const needed = []
  if (cfg.require_vitals_bp)     needed.push('BP (e.g. 120/80)')
  if (cfg.require_vitals_hr)     needed.push('Heart rate (e.g. HR 72)')
  if (cfg.require_vitals_spo2)   needed.push('SpO₂ (e.g. SpO2 98)')
  if (cfg.require_vitals_weight) needed.push('Weight (e.g. Wt 65)')
  return `Please share patient *vitals*:\n${needed.join(', ')}\n\nExample: "BP 130/80 HR 78 SpO2 96"\nOr type "skip" to skip.`
}

// ── Build confirmation summary message ─────────────────────────────────────
function buildConfirmMessage(data: Record<string, any>): string {
  const lines = ['📋 *Please confirm patient details:*\n']
  if (data.patient_name)          lines.push(`👤 *Name:* ${data.patient_name}`)
  if (data.patient_mobile)        lines.push(`📱 *Mobile:* ${data.patient_mobile}`)
  if (data.patient_gender)        lines.push(`⚧ *Gender:* ${data.patient_gender}`)
  if (data.chief_complaint)       lines.push(`🩺 *Chief complaint:* ${data.chief_complaint}`)
  if (data.urgency)               lines.push(`⚡ *Urgency:* ${data.urgency}`)
  if (data.procedure_recommended) lines.push(`🔬 *Procedure:* ${data.procedure_recommended}`)
  if (data.vitals) {
    const v = data.vitals
    const vitStr = [
      v.bp_systolic ? `BP ${v.bp_systolic}/${v.bp_diastolic}` : '',
      v.heart_rate  ? `HR ${v.heart_rate}` : '',
      v.spo2        ? `SpO₂ ${v.spo2}%` : '',
    ].filter(Boolean).join(' | ')
    if (vitStr) lines.push(`📊 *Vitals:* ${vitStr}`)
  }
  if (data.ecg_findings)          lines.push(`💓 *ECG:* ${data.ecg_findings.slice(0,80)}`)
  if (data.lab_summary)           lines.push(`🧪 *Labs:* ${data.lab_summary.slice(0,80)}`)
  if (data.medications)           lines.push(`💊 *Medications:* ${data.medications.slice(0,80)}`)
  if (data.documents_count)       lines.push(`📎 *Documents:* ${data.documents_count} attached`)
  lines.push('\nType *yes* to submit or *no* to edit.')
  return lines.join('\n')
}

// ── Create referral_case + referral_clinical_data ──────────────────────────
async function createReferralCase(
  specialistId: string,
  referringMobile: string,
  referringName: string | null,
  data: Record<string, any>,
  sessionId: string
): Promise<{ caseId?: string; referenceNo?: string; error?: string }> {
  try {
    // Upsert referring doctor
    const cleanMobile = referringMobile.replace(/^\+91/, '').replace(/\D/g, '')
    const { data: refDoctor } = await db
      .from('referring_doctors')
      .upsert({ mobile: cleanMobile, name: referringName || 'Unknown' }, { onConflict: 'mobile' })
      .select('id')
      .single()

    // Create referral_case
    const { data: referralCase, error: caseError } = await db
      .from('referral_cases')
      .insert({
        specialist_id:         specialistId,
        referring_doctor_id:   refDoctor?.id || null,
        patient_name:          data.patient_name,
        patient_mobile:        data.patient_mobile || null,
        patient_gender:        data.patient_gender || null,
        chief_complaint:       data.chief_complaint,
        soap_notes:            data.soap_notes || null,
        procedure_recommended: data.procedure_recommended || null,
        urgency:               data.urgency || 'routine',
        status:                'submitted',
      })
      .select('id, reference_no')
      .single()

    if (caseError || !referralCase) {
      console.error('[ReferrerIntake] Case creation error:', caseError)
      return { error: caseError?.message || 'Failed to create case' }
    }

    // Create referral_clinical_data if any clinical info provided
    const hasClinical = data.vitals || data.ecg_findings || data.lab_summary || data.medications
    if (hasClinical) {
      const vitals: Record<string, any> = {}
      if (data.vitals?.bp_systolic)  vitals.bp_systolic  = parseInt(data.vitals.bp_systolic)
      if (data.vitals?.bp_diastolic) vitals.bp_diastolic = parseInt(data.vitals.bp_diastolic)
      if (data.vitals?.heart_rate)   vitals.heart_rate   = parseInt(data.vitals.heart_rate)
      if (data.vitals?.spo2)         vitals.spo2         = parseInt(data.vitals.spo2)
      if (data.vitals?.weight)       vitals.weight        = parseFloat(data.vitals.weight)

      await db.from('referral_clinical_data').insert({
        case_id:       referralCase.id,
        specialist_id: specialistId,
        vitals:        Object.keys(vitals).length > 0 ? vitals : {},
        ecg_findings:  data.ecg_findings || null,
        lab_summary:   data.lab_summary  || null,
        medications:   data.medications  ? [{ name: data.medications }] : [],
      })
    }

    return { caseId: referralCase.id, referenceNo: referralCase.reference_no }
  } catch (err: any) {
    console.error('[ReferrerIntake] Unexpected error:', err)
    return { error: 'Unexpected error. Please try again.' }
  }
}

// ── Notify specialist of new referral ─────────────────────────────────────
async function notifySpecialist(
  specialistId: string,
  data: Record<string, any>,
  referenceNo: string
) {
  const { data: spec } = await db
    .from('specialists')
    .select('whatsapp_number, name')
    .eq('id', specialistId)
    .single()

  if (!spec?.whatsapp_number) return

  const urgencyEmoji = data.urgency === 'emergency' ? '🚨' :
                       data.urgency === 'urgent'    ? '⚡' : '📋'

  const msg = `${urgencyEmoji} *New referral — ${referenceNo}*\n\nDr. ${spec.name},\n\nNew patient referred via WhatsApp:\n\n👤 ${data.patient_name}\n🩺 ${data.chief_complaint}\n⚡ ${(data.urgency || 'routine').toUpperCase()}\n${data.procedure_recommended ? `🔬 ${data.procedure_recommended}\n` : ''}
View case: ${process.env.NEXT_PUBLIC_APP_URL}/synthesis/${referenceNo}`

  const token         = process.env.WHATSAPP_API_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) return

  await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: spec.whatsapp_number.startsWith('+') ? spec.whatsapp_number : `+91${spec.whatsapp_number}`,
      type: 'text',
      text: { preview_url: false, body: msg },
    }),
  }).catch(e => console.error('[ReferrerIntake] Specialist notify error:', e))
}
