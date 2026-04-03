import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import ReferrerDetailClient from './referrer-detail-client'

export default async function ReferrerDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: specialist } = await db
    .from('specialists')
    .select('id, name, specialty, city, role')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  // Fetch referrer
  const { data: referrer } = await db
    .from('referrers')
    .select('*')
    .eq('id', params.id)
    .eq('specialist_id', specialist.id)
    .eq('is_deleted', false)
    .single()

  if (!referrer) notFound()

  // Fetch referral logs
  const { data: logs } = await db
    .from('referral_logs')
    .select('*')
    .eq('referrer_id', params.id)
    .eq('specialist_id', specialist.id)
    .order('referred_on', { ascending: false })
    .limit(50)

  // Fetch notes
  const { data: notes } = await db
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
