import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import type { InsightData } from '@/components/layout/InsightPanel'
import CommunicationPipelineClient from './communication-pipeline-client'

export default async function CommunicationPage() {
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

  // ── Pipeline query: all active plans with comms aggregate ─────────────────
  // Use the v_procedure_comms_pipeline view for per-plan aggregates
  const { data: pipeline } = await db
    .from('v_procedure_comms_pipeline' as any)
    .select('*')
    .eq('specialist_id', specialist.id)
    .order('days_until_procedure', { ascending: true, nullsFirst: false })
    .limit(100)

  const plans = (pipeline || []) as any[]

  // ── Pipeline analytics ────────────────────────────────────────────────────
  const today     = plans.filter(p => p.schedule_bucket === 'today')
  const tomorrow  = plans.filter(p => p.schedule_bucket === 'tomorrow')
  const thisWeek  = plans.filter(p => p.schedule_bucket === 'this_week')
  const upcoming  = plans.filter(p => p.schedule_bucket === 'upcoming')
  const unscheduled = plans.filter(p => p.schedule_bucket === 'unscheduled')

  const critical  = plans.filter(p => p.comms_health === 'critical')
  const totalPendingConfs    = plans.reduce((s: number, p: any) => s + (p.pending_confirmations || 0), 0)
  const totalUnresEscalations = plans.reduce((s: number, p: any) => s + (p.unresolved_escalations || 0), 0)
  const totalNonResponsive   = plans.reduce((s: number, p: any) => s + (p.non_responsive_count || 0), 0)
  const totalUnread          = plans.reduce((s: number, p: any) => s + (p.total_unread || 0), 0)

  const analytics = {
    total:          plans.length,
    today:          today.length,
    thisWeek:       thisWeek.length + tomorrow.length,
    critical:       critical.length,
    pendingConfs:   totalPendingConfs,
    escalations:    totalUnresEscalations,
    nonResponsive:  totalNonResponsive,
    unread:         totalUnread,
  }

  const commsScore = plans.length > 0
    ? Math.round(
        (plans.filter(p => p.comms_health === 'ready').length / plans.length) * 100
      )
    : 100

  const insightData: InsightData = {
    moduleTitle:  'Procedure Communications',
    score:        commsScore,
    scoreLabel:   'Pipeline Alignment',
    scoreColor:   commsScore >= 80 ? 'green' : commsScore >= 50 ? 'amber' : 'red',
    insights: [
      critical.length > 0
        ? { text: `${critical.length} procedure${critical.length > 1 ? 's' : ''} need urgent comms attention — non-responsive stakeholders or overdue confirmations.`, severity: 'critical' as const }
        : plans.length > 0
        ? { text: 'No critical communication gaps in your procedure pipeline.', severity: 'positive' as const }
        : { text: 'No active procedures in pipeline.', severity: 'info' as const },
      today.length > 0
        ? { text: `${today.length} procedure${today.length > 1 ? 's' : ''} today. Confirm all stakeholders are ready.`, severity: today.some(p => p.comms_health === 'critical') ? 'critical' as const : 'warning' as const }
        : { text: 'No procedures scheduled for today.', severity: 'positive' as const },
      totalPendingConfs > 0
        ? { text: `${totalPendingConfs} confirmation${totalPendingConfs > 1 ? 's' : ''} awaiting response across your pipeline.`, severity: 'warning' as const }
        : plans.length > 0
        ? { text: 'All confirmation requests resolved.', severity: 'positive' as const }
        : { text: 'Send scheduled-procedure notifications to start tracking confirmations.', severity: 'info' as const },
    ],
    benchmark: 'Specialists with >85% stakeholder confirmation see 60% fewer procedure-day complications.',
    cta:          { label: 'View pipeline',     href: '/communication' },
    secondaryCta: { label: 'Procedure planner', href: '/procedures' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <CommunicationPipelineClient
        specialist={specialist}
        plans={plans}
        analytics={analytics}
        buckets={{ today, tomorrow, thisWeek, upcoming, unscheduled }}
      />
    </AppLayout>
  )
}
