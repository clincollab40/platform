import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import type { InsightData } from '@/components/layout/InsightPanel'
import DashboardClient from './dashboard-client'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { onboarded?: string }
}) {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: specialist } = await db
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

  const { data: peers } = await db
    .from('peer_seeds')
    .select('*')
    .eq('specialist_id', specialist.id)
    .order('seeded_at', { ascending: false })

  await db
    .from('specialists')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', specialist.id)

  const isNewlyOnboarded = searchParams.onboarded === '1'

  // Compute network health insight
  const allPeers = peers || []
  const activePeers = allPeers.filter(p => (p as any).status === 'active')
  const networkScore = allPeers.length
    ? Math.round(Math.min(100, (activePeers.length / Math.max(allPeers.length, 1)) * 100))
    : 0

  const CITY_BENCHMARKS: Record<string, number> = {
    Hyderabad: 14, Bengaluru: 16, Mumbai: 18, Delhi: 17,
    Chennai: 13, Kolkata: 12, Pune: 13, Ahmedabad: 12, default: 12,
  }
  const cityBench = CITY_BENCHMARKS[specialist.city] ?? CITY_BENCHMARKS.default

  const profile = (specialist.specialist_profiles as any)?.[0] ?? (specialist.specialist_profiles as any) ?? null
  const completeness = profile?.completeness_pct ?? 0

  const insightData: InsightData = {
    moduleTitle: 'Dashboard Intelligence',
    score: Math.round((networkScore * 0.6) + (completeness * 0.4)),
    scoreLabel: 'Practice Health Score',
    scoreColor: networkScore >= 70 ? 'green' : networkScore >= 40 ? 'amber' : 'red',
    insights: [
      activePeers.length < cityBench
        ? { text: `You have ${activePeers.length} active referrers. Specialists in ${specialist.city} average ${cityBench}.`, severity: 'warning' as const }
        : { text: `Your ${activePeers.length} active referrers exceed the ${specialist.city} average of ${cityBench}.`, severity: 'positive' as const },
      completeness < 60
        ? { text: `Your profile is ${completeness}% complete. A complete profile attracts 3× more referrals.`, severity: 'warning' as const }
        : { text: `Profile ${completeness}% complete — great first impression for referring doctors.`, severity: 'positive' as const },
      allPeers.length === 0
        ? { text: 'Add your first referrer to activate network intelligence.', severity: 'critical' as const }
        : { text: `${allPeers.length} peers seeded in your network. Keep nurturing relationships.`, severity: 'info' as const },
    ],
    benchmark: `Specialists in ${specialist.city} with ${cityBench}+ referrers see 34% higher case volume.`,
    cta: { label: 'Grow my network', href: '/network/add' },
    secondaryCta: { label: 'Complete profile', href: '/onboarding' },
  }

  return (
    <AppLayout
      specialist={{
        id: specialist.id,
        name: specialist.name,
        specialty: specialist.specialty,
        role: specialist.role,
        photo: user.user_metadata?.avatar_url ?? profile?.photo_url,
      }}
      insightData={insightData}
    >
      <DashboardClient
        specialist={specialist}
        peers={allPeers}
        isNewlyOnboarded={isNewlyOnboarded}
        userPhoto={user.user_metadata?.avatar_url}
      />
    </AppLayout>
  )
}
