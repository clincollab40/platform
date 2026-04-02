import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import type { InsightData } from '@/components/layout/InsightPanel'
import ProceduresListClient from './procedures-list-client'

export default async function ProceduresPage() {
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

  const { data: plans } = await db
    .from('procedure_plans')
    .select(`
      id, patient_name, procedure_name, urgency, status,
      scheduled_date, scheduled_time, consent_status,
      workup_complete, resources_confirmed, patient_ready, created_at,
      procedure_protocols ( procedure_code, ot_room_type )
    `)
    .eq('specialist_id', specialist.id)
    .not('status', 'in', '("completed","cancelled","declined")')
    .order('scheduled_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100)

  const { data: recentCompleted } = await db
    .from('procedure_plans')
    .select('id, patient_name, procedure_name, status, completed_at, outcome')
    .eq('specialist_id', specialist.id)
    .in('status', ['completed', 'cancelled'])
    .order('completed_at', { ascending: false })
    .limit(10)

  const { data: protocols } = await db
    .from('procedure_protocols')
    .select('id, procedure_name, procedure_code')
    .eq('specialist_id', specialist.id)
    .eq('is_active', true)
    .order('procedure_name')

  const active         = (plans || []).filter(p => !['counselling','patient_deciding'].includes(p.status))
  const scheduled      = (plans || []).filter(p => p.status === 'scheduled')
  const ready          = (plans || []).filter(p => p.status === 'ready_for_procedure')
  const pendingWorkup  = (plans || []).filter(p => !p.workup_complete && p.status !== 'counselling')
  const awaitingConsent = (plans || []).filter(p => p.consent_status !== 'signed')

  const analytics = {
    active:        active.length,
    scheduled:     scheduled.length,
    ready:         ready.length,
    pendingWorkup: pendingWorkup.length,
    awaitingConsent: awaitingConsent.length,
  }

  // Checklist compliance: what % of active plans have workup + consent done
  const compliant = (plans || []).filter(p => p.workup_complete && p.consent_status === 'signed').length
  const complianceRate = (plans || []).length > 0
    ? Math.round((compliant / (plans || []).length) * 100)
    : 100

  const insightData: InsightData = {
    moduleTitle: 'Procedure Readiness',
    score: complianceRate,
    scoreLabel: 'Checklist Compliance',
    scoreColor: complianceRate >= 80 ? 'green' : complianceRate >= 50 ? 'amber' : 'red',
    insights: [
      awaitingConsent.length > 0
        ? { text: `${awaitingConsent.length} patient${awaitingConsent.length > 1 ? 's' : ''} yet to sign consent. Follow up before scheduling.`, severity: 'critical' as const }
        : { text: 'All active patients have signed consent forms.', severity: 'positive' as const },
      pendingWorkup.length > 0
        ? { text: `${pendingWorkup.length} case${pendingWorkup.length > 1 ? 's' : ''} with incomplete workup. Complete before procedure day.`, severity: 'warning' as const }
        : active.length > 0
        ? { text: 'All active cases have complete workup reports.', severity: 'positive' as const }
        : { text: 'No active procedure plans. Add a new patient to begin.', severity: 'info' as const },
      ready.length > 0
        ? { text: `${ready.length} patient${ready.length > 1 ? 's are' : ' is'} fully ready for procedure. Confirm OT booking.`, severity: 'positive' as const }
        : { text: `${scheduled.length} procedure${scheduled.length !== 1 ? 's' : ''} scheduled. Ensure pre-op checklist is complete.`, severity: 'info' as const },
    ],
    benchmark: `Teams with >85% checklist compliance report 60% fewer day-of cancellations.`,
    cta:          { label: 'Add new procedure plan', href: '/procedures' },
    secondaryCta: { label: 'Review pending consent',  href: '/procedures?filter=consent' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <ProceduresListClient
        specialist={specialist}
        plans={plans || []}
        recentCompleted={recentCompleted || []}
        protocols={protocols || []}
        analytics={analytics}
      />
    </AppLayout>
  )
}
