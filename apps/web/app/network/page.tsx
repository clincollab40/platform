import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import type { InsightData } from '@/components/layout/InsightPanel'
import NetworkClient from './network-client'

export default async function NetworkPage({
  searchParams,
}: {
  searchParams: { filter?: string; q?: string }
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

  // Migrate any unseeded peers first (idempotent)
  await db.rpc('migrate_peer_seeds_to_referrers', {
    p_specialist_id: specialist.id,
  })

  const { data: referrers } = await db
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

  const { data: scoreData } = await db
    .rpc('compute_network_health_score', { p_specialist_id: specialist.id })

  const CITY_BENCHMARKS: Record<string, number> = {
    Hyderabad: 14, Bengaluru: 16, Mumbai: 18, Delhi: 17,
    Chennai: 13, Kolkata: 12, Pune: 13, Ahmedabad: 12, default: 12,
  }
  const benchmark = CITY_BENCHMARKS[specialist.city] ?? CITY_BENCHMARKS.default

  // Deduplicate by name — keeps the row with the highest referral count
  // (prevents duplicate display if seed was run multiple times before unique constraint existed)
  const seenNames = new Map<string, NonNullable<typeof referrers>[0]>()
  for (const r of (referrers || [])) {
    const key = r.name.toLowerCase().trim()
    const prev = seenNames.get(key)
    if (!prev || r.total_referrals > prev.total_referrals) seenNames.set(key, r)
  }
  const allReferrers = Array.from(seenNames.values())
  const activeCount  = allReferrers.filter(r => r.status === 'active').length
  const silentCount  = allReferrers.filter(r => r.status === 'silent').length
  const healthScore  = (scoreData as number) ?? 0

  const insightData: InsightData = {
    moduleTitle: 'Referrer Network Health',
    score: healthScore,
    scoreLabel: 'Network Health Score',
    scoreColor: healthScore >= 70 ? 'green' : healthScore >= 40 ? 'amber' : 'red',
    insights: [
      activeCount < benchmark
        ? { text: `${activeCount} active referrers vs ${benchmark} city average. ${benchmark - activeCount} more needed to hit benchmark.`, severity: 'warning' as const }
        : { text: `${activeCount} active referrers — above the ${specialist.city} average of ${benchmark}.`, severity: 'positive' as const },
      silentCount > 0
        ? { text: `${silentCount} referrer${silentCount > 1 ? 's have' : ' has'} gone silent. Re-engage with a WhatsApp nudge.`, severity: 'critical' as const }
        : { text: 'No silent referrers. Your network is actively engaged.', severity: 'positive' as const },
      allReferrers.length === 0
        ? { text: 'Start by adding your first referrer to build network intelligence.', severity: 'info' as const }
        : { text: `${allReferrers.length} total referrers mapped in your network.`, severity: 'info' as const },
    ],
    benchmark: `Platform data: specialists in ${specialist.city} with ${benchmark}+ active referrers achieve 34% more case volume on average.`,
    cta:           { label: 'Add new referrer',       href: '/network/add' },
    secondaryCta:  { label: 'Re-engage silent peers', href: '/network?filter=silent' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <NetworkClient
        specialist={specialist}
        referrers={allReferrers}
        healthScore={healthScore}
        cityBenchmark={benchmark}
        initialFilter={(searchParams.filter as any) || 'all'}
        initialQuery={searchParams.q || ''}
      />
    </AppLayout>
  )
}
