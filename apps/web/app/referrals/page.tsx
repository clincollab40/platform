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

  const insightData: InsightData = {
    moduleTitle: 'Referral Pipeline',
    score: convScore,
    scoreLabel: 'Conversion Rate',
    scoreColor: conversionRate >= 70 ? 'green' : conversionRate >= 40 ? 'amber' : 'red',
    insights: [
      pending > 0
        ? { text: `${pending} case${pending > 1 ? 's' : ''} awaiting your review. Respond within 2 hours for best outcomes.`, severity: 'warning' as const }
        : { text: 'No pending referrals. Your pipeline is clear.', severity: 'positive' as const },
      urgent > 0
        ? { text: `${urgent} urgent/emergency case${urgent > 1 ? 's' : ''} in the queue — prioritise immediately.`, severity: 'critical' as const }
        : { text: 'No urgent cases flagged right now.', severity: 'info' as const },
      conversionRate > 0
        ? { text: `${conversionRate}% of referrals accepted. Top specialists in your city hit 78%.`, severity: conversionRate >= 70 ? 'positive' as const : 'warning' as const }
        : { text: 'Accept your first referral to start tracking conversion metrics.', severity: 'info' as const },
    ],
    benchmark: `Specialists who respond to referrals within 2 hours see 2.4× more repeat referrals.`,
    cta:          { label: 'View pending cases', href: '/referrals?status=submitted' },
    secondaryCta: { label: 'Track case outcomes', href: '/referrals?status=completed' },
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
