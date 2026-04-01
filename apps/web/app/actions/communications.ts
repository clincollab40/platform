'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient }                from '@supabase/supabase-js'
import { redirect }                    from 'next/navigation'
import { revalidatePath }              from 'next/cache'

type BR<T> = { ok: true; value: T } | { ok: false; error: string }
async function boundary<T>(name: string, fn: () => Promise<T>): Promise<BR<T>> {
  try   { return { ok: true, value: await fn() } }
  catch (e) { console.error(`[M9:${name}]`, e); return { ok: false, error: e instanceof Error ? e.message : String(e) } }
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

function dispatchEngine(action: string, payload: Record<string, any>) {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) return
  fetch(`${url}/api/communications`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
    body:    JSON.stringify({ action, ...payload }),
  }).catch(e => console.error('[M9] dispatch error:', e))
}

// ════════════════════════════════════════════════════════════
// STAKEHOLDER MANAGEMENT
// ════════════════════════════════════════════════════════════

export async function getStakeholdersAction(planId: string) {
  return boundary('get_stakeholders', async () => {
    const { supabase, specialist } = await getAuth()

    const { data } = await supabase
      .from('procedure_stakeholders')
      .select(`
        *,
        communication_threads (
          id, last_event_at, unread_count, total_messages,
          pending_confirmations, completed_confirmations
        )
      `)
      .eq('plan_id', planId)
      .eq('specialist_id', specialist.id)
      .order('sort_order')

    return data || []
  })
}

export async function addStakeholderAction(
  planId: string,
  role: string,
  name: string,
  mobile: string,
  designation?: string,
  notifyConfig?: Partial<{
    notify_on_schedule: boolean
    notify_d_minus_3: boolean
    notify_d_minus_1: boolean
    notify_d_day: boolean
    notify_post_procedure: boolean
    notify_discharge: boolean
  }>
) {
  return boundary('add_stakeholder', async () => {
    const { supabase, specialist } = await getAuth()

    const { data, error } = await supabase.from('procedure_stakeholders').insert({
      plan_id:      planId,
      specialist_id:specialist.id,
      role:         role as any,
      name,
      mobile:       mobile.trim() || null,
      designation:  designation || null,
      confirmation_required: !['referring_doctor','patient_nok'].includes(role),
      ...notifyConfig,
    }).select('id').single()

    if (error || !data) throw new Error('Could not add stakeholder')
    revalidatePath(`/procedures/${planId}/communications`)
    return { id: data.id }
  })
}

export async function updateStakeholderAction(stakeholderId: string, updates: Record<string, any>) {
  return boundary('update_stakeholder', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('procedure_stakeholders')
      .update(updates).eq('id', stakeholderId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not update stakeholder')
    return true
  })
}

export async function populateStakeholdersAction(planId: string) {
  return boundary('populate_stakeholders', async () => {
    const { supabase, specialist } = await getAuth()
    const { data } = await supabase.rpc('populate_stakeholders_for_plan', { p_plan_id: planId })
    revalidatePath(`/procedures/${planId}/communications`)
    return { count: data || 0 }
  })
}

// ════════════════════════════════════════════════════════════
// BROADCASTS
// ════════════════════════════════════════════════════════════

export async function broadcastAction(
  planId: string,
  event: string,
  rolesFilter?: string[],
  customMessage?: string
) {
  return boundary('broadcast', async () => {
    const { specialist } = await getAuth()
    dispatchEngine('broadcast', {
      planId, event, rolesFilter, customMessage,
      specialistId: specialist.id,
    })
    return { queued: true }
  })
}

export async function sendToStakeholderAction(
  planId: string,
  stakeholderId: string,
  message: string,
  requireConfirmation: boolean = false
) {
  return boundary('send_to_stakeholder', async () => {
    const { supabase, specialist } = await getAuth()

    const { data: stakeholder } = await supabase.from('procedure_stakeholders')
      .select('id, mobile, role, name').eq('id', stakeholderId).eq('specialist_id', specialist.id).single()
    if (!stakeholder) throw new Error('Stakeholder not found')
    if (!stakeholder.mobile) throw new Error('No mobile number for this stakeholder')

    dispatchEngine('send_to_one', {
      planId, stakeholderId, message, requireConfirmation,
      specialistId: specialist.id,
    })

    revalidatePath(`/procedures/${planId}/communications`)
    return { queued: true }
  })
}

// ════════════════════════════════════════════════════════════
// THREAD AND EVENT READS
// ════════════════════════════════════════════════════════════

export async function getThreadAction(planId: string, stakeholderId: string) {
  return boundary('get_thread', async () => {
    const { supabase, specialist } = await getAuth()

    const { data: thread } = await supabase
      .from('communication_threads')
      .select('*')
      .eq('plan_id', planId)
      .eq('stakeholder_id', stakeholderId)
      .eq('specialist_id', specialist.id)
      .single()

    if (!thread) return { events: [], confirmations: [] }

    const { data: events } = await supabase
      .from('communication_events')
      .select('*').eq('thread_id', thread.id)
      .order('created_at', { ascending: true }).limit(100)

    const { data: confirmations } = await supabase
      .from('confirmation_requests')
      .select('*').eq('plan_id', planId).eq('stakeholder_id', stakeholderId)
      .order('sent_at', { ascending: false }).limit(20)

    // Mark thread as read
    await supabase.from('communication_threads')
      .update({ unread_count: 0 }).eq('id', thread.id)

    return { thread, events: events || [], confirmations: confirmations || [] }
  })
}

export async function getCommsDashboardAction(planId: string) {
  return boundary('comms_dashboard', async () => {
    const { supabase, specialist } = await getAuth()

    const [stakeholders, confirmations, escalations, milestones, adherence] = await Promise.all([
      supabase.from('procedure_stakeholders')
        .select('id, role, name, status, mobile, last_contacted_at, confirmed_at, sort_order, communication_threads(unread_count, total_messages, pending_confirmations)')
        .eq('plan_id', planId).eq('specialist_id', specialist.id).order('sort_order'),

      supabase.from('confirmation_requests')
        .select('id, confirmation_type, stakeholder_id, response, is_resolved, sent_at, response_required_by, responded_at')
        .eq('plan_id', planId).eq('specialist_id', specialist.id)
        .order('sent_at', { ascending: false }).limit(50),

      supabase.from('escalation_events')
        .select('id, trigger_event, action_taken, created_at, resolved, resolution')
        .eq('plan_id', planId).eq('specialist_id', specialist.id)
        .order('created_at', { ascending: false }).limit(20),

      supabase.from('post_procedure_milestones')
        .select('id, milestone_name, milestone_label, status, reached_at, sequence_order, notify_patient, notify_referring_doctor')
        .eq('plan_id', planId).eq('specialist_id', specialist.id)
        .order('sequence_order'),

      supabase.from('patient_adherence_log')
        .select('id, check_date, check_type, item_checked, is_adherent, clinical_action')
        .eq('plan_id', planId).eq('specialist_id', specialist.id)
        .order('check_date', { ascending: false }).limit(20),
    ])

    return {
      stakeholders:  stakeholders.data  || [],
      confirmations: confirmations.data || [],
      escalations:   escalations.data   || [],
      milestones:    milestones.data     || [],
      adherence:     adherence.data      || [],
    }
  })
}

// ════════════════════════════════════════════════════════════
// CONFIRMATIONS
// ════════════════════════════════════════════════════════════

export async function overrideConfirmationAction(
  confirmationId: string,
  override: 'yes' | 'no' | 'partial',
  reason: string
) {
  return boundary('override_confirm', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('confirmation_requests')
      .update({
        response:      override,
        is_resolved:   true,
        resolved_by:   'specialist_override',
        override_reason: reason,
        responded_at:  new Date().toISOString(),
      })
      .eq('id', confirmationId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not override confirmation')
    return true
  })
}

// ════════════════════════════════════════════════════════════
// MILESTONES
// ════════════════════════════════════════════════════════════

export async function recordMilestoneAction(
  planId: string,
  milestoneName: string,
  milestoneLabel: string,
  sequenceOrder: number,
  options: {
    clinicalNotes?: string
    vitalsSummary?: string
    medicationChanges?: string
    notifyPatient?: boolean
    notifyReferrer?: boolean
    patientMessage?: string
    referrerMessage?: string
  }
) {
  return boundary('record_milestone', async () => {
    const { specialist } = await getAuth()
    dispatchEngine('record_milestone', {
      planId, milestoneName, milestoneLabel, sequenceOrder, options,
      specialistId: specialist.id,
    })
    revalidatePath(`/procedures/${planId}/communications`)
    return { queued: true }
  })
}

export async function resolveEscalationAction(escalationId: string, resolution: string) {
  return boundary('resolve_escalation', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('escalation_events')
      .update({
        resolved:     true,
        resolution,
        resolved_by:  specialist.id,
        resolved_at:  new Date().toISOString(),
      })
      .eq('id', escalationId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not resolve escalation')
    return true
  })
}
