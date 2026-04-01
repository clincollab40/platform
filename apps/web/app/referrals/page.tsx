import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import ReferralsClient from './referrals-client'

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string }
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists')
    .select('id, name, specialty, city, role, whatsapp_number')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  // Fetch all referral cases with related data
  const { data: cases } = await supabase
    .from('referral_cases')
    .select(`
      id, reference_no, patient_name, patient_gender,
      chief_complaint, urgency, status,
      expected_visit_date, submitted_at, accepted_at, updated_at,
      referring_doctors ( name, specialty, city, clinic_name ),
      referrers ( name, specialty )
    `)
    .eq('specialist_id', specialist.id)
    .order('submitted_at', { ascending: false })
    .limit(200)

  // Fetch analytics
  const { data: analytics } = await supabase
    .from('v_referral_analytics')
    .select('*')
    .eq('specialist_id', specialist.id)
    .single()

  return (
    <ReferralsClient
      specialist={specialist}
      cases={cases || []}
      analytics={analytics}
      initialStatus={searchParams.status || 'all'}
      initialQuery={searchParams.q || ''}
    />
  )
}
