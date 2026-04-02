import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import type { InsightData } from '@/components/layout/InsightPanel'
import TriageSessionsClient from './sessions-client'

export default async function TriageSessionsPage({
  searchParams,
}: {
  searchParams: { status?: string; protocol?: string }
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

  const since = new Date(Date.now() - 90 * 86400000).toISOString()

  const { data: sessions } = await db
    .from('triage_sessions')
    .select(`
      id, patient_name, patient_mobile, patient_age, patient_gender,
      status, red_flag_level, red_flag_summary, ai_synopsis,
      language, channel, created_at, completed_at, started_at,
      triage_protocols ( name, protocol_type )
    `)
    .eq('specialist_id', specialist.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200)

  const { data: protocols } = await db
    .from('triage_protocols')
    .select('id, name')
    .eq('specialist_id', specialist.id)
    .eq('is_active', true)
    .order('name')

  const all = sessions || []
  const analytics = {
    total:       all.length,
    completed:   all.filter(s => s.status === 'completed').length,
    flagged:     all.filter(s => s.red_flag_level !== 'none' && s.status === 'completed').length,
    urgent:      all.filter(s => s.red_flag_level === 'urgent').length,
    thisWeek:    all.filter(s => new Date(s.created_at) > new Date(Date.now() - 7 * 86400000)).length,
  }

  const completionRate = all.length > 0
    ? Math.round((analytics.completed / all.length) * 100)
    : 0

  const insightData: InsightData = {
    moduleTitle: 'Patient Triage',
    score: completionRate,
    scoreLabel: 'Completion Rate (90d)',
    scoreColor: completionRate >= 75 ? 'green' : completionRate >= 50 ? 'amber' : 'red',
    insights: [
      analytics.urgent > 0
        ? { text: `${analytics.urgent} urgent flag${analytics.urgent > 1 ? 's' : ''} raised this period — review immediately.`, severity: 'critical' as const }
        : { text: 'No urgent flags raised in the last 90 days.', severity: 'positive' as const },
      analytics.thisWeek > 0
        ? { text: `${analytics.thisWeek} triage session${analytics.thisWeek > 1 ? 's' : ''} this week. Patients are engaging.`, severity: 'positive' as const }
        : { text: 'No triage sessions this week. Share your triage link with patients.', severity: 'warning' as const },
      (protocols || []).length === 0
        ? { text: 'No active protocols. Build a protocol to start triaging patients automatically.', severity: 'warning' as const }
        : { text: `${(protocols || []).length} active protocol${(protocols || []).length > 1 ? 's' : ''} powering patient intake.`, severity: 'info' as const },
    ],
    benchmark: `Specialists with AI triage save an average of 2.1 hours per week on patient screening.`,
    cta:          { label: 'Build new protocol',  href: '/triage/builder' },
    secondaryCta: { label: 'View flagged cases',  href: '/triage/sessions?status=completed' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <TriageSessionsClient
        specialist={specialist}
        sessions={all}
        protocols={protocols || []}
        analytics={analytics}
        initialStatus={searchParams.status || 'all'}
        initialProtocol={searchParams.protocol || 'all'}
      />
    </AppLayout>
  )
}
