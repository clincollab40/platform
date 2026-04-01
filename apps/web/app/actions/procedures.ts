'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient }                from '@supabase/supabase-js'
import { redirect }                    from 'next/navigation'
import { revalidatePath }              from 'next/cache'
import crypto                          from 'crypto'

type BR<T> = { ok: true; value: T } | { ok: false; error: string }
async function boundary<T>(name: string, fn: () => Promise<T>): Promise<BR<T>> {
  try   { return { ok: true, value: await fn() } }
  catch (e) { console.error(`[M8:${name}]`, e); return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

async function getAuth() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const { data: s } = await supabase.from('specialists')
    .select('id, name, specialty, whatsapp_number').eq('google_id', user.id).single()
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

// ════════════════════════════════════════════════════════════
// PROTOCOLS
// ════════════════════════════════════════════════════════════

export async function listProtocolDefaultsAction() {
  return boundary('list_defaults', async () => {
    const { supabase } = await getAuth()
    const { data } = await supabase
      .from('procedure_protocol_defaults')
      .select('id, specialty, procedure_name, procedure_code, description, ot_room_type, estimated_duration_mins, anaesthesia_type')
      .order('specialty')
    return data || []
  })
}

export async function createProtocolAction(formData: FormData) {
  return boundary('create_protocol', async () => {
    const { supabase, specialist } = await getAuth()

    const name       = (formData.get('procedure_name') as string)?.trim()
    const defaultId  = formData.get('default_id') as string | null

    if (!name) throw new Error('Procedure name required')

    let defaultData: any = {}
    if (defaultId) {
      const { data: def } = await supabase.from('procedure_protocol_defaults')
        .select('*').eq('id', defaultId).single()
      if (def) defaultData = def
    }

    const { data, error } = await supabase.from('procedure_protocols').insert({
      specialist_id:      specialist.id,
      procedure_name:     name,
      procedure_code:     (formData.get('procedure_code') as string)?.toUpperCase() || defaultData.procedure_code,
      specialty_context:  specialist.specialty,
      ot_room_type:       formData.get('ot_room_type') as string || defaultData.ot_room_type,
      estimated_duration_mins: parseInt(formData.get('duration') as string) || defaultData.estimated_duration_mins,
      anaesthesia_type:   formData.get('anaesthesia_type') as string || defaultData.anaesthesia_type,
      workup_items:       defaultData.workup_items        || [],
      medication_holds:   defaultData.medication_holds    || [],
      standard_resources: defaultData.standard_resources  || [],
      prep_instructions:  defaultData.prep_instructions   || [],
      alert_templates:    defaultData.alert_templates      || [],
      consent_items:      defaultData.consent_items        || [],
      checklist_items:    defaultData.checklist_items      || [],
      post_procedure_plan:defaultData.post_procedure_plan  || [],
    }).select('id').single()

    if (error || !data) throw new Error('Could not create protocol')
    revalidatePath('/procedures/protocols')
    return { id: data.id }
  })
}

export async function saveProtocolAction(protocolId: string, updates: Record<string, any>) {
  return boundary('save_protocol', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('procedure_protocols')
      .update(updates).eq('id', protocolId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not save protocol')
    revalidatePath('/procedures/protocols')
    return true
  })
}

export async function listProtocolsAction() {
  return boundary('list_protocols', async () => {
    const { supabase, specialist } = await getAuth()
    const { data } = await supabase.from('procedure_protocols')
      .select('id, procedure_name, procedure_code, ot_room_type, estimated_duration_mins, anaesthesia_type, is_active, version')
      .eq('specialist_id', specialist.id).eq('is_active', true).order('procedure_name')
    return data || []
  })
}

// ════════════════════════════════════════════════════════════
// PROCEDURE PLANS
// ════════════════════════════════════════════════════════════

export async function createPlanAction(formData: FormData) {
  return boundary('create_plan', async () => {
    const { supabase, specialist } = await getAuth()

    const patientName   = (formData.get('patient_name') as string)?.trim()
    const procedureName = (formData.get('procedure_name') as string)?.trim()
    const indication    = (formData.get('indication') as string)?.trim()
    const protocolId    = formData.get('protocol_id') as string | null

    if (!patientName || !procedureName || !indication)
      throw new Error('Patient name, procedure name, and indication are required')

    const { data: plan, error } = await supabase.from('procedure_plans').insert({
      specialist_id:    specialist.id,
      protocol_id:      protocolId || null,
      patient_name:     patientName,
      patient_mobile:   (formData.get('patient_mobile') as string)?.trim() || null,
      patient_age:      parseInt(formData.get('patient_age') as string) || null,
      patient_gender:   formData.get('patient_gender') as string || null,
      procedure_name:   procedureName,
      procedure_code:   (formData.get('procedure_code') as string)?.toUpperCase() || null,
      indication,
      urgency:          formData.get('urgency') as string || 'elective',
      referral_case_id: formData.get('referral_case_id') as string || null,
      appointment_id:   formData.get('appointment_id') as string || null,
    }).select('id').single()

    if (error || !plan) throw new Error('Could not create procedure plan')

    // Auto-populate from protocol if provided
    if (protocolId) {
      await supabase.rpc('populate_plan_from_protocol', {
        p_plan_id: plan.id, p_protocol_id: protocolId
      })
    }

    revalidatePath('/procedures')
    return { id: plan.id }
  })
}

export async function updatePlanAction(planId: string, updates: Record<string, any>) {
  return boundary('update_plan', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('procedure_plans')
      .update(updates).eq('id', planId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not update plan')
    revalidatePath(`/procedures/${planId}`)
    return true
  })
}

export async function listPlansAction(status?: string) {
  return boundary('list_plans', async () => {
    const { supabase, specialist } = await getAuth()
    let query = supabase.from('procedure_plans')
      .select(`
        id, patient_name, procedure_name, urgency, status,
        scheduled_date, scheduled_time, consent_status,
        workup_complete, resources_confirmed, patient_ready,
        created_at,
        procedure_protocols ( procedure_code, ot_room_type )
      `)
      .eq('specialist_id', specialist.id)
      .order('scheduled_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data } = await query.limit(100)
    return data || []
  })
}

export async function getPlanAction(planId: string) {
  return boundary('get_plan', async () => {
    const { supabase, specialist } = await getAuth()
    const { data } = await supabase.from('procedure_plans')
      .select(`
        *,
        procedure_protocols(*),
        procedure_resources( * ),
        procedure_workup( * ),
        procedure_medication_holds( * ),
        patient_care_plans( * ),
        procedure_consent( * ),
        procedure_checklist_responses( * )
      `)
      .eq('id', planId).eq('specialist_id', specialist.id).single()
    if (!data) throw new Error('Plan not found')
    return data
  })
}

// ════════════════════════════════════════════════════════════
// WORKUP MANAGEMENT
// ════════════════════════════════════════════════════════════

export async function updateWorkupItemAction(
  itemId: string,
  updates: { status?: string; result_value?: string; result_date?: string; is_abnormal?: boolean; abnormal_action?: string; notes?: string; waived_reason?: string }
) {
  return boundary('update_workup', async () => {
    const { supabase, specialist } = await getAuth()

    const finalUpdates: any = { ...updates }
    if (updates.status === 'reviewed_normal' || updates.status === 'reviewed_acceptable' ||
        updates.status === 'reviewed_abnormal') {
      finalUpdates.reviewed_by = specialist.id
      finalUpdates.reviewed_at = new Date().toISOString()
    }

    const { error } = await supabase.from('procedure_workup')
      .update(finalUpdates).eq('id', itemId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not update workup item')
    return true
  })
}

export async function addWorkupItemAction(planId: string, investigation: string, category: string, mandatory: boolean) {
  return boundary('add_workup', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('procedure_workup').insert({
      plan_id: planId, specialist_id: specialist.id,
      investigation, category, mandatory, status: 'not_ordered'
    })
    if (error) throw new Error('Could not add workup item')
    revalidatePath(`/procedures/${planId}`)
    return true
  })
}

// ════════════════════════════════════════════════════════════
// RESOURCE MANAGEMENT
// ════════════════════════════════════════════════════════════

export async function updateResourceAction(resourceId: string, status: string, confirmedBy?: string, notes?: string) {
  return boundary('update_resource', async () => {
    const { supabase, specialist } = await getAuth()
    const updates: any = { status }
    if (status === 'confirmed') {
      updates.confirmed_by = confirmedBy || specialist.name
      updates.confirmed_at = new Date().toISOString()
    }
    if (notes) updates.notes = notes
    const { error } = await supabase.from('procedure_resources')
      .update(updates).eq('id', resourceId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not update resource')
    return true
  })
}

export async function addResourceAction(planId: string, resource: {
  resource_type: string; name: string; quantity?: number; specification?: string; mandatory?: boolean; notes?: string
}) {
  return boundary('add_resource', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('procedure_resources').insert({
      plan_id: planId, specialist_id: specialist.id,
      resource_type: resource.resource_type as any,
      name: resource.name,
      quantity: resource.quantity || 1,
      specification: resource.specification || null,
      mandatory: resource.mandatory ?? true,
      notes: resource.notes || null,
      status: 'required',
    })
    if (error) throw new Error('Could not add resource')
    revalidatePath(`/procedures/${planId}`)
    return true
  })
}

// ════════════════════════════════════════════════════════════
// CONSENT
// ════════════════════════════════════════════════════════════

export async function updateConsentAction(planId: string, updates: Record<string, any>) {
  return boundary('update_consent', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('procedure_consent')
      .update(updates).eq('plan_id', planId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not update consent')

    // If consent is signed, update plan status
    if (updates.form_signed) {
      await supabase.from('procedure_plans')
        .update({ consent_status: 'signed', consent_signed_at: new Date().toISOString() })
        .eq('id', planId).eq('specialist_id', specialist.id)
    }

    revalidatePath(`/procedures/${planId}`)
    return true
  })
}

// ════════════════════════════════════════════════════════════
// CARE PLAN DELIVERY
// ════════════════════════════════════════════════════════════

export async function saveCareplanAction(planId: string, carePlanData: Record<string, any>) {
  return boundary('save_careplan', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('patient_care_plans')
      .update(carePlanData).eq('plan_id', planId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not save care plan')
    revalidatePath(`/procedures/${planId}`)
    return true
  })
}

export async function sendCarePlanAlertAction(planId: string, stage: string, customMessage?: string) {
  return boundary('send_alert', async () => {
    const { supabase, specialist } = await getAuth()

    const { data: plan } = await supabase.from('procedure_plans')
      .select(`patient_name, patient_mobile, procedure_name, scheduled_date, scheduled_time,
               patient_care_plans(*)`)
      .eq('id', planId).eq('specialist_id', specialist.id).single()

    if (!plan) throw new Error('Plan not found')
    if (!plan.patient_mobile) throw new Error('No patient mobile — cannot send alert')

    const carePlan = (plan.patient_care_plans as any)?.[0]

    // Build message based on stage
    const msg = customMessage || buildAlertMessage(stage, {
      patientName:    plan.patient_name,
      procedureName:  plan.procedure_name,
      scheduledDate:  plan.scheduled_date,
      scheduledTime:  plan.scheduled_time,
      specialistName: specialist.name,
      carePlan,
    })

    // Send WhatsApp
    const token = process.env.WHATSAPP_API_TOKEN
    const numId  = process.env.WHATSAPP_PHONE_NUMBER_ID
    const digits = plan.patient_mobile.replace(/\D/g, '')
    const to     = digits.startsWith('91') ? `+${digits}` : `+91${digits}`

    if (token && numId) {
      await fetch(`https://graph.facebook.com/v19.0/${numId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', recipient_type: 'individual', to,
          type: 'text', text: { preview_url: false, body: msg },
        }),
      })
    } else {
      console.log('[M8 WA dry-run]', to, msg.slice(0, 100))
    }

    // Log the alert
    await supabase.from('procedure_alert_log').insert({
      plan_id:        planId,
      specialist_id:  specialist.id,
      alert_stage:    stage as any,
      recipient_type: 'patient',
      channel:        'whatsapp',
      message_preview:msg.slice(0, 200),
      delivered_at:   new Date().toISOString(),
      scheduled_for:  new Date().toISOString(),
    })

    // Update care plan last sent
    await supabase.from('patient_care_plans')
      .update({ last_sent_at: new Date().toISOString() })
      .eq('plan_id', planId)

    return { sent: true, to }
  })
}

function buildAlertMessage(stage: string, ctx: any): string {
  const { patientName, procedureName, scheduledDate, scheduledTime, specialistName, carePlan } = ctx

  const formattedDate = scheduledDate
    ? new Date(scheduledDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : 'date to be confirmed'

  const msgs: Record<string, string> = {
    d_minus_7: `ClinCollab — Procedure reminder\n\nDear ${patientName},\n\nThis is a reminder that your ${procedureName} with Dr. ${specialistName} is scheduled for ${formattedDate}.\n\n${carePlan?.fasting_instructions ? `IMPORTANT:\n${carePlan.fasting_instructions}\n\n` : ''}${carePlan?.what_to_bring ? `Please bring:\n${carePlan.what_to_bring}\n\n` : ''}If you have any questions, contact our clinic.`,

    d_minus_1: `ClinCollab — PROCEDURE TOMORROW\n\nDear ${patientName},\n\nYour ${procedureName} is TOMORROW — ${formattedDate}.\n\n${carePlan?.fasting_instructions ? `🔴 FASTING INSTRUCTIONS:\n${carePlan.fasting_instructions}\n\n` : 'Do not eat or drink anything after midnight tonight.\n\n'}${carePlan?.what_to_bring ? `Bring with you:\n${carePlan.what_to_bring}\n\n` : ''}${carePlan?.arrival_instructions ? `Arrival:\n${carePlan.arrival_instructions}\n\n` : ''}Contact the clinic coordinator if you have any concerns.`,

    d_day_morning: `ClinCollab — PROCEDURE TODAY\n\nDear ${patientName},\n\nToday is the day of your ${procedureName} at ${scheduledTime || 'the scheduled time'}.\n\n${carePlan?.arrival_instructions ? carePlan.arrival_instructions + '\n\n' : ''}Bring all your investigation reports, ID proof, and a family member.\n\nIf you have any emergency, call 112.`,

    post_procedure_24h: `ClinCollab — Post-procedure check-in\n\nDear ${patientName},\n\nWe hope you are recovering well from your ${procedureName}.\n\n${carePlan?.red_flags ? `Please come to emergency IMMEDIATELY if you develop:\n${carePlan.red_flags}\n\n` : ''}${carePlan?.post_procedure_instructions ? carePlan.post_procedure_instructions + '\n\n' : ''}Contact Dr. ${specialistName}'s clinic with any questions.`,

    post_procedure_7d: `ClinCollab — Follow-up reminder\n\nDear ${patientName},\n\nIt has been one week since your ${procedureName}. Please ensure:\n\n• All medications being taken as prescribed\n• Wound site clean and healing\n\nYour follow-up appointment is due. Please contact the clinic to confirm the date and time.`,
  }

  return msgs[stage] || `ClinCollab — ${procedureName} update for ${patientName}. Please contact Dr. ${specialistName}'s clinic for any queries.`
}

// ════════════════════════════════════════════════════════════
// CHECKLIST
// ════════════════════════════════════════════════════════════

export async function submitChecklistAction(planId: string, checklistType: string, items: any[], anyConcerns?: string) {
  return boundary('submit_checklist', async () => {
    const { supabase, specialist } = await getAuth()

    await supabase.from('procedure_checklist_responses').insert({
      plan_id: planId, specialist_id: specialist.id,
      checklist_type: checklistType, items,
      completed_by: specialist.id,
      completed_at: new Date().toISOString(),
      any_concerns: anyConcerns || null,
    })

    // If sign_out checklist complete, mark procedure as completed
    if (checklistType === 'sign_out') {
      await supabase.from('procedure_plans')
        .update({ checklist_completed_at: new Date().toISOString(), status: 'in_progress' })
        .eq('id', planId).eq('specialist_id', specialist.id)
    }

    revalidatePath(`/procedures/${planId}`)
    return true
  })
}

// ════════════════════════════════════════════════════════════
// PLAN READINESS CHECK
// ════════════════════════════════════════════════════════════

export async function checkPlanReadinessAction(planId: string) {
  return boundary('check_readiness', async () => {
    const { supabase, specialist } = await getAuth()

    const { data: plan } = await supabase.from('procedure_plans')
      .select(`
        id, status, scheduled_date, consent_status, workup_complete, resources_confirmed,
        procedure_workup( id, mandatory, status ),
        procedure_resources( id, mandatory, status ),
        procedure_consent( form_signed )
      `)
      .eq('id', planId).eq('specialist_id', specialist.id).single()

    if (!plan) throw new Error('Plan not found')

    const workupItems     = (plan.procedure_workup as any[]) || []
    const resources       = (plan.procedure_resources as any[]) || []
    const consent         = (plan.procedure_consent as any[])?.[0]

    const pendingWorkup   = workupItems.filter((w: any) => w.mandatory && !['reviewed_normal','reviewed_acceptable','reviewed_abnormal','waived'].includes(w.status))
    const pendingResources= resources.filter((r: any) => r.mandatory && !['confirmed','not_needed'].includes(r.status))
    const consentSigned   = consent?.form_signed === true

    const allGreen = pendingWorkup.length === 0 && pendingResources.length === 0 && consentSigned

    if (allGreen && plan.status === 'workup_complete') {
      await supabase.from('procedure_plans')
        .update({ status: 'ready_for_procedure', patient_ready: true })
        .eq('id', planId)
    }

    return {
      ready:            allGreen,
      pendingWorkupCount:  pendingWorkup.length,
      pendingResourceCount:pendingResources.length,
      consentSigned,
      scheduledDate:    plan.scheduled_date,
    }
  })
}

export async function completeProcedureAction(planId: string, outcome: string, outcomeNotes?: string, actualDurationMins?: number) {
  return boundary('complete_procedure', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('procedure_plans')
      .update({
        status:               'completed',
        outcome,
        outcome_notes:        outcomeNotes || null,
        actual_duration_mins: actualDurationMins || null,
        completed_at:         new Date().toISOString(),
      })
      .eq('id', planId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not mark complete')
    revalidatePath(`/procedures/${planId}`)
    revalidatePath('/procedures')
    return true
  })
}
