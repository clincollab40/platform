import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import NetworkClient from './network-client'

export default async function NetworkPage({
  searchParams,
}: {
  searchParams: { filter?: string; q?: string }
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

  // Migrate any unseeded peers first (idempotent)
  await supabase.rpc('migrate_peer_seeds_to_referrers', {
    p_specialist_id: specialist.id,
  })

  // Fetch all non-deleted referrers
  const { data: referrers } = await supabase
    .from('referrers')
    .select(`
      id, name, clinic_name, clinic_area, city, mobile,
      whatsapp, specialty, status, total_referrals,
      last_referral_at, days_since_last, created_at
    `)
    .eq('specialist_id', specialist.id)
    .eq('is_deleted', false)
    .order('status', { ascending: true })
    .order('last_referral_at', { ascending: false, nullsFirst: false })

  // Compute health score
  const { data: scoreData } = await supabase
    .rpc('compute_network_health_score', { p_specialist_id: specialist.id })

  // City benchmark
  const CITY_BENCHMARKS: Record<string, number> = {
    Hyderabad: 14, Bengaluru: 16, Mumbai: 18, Delhi: 17,
    Chennai: 13, Kolkata: 12, Pune: 13, Ahmedabad: 12, default: 12,
  }
  const benchmark = CITY_BENCHMARKS[specialist.city] ?? CITY_BENCHMARKS.default

  return (
    <NetworkClient
      specialist={specialist}
      referrers={referrers || []}
      healthScore={scoreData ?? 0}
      cityBenchmark={benchmark}
      initialFilter={(searchParams.filter as any) || 'all'}
      initialQuery={searchParams.q || ''}
    />
  )
}
