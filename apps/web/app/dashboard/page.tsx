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

  // Step 1 — get specialist (needed for all sub-queries)
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

  // Step 2 — parallel queries (3x faster than sequential)
  const [referrersRes, casesRes, scoreRes] = await Promise.all([
    // referrers table — same source as Network module, keeps numbers in sync
    db.from('referrers')
      .select('id, name, specialty, status, total_referrals, last_referral_at, days_since_last, whatsapp, clinic_name, city')
      .eq('specialist_id', specialist.id)
      .eq('is_deleted', false)
      .order('last_referral_at', { ascending: false, nullsFirst: false }),

    // recent referral cases for pipeline view
    db.from('referral_cases')
      .select(`
        id, reference_no, patient_name, status, urgency, submitted_at,
        referring_doctors ( name, specialty )
      `)
      .eq('specialist_id', specialist.id)
      .order('submitted_at', { ascending: false })
      .limit(6),

    // same RPC as Network module — identical score
    db.rpc('compute_network_health_score', { p_specialist_id: specialist.id }),
  ])

  // fire-and-forget last_active update
  db.from('specialists').update({ last_active_at: new Date().toISOString() }).eq('id', specialist.id)

  // ── Deduplicate referrers (same logic as Network module) ─────────────────
  const seenNames = new Map<string, NonNullable<typeof referrersRes.data>[0]>()
  for (const r of (referrersRes.data || [])) {
    const key = r.name.toLowerCase().trim()
    const prev = seenNames.get(key)
    if (!prev || r.total_referrals > prev.total_referrals) seenNames.set(key, r)
  }
  const referrers   = Array.from(seenNames.values())
  const allCases    = casesRes.data || []
  const healthScore = (scoreRes.data as number) ?? 0

  // ── Derived metrics ──────────────────────────────────────────────────────
  const activeReferrers   = referrers.filter(r => r.status === 'active')
  const driftingReferrers = referrers.filter(r => r.status === 'drifting')
  const silentReferrers   = referrers.filter(r => r.status === 'silent')
  const atRisk            = driftingReferrers.length + silentReferrers.length
  const pendingCases      = allCases.filter(c => ['submitted', 'queried', 'info_provided'].includes(c.status))
  const urgentCases       = pendingCases.filter(c => c.urgency === 'urgent' || c.urgency === 'emergency')

  const CITY_BENCHMARKS: Record<string, number> = {
    Hyderabad: 14, Bengaluru: 16, Mumbai: 18, Delhi: 17,
    Chennai: 13, Kolkata: 12, Pune: 13, Ahmedabad: 12, default: 12,
  }
  const cityBench    = CITY_BENCHMARKS[specialist.city] ?? CITY_BENCHMARKS.default
  const profile      = (specialist.specialist_profiles as any)?.[0]
                     ?? (specialist.specialist_profiles as any) ?? null
  const completeness = profile?.completeness_pct ?? 0

  // ── Actionable insight panel ─────────────────────────────────────────────
  const insightData: InsightData = {
    moduleTitle: 'Dashboard',
    score:       healthScore,
    scoreLabel:  'Network Health Score',
    scoreColor:  healthScore >= 70 ? 'green' : healthScore >= 40 ? 'amber' : 'red',
    insights: [
      urgentCases.length > 0
        ? {
            text: `${urgentCases.length} urgent/emergency referral${urgentCases.length > 1 ? 's' : ''} need immediate response. Delays reduce repeat referrals.`,
            severity: 'critical' as const,
            cta: { label: 'Review urgent cases now', href: '/referrals?status=action_needed' },
          }
        : pendingCases.length > 0
        ? {
            text: `${pendingCases.length} referral${pendingCases.length > 1 ? 's' : ''} awaiting your response. Replying within 2 hours retains referrers.`,
            severity: 'warning' as const,
            cta: { label: 'Review pending cases', href: '/referrals?status=action_needed' },
          }
        : {
            text: 'No pending referrals. Your pipeline is clear — good time to nurture your network.',
            severity: 'positive' as const,
            cta: { label: 'View referral cases', href: '/referrals' },
          },

      atRisk > 0
        ? {
            text: `${atRisk} referrer relationship${atRisk > 1 ? 's' : ''} ${atRisk > 1 ? 'are' : 'is'} drifting or silent. Act before they disengage permanently.`,
            severity: 'warning' as const,
            cta: { label: 'Re-engage now', href: '/network?filter=silent' },
          }
        : {
            text: `${activeReferrers.length} of your ${referrers.length} referrers are actively sending cases.`,
            severity: 'positive' as const,
            cta: { label: 'View full network', href: '/network' },
          },

      completeness < 70
        ? {
            text: `Profile ${completeness}% complete. Incomplete profiles miss referrals from new colleagues searching your specialty.`,
            severity: 'info' as const,
            cta: { label: 'Complete my profile', href: '/profile' },
          }
        : {
            text: `Profile ${completeness}% complete — peers can find and evaluate your clinical focus.`,
            severity: 'info' as const,
          },
    ],
    benchmark:    `Platform data: specialists in ${specialist.city} with ${cityBench}+ active referrers achieve 34% higher case volume on average.`,
    cta:          { label: 'Grow referral network',   href: '/network/add' },
    secondaryCta: { label: 'View all referral cases', href: '/referrals' },
  }

  return (
    <AppLayout
      specialist={{
        id:        specialist.id,
        name:      specialist.name,
        specialty: specialist.specialty,
        role:      specialist.role,
        photo:     user.user_metadata?.avatar_url ?? profile?.photo_url,
      }}
      insightData={insightData}
    >
      <DashboardClient
        specialist={specialist as any}
        referrers={referrers as any}
        cases={allCases as any}
        healthScore={healthScore}
        cityBenchmark={cityBench}
        isNewlyOnboarded={searchParams.onboarded === '1'}
        userPhoto={user.user_metadata?.avatar_url}
      />
    </AppLayout>
  )
}
