import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import ReferrerDetailClient from './referrer-detail-client'

export default async function ReferrerDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists')
    .select('id, name, specialty, city, role')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  // Fetch referrer — RLS ensures this specialist's data only
  const { data: referrer } = await supabase
    .from('referrers')
    .select('*')
    .eq('id', params.id)
    .eq('specialist_id', specialist.id)
    .eq('is_deleted', false)
    .single()

  if (!referrer) notFound()

  // Fetch referral logs
  const { data: logs } = await supabase
    .from('referral_logs')
    .select('*')
    .eq('referrer_id', params.id)
    .eq('specialist_id', specialist.id)
    .order('referred_on', { ascending: false })
    .limit(50)

  // Fetch notes
  const { data: notes } = await supabase
    .from('referrer_notes')
    .select('*')
    .eq('referrer_id', params.id)
    .eq('specialist_id', specialist.id)
    .order('noted_at', { ascending: false })

  return (
    <ReferrerDetailClient
      referrer={referrer}
      logs={logs || []}
      notes={notes || []}
      specialistId={specialist.id}
    />
  )
}
