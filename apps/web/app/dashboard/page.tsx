import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import DashboardClient from './dashboard-client'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { onboarded?: string }
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  // Fetch specialist data
  const { data: specialist } = await supabase
    .from('specialists')
    .select(`
      id, name, specialty, city, status, role,
      last_active_at, created_at,
      specialist_profiles (
        designation, sub_specialty, hospitals,
        years_experience, photo_url, completeness_pct
      )
    `)
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')
  if (specialist.status === 'onboarding') redirect('/onboarding')

  // Fetch peer seeds for network intelligence
  const { data: peers } = await supabase
    .from('peer_seeds')
    .select('*')
    .eq('specialist_id', specialist.id)
    .order('seeded_at', { ascending: false })

  // Update last active
  await supabase
    .from('specialists')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', specialist.id)

  const isNewlyOnboarded = searchParams.onboarded === '1'

  return (
    <DashboardClient
      specialist={specialist}
      peers={peers || []}
      isNewlyOnboarded={isNewlyOnboarded}
      userPhoto={user.user_metadata?.avatar_url}
    />
  )
}
