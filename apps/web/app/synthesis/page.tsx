import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import type { InsightData } from '@/components/layout/InsightPanel'
import SynthesisListClient from './synthesis-list-client'

export default async function SynthesisPage() {
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

  const { data: jobs } = await db
    .from('synthesis_jobs')
    .select(`
      id, status, patient_name, trigger, data_completeness,
      clinical_brief, created_at, completed_at,
      synthesis_findings ( is_red_flag, significance )
    `)
    .eq('specialist_id', specialist.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const { data: protocols } = await db
    .from('triage_protocols')
    .select('id, name')
    .eq('specialist_id', specialist.id)
    .eq('is_active', true)

  const all = jobs || []
  const analytics = {
    total:     all.length,
    completed: all.filter(j => j.status === 'completed').length,
    running:   all.filter(j => j.status === 'running' || j.status === 'queued').length,
    withFlags: all.filter(j =>
      (j.synthesis_findings as any[])?.some((f: any) => f.is_red_flag)
    ).length,
  }

  // Average data completeness across completed jobs
  const completedJobs  = all.filter(j => j.status === 'completed' && j.data_completeness != null)
  const avgCompleteness = completedJobs.length > 0
    ? Math.round(completedJobs.reduce((sum, j) => sum + (j.data_completeness ?? 0), 0) / completedJobs.length)
    : 0

  const synthesisScore = analytics.total > 0
    ? Math.round((analytics.completed / analytics.total) * 60 + avgCompleteness * 0.4)
    : 0

  const insightData: InsightData = {
    moduleTitle: 'Pre-Consultation Synthesis',
    score: synthesisScore,
    scoreLabel: 'Synthesis Coverage Score',
    scoreColor: synthesisScore >= 70 ? 'green' : synthesisScore >= 40 ? 'amber' : 'blue',
    insights: [
      analytics.running > 0
        ? { text: `${analytics.running} synthesis job${analytics.running > 1 ? 's' : ''} currently running. Results arriving shortly.`, severity: 'info' as const }
        : analytics.total === 0
        ? { text: 'Run your first synthesis to generate a 360° patient brief before consultation.', severity: 'warning' as const }
        : { text: `${analytics.completed} synthesis jobs completed — patient briefs ready.`, severity: 'positive' as const },
      analytics.withFlags > 0
        ? { text: `${analytics.withFlags} synthesis job${analytics.withFlags > 1 ? 's' : ''} contain red flags. Review before consultation.`, severity: 'critical' as const }
        : { text: 'No red flags detected in recent syntheses.', severity: 'positive' as const },
      avgCompleteness > 0
        ? { text: `Average data completeness: ${avgCompleteness}%. Higher completeness = more accurate AI briefs.`, severity: avgCompleteness >= 70 ? 'positive' as const : 'warning' as const }
        : { text: 'Connect more data sources to improve synthesis quality.', severity: 'info' as const },
    ],
    benchmark: `Specialists who synthesise pre-consultation data reduce appointment time by 18 minutes on average.`,
    cta:          { label: 'Run new synthesis',    href: '/synthesis' },
    secondaryCta: { label: 'View flagged briefs',  href: '/synthesis' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <SynthesisListClient
        specialist={specialist}
        jobs={all}
        analytics={analytics}
        protocols={protocols || []}
      />
    </AppLayout>
  )
}
