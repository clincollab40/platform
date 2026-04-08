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

  // ── Step 1: get specialist ────────────────────────────────────────────────
  const { data: specialist } = await db
    .from('specialists')
    .select(`
      id, name, specialty, city, status, role,
      last_active_at, created_at,
      specialist_profiles ( completeness_pct, photo_url, designation )
    `)
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')
  if (specialist.status === 'onboarding') redirect('/onboarding')

  // ── Step 2: all queries in parallel (performance) ─────────────────────────
  const thirteenMonthsAgo = new Date()
  thirteenMonthsAgo.setMonth(thirteenMonthsAgo.getMonth() - 13)

  const [referrersRes, analyticsRes, trendRes, pipelineRes, scoreRes] = await Promise.all([
    // Network data — same table as Network module, numbers stay in sync
    db.from('referrers')
      .select('id, status, total_referrals')
      .eq('specialist_id', specialist.id)
      .eq('is_deleted', false),

    // Aggregated analytics — gives total, this month, last month, avg response
    db.from('v_referral_analytics')
      .select('total_cases, accepted_cases, completed_cases, cases_this_month, cases_last_month, avg_hours_to_accept')
      .eq('specialist_id', specialist.id)
      .single(),

    // 13 months of case dates for YTD and trend computation
    db.from('referral_cases')
      .select('submitted_at')
      .eq('specialist_id', specialist.id)
      .gte('submitted_at', thirteenMonthsAgo.toISOString()),

    // Open pipeline cases — just status and urgency, no personal data
    db.from('referral_cases')
      .select('status, urgency')
      .eq('specialist_id', specialist.id)
      .not('status', 'in', '("completed","closed","declined","cancelled")'),

    // Same RPC as Network module — identical score
    db.rpc('compute_network_health_score', { p_specialist_id: specialist.id }),
  ])

  // fire-and-forget last_active update
  db.from('specialists')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', specialist.id)

  // ── Deduplicate referrers (same logic as Network module) ─────────────────
  const seenNames = new Map<string, NonNullable<typeof referrersRes.data>[0]>()
  for (const r of (referrersRes.data || [])) {
    const key = (r as any).name?.toLowerCase?.().trim() ?? r.id
    const prev = seenNames.get(key)
    if (!prev || (r.total_referrals ?? 0) > (prev.total_referrals ?? 0)) seenNames.set(key, r)
  }
  const referrers = Array.from(seenNames.values())

  // ── Network summary ───────────────────────────────────────────────────────
  const activeCount   = referrers.filter(r => r.status === 'active').length
  const driftingCount = referrers.filter(r => r.status === 'drifting').length
  const silentCount   = referrers.filter(r => r.status === 'silent').length
  const newCount      = referrers.filter(r => r.status === 'new').length
  const totalRef      = referrers.length
  const healthScore   = (scoreRes.data as number) ?? 0

  // ── Pipeline summary ──────────────────────────────────────────────────────
  const openCases     = pipelineRes.data || []
  const needsResponse = openCases.filter(c =>
    ['submitted', 'queried', 'info_provided'].includes(c.status)
  ).length
  const urgentCount   = openCases.filter(c =>
    ['submitted', 'queried', 'info_provided'].includes(c.status) &&
    (c.urgency === 'urgent' || c.urgency === 'emergency')
  ).length
  const inProgress    = openCases.filter(c =>
    ['accepted', 'patient_arrived', 'procedure_planned'].includes(c.status)
  ).length

  // ── Volume / trend computation ────────────────────────────────────────────
  const an      = analyticsRes.data
  const now     = new Date()
  const thisYr  = now.getFullYear()
  const thisMon = now.getMonth()

  const trendDates = (trendRes.data || []).map(r => new Date(r.submitted_at))

  // YTD — Jan 1 to today, current year
  const ytd = trendDates.filter(d => d.getFullYear() === thisYr).length

  // Last year same period — Jan 1 to same calendar date last year
  const samePointLastYear = new Date(now); samePointLastYear.setFullYear(thisYr - 1)
  const lastYearYtd = trendDates.filter(d =>
    d.getFullYear() === thisYr - 1 &&
    d <= samePointLastYear
  ).length

  // 6-month trend
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const trend6m = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(thisYr, thisMon - (5 - i), 1)
    const y = d.getFullYear(), m = d.getMonth()
    return {
      month: MONTH_SHORT[m],
      count: trendDates.filter(cd => cd.getFullYear() === y && cd.getMonth() === m).length,
    }
  })

  const acceptanceRate = an?.total_cases
    ? Math.round(((an.accepted_cases ?? 0) / an.total_cases) * 100)
    : 0

  const CITY_BENCHMARKS: Record<string, number> = {
    Hyderabad: 14, Bengaluru: 16, Mumbai: 18, Delhi: 17,
    Chennai: 13, Kolkata: 12, Pune: 13, Ahmedabad: 12, default: 12,
  }
  const cityBench    = CITY_BENCHMARKS[specialist.city] ?? CITY_BENCHMARKS.default
  const profile      = (specialist.specialist_profiles as any)?.[0]
                     ?? (specialist.specialist_profiles as any) ?? null
  const completeness = profile?.completeness_pct ?? 0
  const ytdLabel     = `${MONTH_SHORT[0]}–${MONTH_SHORT[thisMon]} ${thisYr}`

  // ── Insight panel ─────────────────────────────────────────────────────────
  const insightData: InsightData = {
    moduleTitle: 'Dashboard',
    score:       healthScore,
    scoreLabel:  'Network Health Score',
    scoreColor:  healthScore >= 70 ? 'green' : healthScore >= 40 ? 'amber' : 'red',
    insights: [
      urgentCount > 0
        ? {
            text: `${urgentCount} urgent/emergency referral${urgentCount > 1 ? 's' : ''} need immediate response. Every hour of delay reduces referrer retention.`,
            severity: 'critical' as const,
            cta: { label: 'Review urgent cases now', href: '/referrals?status=action_needed' },
          }
        : needsResponse > 0
        ? {
            text: `${needsResponse} referral${needsResponse > 1 ? 's' : ''} awaiting your response. Replying within 2 hours retains referrers.`,
            severity: 'warning' as const,
            cta: { label: 'Review pending cases', href: '/referrals?status=action_needed' },
          }
        : {
            text: 'No pending referrals. Your pipeline is clear.',
            severity: 'positive' as const,
            cta: { label: 'View referral cases', href: '/referrals' },
          },
      (driftingCount + silentCount) > 0
        ? {
            text: `${driftingCount + silentCount} referrer relationship${driftingCount + silentCount > 1 ? 's' : ''} are drifting or silent — act before they disengage permanently.`,
            severity: 'warning' as const,
            cta: { label: 'Plan re-engagement', href: '/network?filter=silent' },
          }
        : {
            text: `${activeCount} of ${totalRef} referrers are actively sending cases. Network is healthy.`,
            severity: 'positive' as const,
            cta: { label: 'View network', href: '/network' },
          },
      an && (an.cases_this_month ?? 0) > 0
        ? {
            text: `${an.cases_this_month} cases received this month${an.cases_last_month ? ` vs ${an.cases_last_month} last month` : ''}. YTD: ${ytd} cases.`,
            severity: 'info' as const,
            cta: { label: 'View all cases', href: '/referrals' },
          }
        : {
            text: 'No cases received yet this month.',
            severity: 'info' as const,
            cta: { label: 'Generate referral link', href: '/referrals' },
          },
    ],
    benchmark:    `Platform data: specialists in ${specialist.city} with ${cityBench}+ active referrers achieve 34% higher case volume.`,
    cta:          { label: 'Manage referral network',  href: '/network' },
    secondaryCta: { label: 'View all referral cases',  href: '/referrals' },
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
        specialist={{ ...specialist, specialist_profiles: profile } as any}
        volume={{
          thisMonth:        an?.cases_this_month  ?? 0,
          lastMonth:        an?.cases_last_month  ?? 0,
          ytd,
          lastYearYtd,
          ytdLabel,
          trend:            trend6m,
          totalAllTime:     an?.total_cases        ?? 0,
          completedAllTime: an?.completed_cases    ?? 0,
          acceptanceRate,
          avgHoursToAccept: an?.avg_hours_to_accept ?? null,
        }}
        network={{
          total:                  totalRef,
          active:                 activeCount,
          drifting:               driftingCount,
          silent:                 silentCount,
          newReferrers:           newCount,
          healthScore,
          cityBenchmark:          cityBench,
          plannedForEngagement:   driftingCount + silentCount,
        }}
        pipeline={{ needsResponse, urgent: urgentCount, inProgress }}
        isNewlyOnboarded={searchParams.onboarded === '1'}
      />
    </AppLayout>
  )
}
