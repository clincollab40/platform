import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import CommsJourneyClient from './comms-journey-client'

export default async function CommsJourneyPage({ params }: { params: { planId: string } }) {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: specialist } = await db
    .from('specialists')
    .select('id, name, specialty, whatsapp_number')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  // ── Core plan ─────────────────────────────────────────────────────────────
  const { data: plan } = await db
    .from('procedure_plans')
    .select(`
      id, patient_name, procedure_name, urgency, status,
      scheduled_date, scheduled_time, consent_status, workup_complete,
      patient_mobile,
      procedure_protocols ( procedure_code, ot_room_type, anaesthesia_type, estimated_duration_mins )
    `)
    .eq('id', params.planId)
    .eq('specialist_id', specialist.id)
    .single()

  if (!plan) notFound()

  // ── Parallel fetch: all comms data for this plan ──────────────────────────
  const [
    stakeholdersRes,
    threadsRes,
    confirmationsRes,
    escalationsRes,
    milestonesRes,
    eventsRes,
  ] = await Promise.all([
    // Stakeholders with their thread summary
    db.from('procedure_stakeholders')
      .select('*')
      .eq('plan_id', params.planId)
      .eq('specialist_id', specialist.id)
      .order('sort_order'),

    // Communication threads (one per stakeholder)
    db.from('communication_threads')
      .select(`
        id, stakeholder_id, last_event_at, last_direction,
        unread_count, total_messages, pending_confirmations, completed_confirmations
      `)
      .eq('plan_id', params.planId)
      .eq('specialist_id', specialist.id),

    // All confirmation requests (resolved + unresolved)
    db.from('confirmation_requests')
      .select(`
        id, stakeholder_id, confirmation_type, question_text,
        sent_at, response_required_by, response, response_text,
        responded_at, is_resolved, resolved_by, override_reason
      `)
      .eq('plan_id', params.planId)
      .eq('specialist_id', specialist.id)
      .order('sent_at', { ascending: false }),

    // Unresolved escalations
    db.from('escalation_events')
      .select('*')
      .eq('plan_id', params.planId)
      .eq('specialist_id', specialist.id)
      .order('created_at', { ascending: false }),

    // Post-procedure milestones
    db.from('post_procedure_milestones')
      .select('*')
      .eq('plan_id', params.planId)
      .eq('specialist_id', specialist.id)
      .order('sequence_order'),

    // Recent communication events (last 50 across all threads)
    db.from('communication_events')
      .select(`
        id, thread_id, stakeholder_id, direction, channel,
        message_text, is_automated, sent_by_name,
        delivered, delivered_at, read_at, created_at
      `)
      .eq('plan_id', params.planId)
      .eq('specialist_id', specialist.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  // Build thread map: stakeholder_id → thread
  const threadMap = new Map<string, any>()
  for (const t of threadsRes.data || []) {
    threadMap.set(t.stakeholder_id, t)
  }

  // Build events map: stakeholder_id → events[]
  const eventsMap = new Map<string, any[]>()
  for (const e of eventsRes.data || []) {
    if (!eventsMap.has(e.stakeholder_id)) eventsMap.set(e.stakeholder_id, [])
    eventsMap.get(e.stakeholder_id)!.push(e)
  }

  // Enrich stakeholders with thread + events
  const enrichedStakeholders = (stakeholdersRes.data || []).map(s => ({
    ...s,
    thread: threadMap.get(s.id) || null,
    recentEvents: (eventsMap.get(s.id) || []).slice(0, 5),
  }))

  return (
    <CommsJourneyClient
      plan={plan as any}
      specialist={specialist}
      stakeholders={enrichedStakeholders}
      confirmations={confirmationsRes.data || []}
      escalations={escalationsRes.data || []}
      milestones={milestonesRes.data || []}
    />
  )
}
