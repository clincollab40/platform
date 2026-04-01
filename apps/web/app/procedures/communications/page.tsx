import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import CommsDashboardClient from './comms-dashboard-client'

export default async function CommsDashboardPage({
  params,
}: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists').select('id, name, specialty').eq('google_id', user.id).single()
  if (!specialist) redirect('/onboarding')

  const { data: plan } = await supabase
    .from('procedure_plans')
    .select('id, patient_name, procedure_name, scheduled_date, status, urgency')
    .eq('id', params.id).eq('specialist_id', specialist.id).single()

  if (!plan) notFound()

  const [stakeholdersRes, confirmationsRes, escalationsRes, milestonesRes, adherenceRes] = await Promise.all([
    supabase.from('procedure_stakeholders')
      .select(`*, communication_threads(id, unread_count, total_messages, last_event_at, pending_confirmations)`)
      .eq('plan_id', params.id).eq('specialist_id', specialist.id).order('sort_order'),
    supabase.from('confirmation_requests')
      .select(`*, procedure_stakeholders(name, role)`)
      .eq('plan_id', params.id).eq('specialist_id', specialist.id)
      .order('sent_at', { ascending: false }).limit(30),
    supabase.from('escalation_events')
      .select('*').eq('plan_id', params.id).eq('specialist_id', specialist.id)
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('post_procedure_milestones')
      .select('*').eq('plan_id', params.id).eq('specialist_id', specialist.id).order('sequence_order'),
    supabase.from('patient_adherence_log')
      .select('*').eq('plan_id', params.id).eq('specialist_id', specialist.id)
      .order('check_date', { ascending: false }).limit(20),
  ])

  const { data: templates } = await supabase
    .from('communication_templates')
    .select('id, name, role, trigger_event, is_confirmation_request')
    .or(`specialist_id.eq.${specialist.id},specialist_id.is.null`)
    .eq('is_active', true).order('role')

  return (
    <CommsDashboardClient
      plan={plan}
      specialist={specialist}
      stakeholders={stakeholdersRes.data || []}
      confirmations={confirmationsRes.data || []}
      escalations={escalationsRes.data || []}
      milestones={milestonesRes.data || []}
      adherence={adherenceRes.data || []}
      templates={templates || []}
    />
  )
}
