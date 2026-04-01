/**
 * ClinCollab — Communication Engine
 * Module 9: Closed-Loop Procedural Communication
 *
 * Responsibilities:
 * 1. Send structured communications to all stakeholders for a procedure plan
 * 2. Parse inbound WhatsApp replies as confirmations (YES/NO/ARRIVED/etc.)
 * 3. Track confirmation status with SLA windows
 * 4. Fire escalations when confirmations are overdue or non-adherence detected
 * 5. Post-procedure milestone communications to patient and referring doctor
 *
 * Architecture:
 * - Pure service: no direct imports from module action files
 * - All outbound comms via notification-bus (single channel)
 * - Inbound replies routed here by the M4 WhatsApp webhook (extended)
 * - Every send and every reply is immutably logged
 * - Circuit breaker on WhatsApp API
 */

import { createClient } from '@supabase/supabase-js'
import { dispatch }     from '../../packages/notification-bus'
import { moduleBoundary, callExternalService, log } from '../../packages/shared-utils/resilience'
import { ok, err }      from '../../packages/types'
import type { Result }  from '../../packages/types'

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// ── Types ──────────────────────────────────────────────────────
export type TriggerEvent =
  | 'procedure_scheduled'
  | 'd_minus_3_prep_check'
  | 'd_minus_1_fasting'
  | 'd_day_morning_check'
  | 'procedure_completed'
  | 'patient_discharged'
  | 'icu_to_ward'
  | 'custom'

export interface BroadcastOptions {
  planId:       string
  event:        TriggerEvent
  rolesFilter?: string[]          // if omitted, all stakeholders
  customMessage?: string
  requireConfirmation?: boolean
  confirmationType?: string
  confirmationSlaHours?: number
}

export interface InboundReply {
  fromMobile:   string
  messageText:  string
  waMessageId:  string
  receivedAt:   string
}

export interface ParsedReply {
  intent:  'confirm_yes' | 'confirm_no' | 'arrived' | 'query' | 'distress' | 'unknown'
  value:   string | null
  raw:     string
}

// ── Placeholder resolver ───────────────────────────────────────
function resolvePlaceholders(
  template: string,
  vars: Record<string, string | null | undefined>
): string {
  return template.replace(/\[([A-Z_]+)\]/g, (_, key) => {
    const val = vars[key]
    return val != null ? String(val) : `[${key}]`
  })
}

// ── Build context vars from plan ───────────────────────────────
async function buildPlanVars(
  planId: string,
  sc: ReturnType<typeof svc>
): Promise<Record<string, string | null>> {
  const { data: plan } = await sc
    .from('procedure_plans')
    .select(`
      patient_name, patient_mobile, procedure_name, procedure_code,
      scheduled_date, scheduled_time, admit_date, estimated_los_days,
      anaesthesiologist_name, anaesthesiologist_mobile,
      ot_room_type, ot_room_number, anaesthesia_type,
      estimated_duration_mins, asa_grade, comorbidities, allergies,
      specialists ( name, whatsapp_number ),
      procedure_protocols ( procedure_code )
    `)
    .eq('id', planId).single()

  if (!plan) return {}

  const specialist = (plan.specialists as any)

  return {
    PATIENT_NAME:      plan.patient_name,
    PATIENT_MOBILE:    plan.patient_mobile,
    PROCEDURE_NAME:    plan.procedure_name,
    PROCEDURE_DATE:    plan.scheduled_date
      ? new Date(plan.scheduled_date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : null,
    PROCEDURE_DATE_SHORT: plan.scheduled_date,
    PROCEDURE_TIME:    plan.scheduled_time || null,
    ADMIT_DATE:        plan.admit_date
      ? new Date(plan.admit_date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
      : null,
    OT_ROOM:           plan.ot_room_number || plan.ot_room_type || null,
    OT_ROOM_TYPE:      plan.ot_room_type || null,
    ANAESTHESIA_TYPE:  plan.anaesthesia_type || null,
    DURATION:          plan.estimated_duration_mins?.toString() || null,
    ANAES_NAME:        plan.anaesthesiologist_name || null,
    ANAES_MOBILE:      plan.anaesthesiologist_mobile || null,
    ASA_GRADE:         plan.asa_grade?.toString() || 'Not assessed',
    COMORBIDITIES:     Array.isArray(plan.comorbidities) && plan.comorbidities.length > 0
                        ? plan.comorbidities.join(', ')
                        : 'None documented',
    ALLERGIES:         plan.allergies || 'None known',
    SPECIALIST_NAME:   specialist?.name || null,
    SPECIALIST_MOBILE: specialist?.whatsapp_number || null,
    EXPECTED_LOS:      plan.estimated_los_days ? `${plan.estimated_los_days} days` : null,
  }
}

// ── Core broadcast function ────────────────────────────────────
export async function broadcastToStakeholders(
  opts: BroadcastOptions
): Promise<Result<{ sent: number; failed: number }>> {
  return moduleBoundary('M9:broadcast', async () => {
    const sc = svc()
    const planVars = await buildPlanVars(opts.planId, sc)

    // Fetch target stakeholders
    let query = sc
      .from('procedure_stakeholders')
      .select('*')
      .eq('plan_id', opts.planId)
      .not('mobile', 'is', null)

    if (opts.rolesFilter && opts.rolesFilter.length > 0) {
      query = query.in('role', opts.rolesFilter)
    }

    const { data: stakeholders } = await query

    if (!stakeholders || stakeholders.length === 0) {
      log('warn', 'M9', 'broadcast_no_stakeholders', { planId: opts.planId, event: opts.event })
      return { sent: 0, failed: 0 }
    }

    // Fetch plan specialist info
    const { data: plan } = await sc
      .from('procedure_plans')
      .select('specialist_id, referral_case_id')
      .eq('id', opts.planId).single()

    if (!plan) throw new Error('Plan not found')

    let sent = 0
    let failed = 0

    for (const stakeholder of stakeholders) {
      try {
        // Get or create thread
        const { data: thread } = await sc
          .from('communication_threads')
          .upsert({
            plan_id: opts.planId,
            stakeholder_id: stakeholder.id,
            specialist_id: plan.specialist_id,
          }, { onConflict: 'plan_id,stakeholder_id' })
          .select('id').single()

        // Find template for this role and event
        const { data: template } = await sc
          .from('communication_templates')
          .select('*')
          .or(`specialist_id.eq.${plan.specialist_id},specialist_id.is.null`)
          .eq('role', stakeholder.role)
          .eq('trigger_event', opts.event)
          .eq('is_active', true)
          .order('specialist_id', { nullsLast: true })  // prefer specialist's own template
          .limit(1).single()

        // Build message
        const messageText = opts.customMessage
          || (template
              ? resolvePlaceholders(template.message_template, planVars)
              : buildFallbackMessage(opts.event, stakeholder.role, planVars))

        if (!messageText) { failed++; continue }

        // Send via notification bus
        const result = await dispatch({
          module:           'M9',
          specialist_id:    plan.specialist_id,
          recipient_type:   stakeholder.role === 'patient' ? 'patient'
                            : stakeholder.role === 'referring_doctor' ? 'referring_doctor'
                            : 'specialist',
          recipient_mobile: stakeholder.mobile!,
          message:          messageText,
          idempotency_key:  `M9:${opts.planId}:${stakeholder.id}:${opts.event}`,
        })

        // Log the event
        let confirmRequestId: string | null = null

        if (template?.is_confirmation_request || opts.requireConfirmation) {
          const slaHours = opts.confirmationSlaHours || 24
          const { data: confReq } = await sc.from('confirmation_requests').insert({
            thread_id:        thread?.id,
            plan_id:          opts.planId,
            stakeholder_id:   stakeholder.id,
            specialist_id:    plan.specialist_id,
            confirmation_type:(opts.confirmationType || template?.confirmation_type || 'custom') as any,
            question_text:    messageText.split('\n').slice(0, 2).join('\n'),
            expected_response:template?.expected_response_hint || null,
            response_required_by: new Date(Date.now() + slaHours * 3600000).toISOString(),
          }).select('id').single()

          confirmRequestId = confReq?.id || null
        }

        await sc.from('communication_events').insert({
          thread_id:              thread?.id,
          plan_id:                opts.planId,
          stakeholder_id:         stakeholder.id,
          specialist_id:          plan.specialist_id,
          direction:              'outbound',
          channel:                'whatsapp',
          message_text:           messageText,
          is_automated:           true,
          delivered:              result.ok,
          delivered_at:           result.ok ? new Date().toISOString() : null,
          confirmation_request_id:confirmRequestId,
        })

        // Update stakeholder last contacted
        await sc.from('procedure_stakeholders').update({
          last_contacted_at: new Date().toISOString(),
          status: stakeholder.status === 'pending' ? 'notified' : stakeholder.status,
        }).eq('id', stakeholder.id)

        if (result.ok) sent++
        else failed++

      } catch (e) {
        log('error', 'M9', 'broadcast_stakeholder_error', {
          stakeholderId: stakeholder.id, error: String(e)
        })
        failed++
      }
    }

    log('info', 'M9', 'broadcast_complete', {
      planId: opts.planId, event: opts.event, sent, failed,
    })

    return { sent, failed }
  })
}

// ── Inbound reply processor ────────────────────────────────────
export async function processInboundReply(
  reply: InboundReply,
  specialistId: string
): Promise<Result<{ planId: string | null; intent: string; resolved: boolean }>> {
  return moduleBoundary('M9:inbound', async () => {
    const sc = svc()

    const parsed = parseReplyIntent(reply.messageText)

    // Find stakeholder by mobile
    const { data: stakeholder } = await sc
      .from('procedure_stakeholders')
      .select(`
        id, plan_id, role, status, name,
        communication_threads ( id, pending_confirmations )
      `)
      .eq('specialist_id', specialistId)
      .eq('mobile', reply.fromMobile)
      .order('created_at', { ascending: false })
      .limit(1).single()

    if (!stakeholder) {
      log('info', 'M9', 'inbound_no_stakeholder_found', { mobile: reply.fromMobile.slice(-4) })
      return { planId: null, intent: parsed.intent, resolved: false }
    }

    const thread = (stakeholder.communication_threads as any[])?.[0]

    // Log the inbound event
    if (thread) {
      await sc.from('communication_events').insert({
        thread_id:     thread.id,
        plan_id:       stakeholder.plan_id,
        stakeholder_id:stakeholder.id,
        specialist_id: specialistId,
        direction:     'inbound',
        channel:       'whatsapp',
        message_text:  reply.messageText,
        whatsapp_msg_id: reply.waMessageId,
        is_automated:  false,
        parsed_intent: parsed.intent,
        parsed_value:  parsed.value,
        delivered:     true,
        delivered_at:  reply.receivedAt,
      })
    }

    // Find the pending confirmation for this stakeholder
    const { data: pendingConfirm } = await sc
      .from('confirmation_requests')
      .select('id, confirmation_type, question_text')
      .eq('plan_id', stakeholder.plan_id)
      .eq('stakeholder_id', stakeholder.id)
      .eq('is_resolved', false)
      .order('sent_at', { ascending: false })
      .limit(1).single()

    let resolved = false

    if (pendingConfirm) {
      const response = mapIntentToResponse(parsed.intent)

      await sc.from('confirmation_requests').update({
        response,
        response_text: reply.messageText,
        responded_at:  reply.receivedAt,
        is_resolved:   true,
        resolved_by:   'stakeholder_reply',
      }).eq('id', pendingConfirm.id)

      resolved = true

      // Update stakeholder status
      const newStatus = response === 'yes' ? 'confirmed'
                      : response === 'no'  ? 'declined'
                      : 'confirmed'

      await sc.from('procedure_stakeholders').update({
        status:       newStatus,
        confirmed_at: response === 'yes' ? reply.receivedAt : null,
      }).eq('id', stakeholder.id)

      // Handle special cases
      if (stakeholder.role === 'patient') {
        await handlePatientResponse(stakeholder, pendingConfirm, parsed, specialistId, sc)
      }

      if (stakeholder.role === 'anaesthesiologist' && response === 'no') {
        await triggerEscalation(stakeholder.plan_id, specialistId, 'stakeholder_declined', 'anaesthesiologist', sc)
      }
    }

    // Special: patient says ARRIVED
    if (parsed.intent === 'arrived') {
      await sc.from('procedure_plans').update({
        status: 'workup_complete',  // or whatever the next state is
      }).eq('id', stakeholder.plan_id).eq('status', 'ready_for_procedure')

      await sendAcknowledgement(stakeholder, 'arrived', specialistId, sc)
    }

    // Special: patient signals distress
    if (parsed.intent === 'distress') {
      await triggerEscalation(stakeholder.plan_id, specialistId, 'patient_distress', 'patient', sc)
      await sendAcknowledgement(stakeholder, 'distress', specialistId, sc)
    }

    return { planId: stakeholder.plan_id, intent: parsed.intent, resolved }
  })
}

// ── Reply intent parser ────────────────────────────────────────
export function parseReplyIntent(text: string): ParsedReply {
  const lower = text.trim().toLowerCase()

  // Direct confirmations
  if (/^(yes|1|confirmed|confirm|done|ok|okay|haan|ha|ji|yes doctor|yes sir|yes madam|✓|✅)$/i.test(lower)) {
    return { intent: 'confirm_yes', value: 'yes', raw: text }
  }

  if (/^(no|2|nahi|nope|cant|cannot|not done|not yet|no doctor)$/i.test(lower)) {
    return { intent: 'confirm_no', value: 'no', raw: text }
  }

  if (/^(arrived|here|reach|reached|i am here|i've arrived|aa gaya|aa gayi|hospital mein)$/i.test(lower)) {
    return { intent: 'arrived', value: 'arrived', raw: text }
  }

  // Distress signals
  if (/\b(help|emergency|pain|chest|breathless|bleeding|doctor please|urgent|not well|feeling sick|scared|worried)\b/i.test(lower)) {
    return { intent: 'distress', value: lower, raw: text }
  }

  // Query / question
  if (/^(3|query|\?|what|how|when|where|can i|should i|is it|will)/.test(lower) || lower.includes('?')) {
    return { intent: 'query', value: lower, raw: text }
  }

  // Partial confirmation with issue
  if (/(not done|haven't done|didn't|missed|forgot|took my|still taking)/.test(lower)) {
    return { intent: 'confirm_no', value: lower, raw: text }
  }

  return { intent: 'unknown', value: null, raw: text }
}

function mapIntentToResponse(intent: string): 'yes' | 'no' | 'partial' | 'pending' {
  if (intent === 'confirm_yes' || intent === 'arrived') return 'yes'
  if (intent === 'confirm_no') return 'no'
  if (intent === 'query') return 'partial'
  return 'pending'
}

// ── Patient response handler ───────────────────────────────────
async function handlePatientResponse(
  stakeholder: any,
  confirmation: any,
  parsed: ParsedReply,
  specialistId: string,
  sc: ReturnType<typeof svc>
) {
  // Log adherence
  const isAdherent = parsed.intent === 'confirm_yes'

  await sc.from('patient_adherence_log').insert({
    plan_id:         stakeholder.plan_id,
    specialist_id:   specialistId,
    stakeholder_id:  stakeholder.id,
    check_date:      new Date().toISOString().split('T')[0],
    check_type:      confirmation.confirmation_type,
    item_checked:    confirmation.question_text.slice(0, 200),
    patient_response:parsed.raw,
    is_adherent:     isAdherent,
    non_adherence_detail: isAdherent ? null : parsed.value,
  })

  // Non-adherence: escalate immediately
  if (!isAdherent) {
    await triggerEscalation(stakeholder.plan_id, specialistId, 'patient_non_adherent', 'patient', sc)
  }
}

// ── Escalation trigger ─────────────────────────────────────────
async function triggerEscalation(
  planId: string,
  specialistId: string,
  triggerEvent: string,
  triggerRole: string,
  sc: ReturnType<typeof svc>
): Promise<void> {
  // Find matching escalation rule
  const { data: rule } = await sc
    .from('escalation_rules')
    .select('*')
    .eq('plan_id', planId)
    .eq('trigger_event', triggerEvent)
    .eq('is_active', true)
    .order('priority')
    .limit(1).single()

  const action = rule?.action || 'notify_specialist'

  // Log escalation event
  const { data: escalation } = await sc.from('escalation_events').insert({
    rule_id:          rule?.id || null,
    plan_id:          planId,
    specialist_id:    specialistId,
    trigger_event:    triggerEvent,
    action_taken:     action as any,
    action_detail:    `Triggered by: ${triggerRole}`,
    notified_roles:   [action.includes('specialist') ? 'specialist_self' : 'ot_coordinator'],
    specialist_notified: action.includes('specialist'),
    coordinator_notified: action.includes('coordinator'),
  }).select('id').single()

  // Notify the specialist
  const { data: specialist } = await sc
    .from('specialists')
    .select('name, whatsapp_number')
    .eq('id', specialistId).single()

  const { data: plan } = await sc
    .from('procedure_plans')
    .select('patient_name, procedure_name, scheduled_date')
    .eq('id', planId).single()

  if (!specialist?.whatsapp_number || !plan) return

  const escalationMessages: Record<string, string> = {
    patient_non_adherent:
      `ClinCollab — 🔴 PATIENT NON-ADHERENCE ALERT\n\nDr. ${specialist.name},\n\n${plan.patient_name} has reported they have NOT followed preparation instructions for ${plan.procedure_name} on ${plan.scheduled_date}.\n\nACTION REQUIRED: Decide whether to proceed, reschedule, or cancel.\n\nView plan: ${process.env.NEXT_PUBLIC_APP_URL}/procedures/${planId}`,

    confirmation_not_received:
      `ClinCollab — ⚠ Confirmation overdue\n\nDr. ${specialist.name},\n\n${triggerRole} has not confirmed for ${plan.patient_name} — ${plan.procedure_name} on ${plan.scheduled_date}.\n\nPlease follow up manually or take action.\n\nView: ${process.env.NEXT_PUBLIC_APP_URL}/procedures/${planId}`,

    stakeholder_declined:
      `ClinCollab — ⚠ Stakeholder unavailable\n\nDr. ${specialist.name},\n\n${triggerRole} has declined or is unavailable for ${plan.patient_name} — ${plan.procedure_name} on ${plan.scheduled_date}.\n\nAction needed: Find replacement or reschedule.\n\nView: ${process.env.NEXT_PUBLIC_APP_URL}/procedures/${planId}`,

    patient_distress:
      `ClinCollab — 🔴 PATIENT DISTRESS SIGNAL\n\nDr. ${specialist.name},\n\n${plan.patient_name} has sent a distress message regarding ${plan.procedure_name}.\n\nPlease contact them immediately: ${plan.scheduled_date ? `procedure is ${plan.scheduled_date}` : 'date TBD'}.\n\nView: ${process.env.NEXT_PUBLIC_APP_URL}/procedures/${planId}`,
  }

  const msg = escalationMessages[triggerEvent] || escalationMessages.confirmation_not_received

  await dispatch({
    module:           'M9',
    specialist_id:    specialistId,
    recipient_type:   'specialist',
    recipient_mobile: specialist.whatsapp_number,
    message:          msg,
    idempotency_key:  `M9:esc:${planId}:${triggerEvent}:${Date.now()}`,
  })

  log('info', 'M9', 'escalation_triggered', {
    planId, triggerEvent, triggerRole, action,
  })
}

// ── Acknowledgement sender ─────────────────────────────────────
async function sendAcknowledgement(
  stakeholder: any,
  ackType: string,
  specialistId: string,
  sc: ReturnType<typeof svc>
) {
  if (!stakeholder.mobile) return

  const { data: specialist } = await sc
    .from('specialists')
    .select('name').eq('id', specialistId).single()

  const acks: Record<string, string> = {
    arrived:  `Thank you, ${stakeholder.name}. We have noted your arrival. Please proceed to [ADMISSION_AREA]. Our team will be with you shortly. Dr. ${specialist?.name}`,
    distress: `Thank you for letting us know. Dr. ${specialist?.name} has been immediately notified. Please call 112 if it is an emergency. We will contact you shortly.`,
    yes:      `Thank you for confirming, ${stakeholder.name}. We will see you for the procedure. Dr. ${specialist?.name}`,
  }

  const msg = acks[ackType] || `Thank you for your reply, ${stakeholder.name}. Dr. ${specialist?.name}`

  await dispatch({
    module:           'M9',
    specialist_id:    specialistId,
    recipient_type:   'patient',
    recipient_mobile: stakeholder.mobile,
    message:          msg,
  })
}

// ── Fallback message builder ───────────────────────────────────
function buildFallbackMessage(
  event: string,
  role: string,
  vars: Record<string, string | null>
): string {
  const p = (k: string) => vars[k] || '—'

  const fallbacks: Record<string, Record<string, string>> = {
    procedure_scheduled: {
      patient:        `ClinCollab — Your ${p('PROCEDURE_NAME')} with Dr. ${p('SPECIALIST_NAME')} has been scheduled for ${p('PROCEDURE_DATE')}. You will receive preparation instructions shortly.`,
      anaesthesiologist: `ClinCollab — Anaesthesia request from Dr. ${p('SPECIALIST_NAME')}: ${p('PATIENT_NAME')}, ${p('PROCEDURE_NAME')} on ${p('PROCEDURE_DATE')}. Please confirm availability.`,
      ot_coordinator:  `ClinCollab — OT booking request: Dr. ${p('SPECIALIST_NAME')}, ${p('PROCEDURE_NAME')}, ${p('PATIENT_NAME')}, ${p('PROCEDURE_DATE')}. Please confirm booking.`,
      referring_doctor:`ClinCollab — Re your patient ${p('PATIENT_NAME')}: ${p('PROCEDURE_NAME')} scheduled for ${p('PROCEDURE_DATE')} under Dr. ${p('SPECIALIST_NAME')}.`,
    },
    procedure_completed: {
      patient:        `ClinCollab — Dear ${p('PATIENT_NAME')}, your ${p('PROCEDURE_NAME')} has been completed by Dr. ${p('SPECIALIST_NAME')}. You are now being monitored. Your family will be updated shortly.`,
      referring_doctor:`ClinCollab — Re ${p('PATIENT_NAME')}: ${p('PROCEDURE_NAME')} completed by Dr. ${p('SPECIALIST_NAME')} today. Outcome update to follow.`,
    },
    patient_discharged: {
      patient:        `ClinCollab — Dear ${p('PATIENT_NAME')}, you are being discharged today. Please follow your discharge instructions carefully and attend your follow-up. Dr. ${p('SPECIALIST_NAME')}`,
      referring_doctor:`ClinCollab — Re ${p('PATIENT_NAME')}: Discharged from ${p('PROCEDURE_NAME')} under Dr. ${p('SPECIALIST_NAME')}. Discharge summary to follow.`,
    },
  }

  return fallbacks[event]?.[role] || `ClinCollab — Update for ${p('PROCEDURE_NAME')}: ${p('PATIENT_NAME')}. Dr. ${p('SPECIALIST_NAME')}`
}

// ── Post-procedure milestone recorder ─────────────────────────
export async function recordMilestone(
  planId:         string,
  specialistId:   string,
  milestoneName:  string,
  milestoneLabel: string,
  sequenceOrder:  number,
  options: {
    clinicalNotes?: string
    vitalsSummary?: string
    medicationChanges?: string
    notifyPatient?: boolean
    notifyReferrer?: boolean
    notifyNok?: boolean
    patientMessage?: string
    referrerMessage?: string
  } = {}
): Promise<Result<string>> {
  return moduleBoundary('M9:milestone', async () => {
    const sc = svc()

    // Upsert milestone
    const { data: milestone } = await sc.from('post_procedure_milestones')
      .upsert({
        plan_id:         planId,
        specialist_id:   specialistId,
        milestone_name:  milestoneName,
        milestone_label: milestoneLabel,
        sequence_order:  sequenceOrder,
        status:          'reached',
        reached_at:      new Date().toISOString(),
        clinical_notes:  options.clinicalNotes || null,
        vitals_summary:  options.vitalsSummary || null,
        medication_changes: options.medicationChanges || null,
        notify_patient:  options.notifyPatient ?? true,
        notify_referring_doctor: options.notifyReferrer ?? false,
        notify_nok:      options.notifyNok ?? false,
        patient_message: options.patientMessage || null,
        referrer_message:options.referrerMessage || null,
      }, { onConflict: 'plan_id,milestone_name' })
      .select('id').single()

    // Trigger communications for this milestone
    const eventMap: Record<string, TriggerEvent> = {
      procedure_completed: 'procedure_completed',
      patient_discharged:  'patient_discharged',
    }

    const triggerEvent = eventMap[milestoneName]
    if (triggerEvent) {
      const roles: string[] = []
      if (options.notifyPatient) roles.push('patient', 'patient_nok')
      if (options.notifyReferrer) roles.push('referring_doctor')

      if (roles.length > 0) {
        await broadcastToStakeholders({
          planId,
          event:       triggerEvent,
          rolesFilter: roles,
        })
      }
    }

    log('info', 'M9', 'milestone_recorded', {
      planId, milestoneName, notifyCount: options.notifyPatient ? 1 : 0,
    })

    return milestone?.id || ''
  })
}

// ── Check for overdue confirmations (called by scheduled job) ──
export async function processOverdueConfirmations(specialistId: string): Promise<void> {
  return moduleBoundary('M9:overdue_check', async () => {
    const sc = svc()

    const { data: overdue } = await sc.rpc('get_overdue_confirmations', {
      p_specialist_id: specialistId
    })

    if (!overdue || overdue.length === 0) return

    log('info', 'M9', 'overdue_confirmations_found', {
      count: overdue.length, specialistId
    })

    for (const item of overdue) {
      const hoursOverdue = Math.round(item.hours_overdue)

      // If < 24h overdue: send a reminder
      if (hoursOverdue < 24) {
        await sc.from('confirmation_requests')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', item.request_id)
      } else {
        // Over 24h: escalate
        await sc.from('confirmation_requests')
          .update({ escalated_at: new Date().toISOString() })
          .eq('id', item.request_id)

        await triggerEscalation(item.plan_id, specialistId, 'confirmation_not_received', item.stakeholder_role, sc)
      }
    }
  }) as unknown as void
}
