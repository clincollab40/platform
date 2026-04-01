import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import ProceduresListClient from './procedures-list-client'

export default async function ProceduresPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists').select('id, name, specialty').eq('google_id', user.id).single()
  if (!specialist) redirect('/onboarding')

  const { data: plans } = await supabase
    .from('procedure_plans')
    .select(`
      id, patient_name, procedure_name, urgency, status,
      scheduled_date, scheduled_time, consent_status,
      workup_complete, resources_confirmed, patient_ready, created_at,
      procedure_protocols ( procedure_code, ot_room_type )
    `)
    .eq('specialist_id', specialist.id)
    .not('status', 'in', '("completed","cancelled","declined")')
    .order('scheduled_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100)

  const { data: recentCompleted } = await supabase
    .from('procedure_plans')
    .select('id, patient_name, procedure_name, status, completed_at, outcome')
    .eq('specialist_id', specialist.id)
    .in('status', ['completed', 'cancelled'])
    .order('completed_at', { ascending: false })
    .limit(10)

  const { data: protocols } = await supabase
    .from('procedure_protocols')
    .select('id, procedure_name, procedure_code')
    .eq('specialist_id', specialist.id).eq('is_active', true).order('procedure_name')

  const analytics = {
    active:        (plans || []).filter(p => !['counselling','patient_deciding'].includes(p.status)).length,
    scheduled:     (plans || []).filter(p => p.status === 'scheduled').length,
    ready:         (plans || []).filter(p => p.status === 'ready_for_procedure').length,
    pendingWorkup: (plans || []).filter(p => !p.workup_complete && p.status !== 'counselling').length,
    awaitingConsent:(plans || []).filter(p => p.consent_status !== 'signed').length,
  }

  return (
    <ProceduresListClient
      specialist={specialist}
      plans={plans || []}
      recentCompleted={recentCompleted || []}
      protocols={protocols || []}
      analytics={analytics}
    />
  )
}
