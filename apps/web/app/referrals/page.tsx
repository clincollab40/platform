import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import type { InsightData } from '@/components/layout/InsightPanel'
import ReferralsClient from './referrals-client'

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string }
}) {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: specialist } = await db
    .from('specialists')
    .select('id, name, specialty, city, role, whatsapp_number')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  const { data: cases } = await db
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

  const { data: analytics } = await db
    .from('v_referral_analytics')
    .select('*')
    .eq('specialist_id', specialist.id)
    .single()

  const allCases = cases || []
  const pending   = allCases.filter(c => c.status === 'submitted' || c.status === 'under_review').length
  const accepted  = allCases.filter(c => c.status === 'accepted').length
  const urgent    = allCases.filter(c => c.urgency === 'urgent' || c.urgency === 'emergency').length
  const total     = allCases.length

  const conversionRate = total > 0 ? Math.round((accepted / total) * 100) : 0
  const convScore      = Math.min(100, conversionRate + (pending > 0 ? 10 : 0))

  // urgent = cases that are urgent/emergency AND still awaiting response
  const urgentPending = allCases.filter(c =>
    (c.urgency === 'urgent' || c.urgency === 'emergency') &&
    ['submitted', 'queried', 'info_provided'].includes(c.status)
  ).length

  const insightData: InsightData = {
    moduleTitle: 'Referral Pipeline',
    score: convScore,
    scoreLabel: 'Acceptance Score',
    scoreColor: conversionRate >= 60 ? 'green' : conversionRate >= 35 ? 'amber' : 'red',
    insights: [
      pending > 0
        ? { text: `${pending} case${pending > 1 ? 's' : ''} awaiting your response. Replying within 2 hours improves referrer retention significantly.`, severity: 'warning' as const }
        : { text: 'All referrals reviewed. Your pipeline is clear.', severity: 'positive' as const },
      urgentPending > 0
        ? { text: `${urgentPending} urgent/emergency case${urgentPending > 1 ? 's are' : ' is'} waiting — see the Priority panel on the Referrals screen to review each case.`, severity: 'critical' as const }
        : { text: 'No urgent or emergency cases currently awaiting response.', severity: 'info' as const },
      conversionRate > 0
        ? { text: `Your acceptance rate: ${conversionRate}%. Platform data: specialists sustaining 60–75% build stronger long-term referral networks.`, severity: conversionRate >= 60 ? 'positive' as const : 'warning' as const }
        : { text: 'Accept your first referral to start tracking your acceptance rate.', severity: 'info' as const },
    ],
    benchmark: `Platform data: specialists who respond within 2 hours receive 2.4× more repeat referrals from the same colleague.`,
    cta:          { label: 'Cases needing response', href: '/referrals?status=action_needed' },
    secondaryCta: { label: 'View completed cases',   href: '/referrals?status=completed' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <ReferralsClient
        specialist={specialist}
        cases={allCases}
        analytics={analytics}
        initialStatus={searchParams.status || 'all'}
        initialQuery={searchParams.q || ''}
      />
    </AppLayout>
  )
}
