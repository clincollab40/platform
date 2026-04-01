import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import PlanDetailClient from './plan-detail-client'

export default async function PlanDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists').select('id, name, specialty').eq('google_id', user.id).single()
  if (!specialist) redirect('/onboarding')

  const { data: plan } = await supabase
    .from('procedure_plans')
    .select(`
      *,
      procedure_protocols(*),
      procedure_resources( id, resource_type, name, quantity, specification, status, confirmed_by, notes, mandatory, sort_order ),
      procedure_workup( id, investigation, category, mandatory, status, result_value, result_date, is_abnormal, abnormal_action, notes, sort_order ),
      procedure_medication_holds( id, drug_name, drug_class, hold_days_before, hold_date, resume_when, reason, patient_confirmed, bridging_required, notes, applies_to_patient ),
      patient_care_plans( * ),
      procedure_consent( * ),
      procedure_alert_log( alert_stage, delivered_at, recipient_type )
    `)
    .eq('id', params.id).eq('specialist_id', specialist.id).single()

  if (!plan) notFound()

  return <PlanDetailClient plan={plan} specialist={specialist} />
}
