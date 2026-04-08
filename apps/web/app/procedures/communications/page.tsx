// This route has moved to /communication
// Redirect to new top-level Communications Pipeline module
import { redirect } from 'next/navigation'

export default async function CommsDashboardPage({
  searchParams,
}: { searchParams: { plan?: string } }) {
  // Preserve plan context if provided — redirect to case journey
  if (searchParams.plan) {
    redirect(`/communication/${searchParams.plan}`)
  }
  redirect('/communication')
  // Legacy code below kept for reference but no longer executed
  const authClient = await (null as any)
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: specialist } = await db
    .from('specialists')
    .select('id, name, specialty, city, role')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  // If no planId in query, auto-redirect to the most recent active plan
  let planId = searchParams.plan
  if (!planId) {
    const { data: latestPlan } = await db
      .from('procedure_plans')
      .select('id')
      .eq('specialist_id', specialist.id)
      .not('status', 'in', '("completed","cancelled","declined")')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (latestPlan?.id) {
      redirect(`/procedures/communications?plan=${latestPlan.id}`)
    } else {
      redirect('/procedures')
    }
  }

  const { data: plan } = await db
    .from('procedure_plans')
    .select('id, patient_name, procedure_name, scheduled_date, status, urgency')
    .eq('id', planId)
    .eq('specialist_id', specialist.id)
    .single()

  if (!plan) redirect('/procedures')

  const [stakeholdersRes, confirmationsRes, escalationsRes, milestonesRes, adherenceRes] = await Promise.all([
    db.from('procedure_stakeholders')
      .select(`*, communication_threads(id, unread_count, total_messages, last_event_at, pending_confirmations)`)
      .eq('plan_id', planId).eq('specialist_id', specialist.id).order('sort_order'),
    db.from('confirmation_requests')
      .select(`*, procedure_stakeholders(name, role)`)
      .eq('plan_id', planId).eq('specialist_id', specialist.id)
      .order('sent_at', { ascending: false }).limit(30),
    db.from('escalation_events')
      .select('*').eq('plan_id', planId).eq('specialist_id', specialist.id)
      .order('created_at', { ascending: false }).limit(10),
    db.from('post_procedure_milestones')
      .select('*').eq('plan_id', planId).eq('specialist_id', specialist.id).order('sequence_order'),
    db.from('patient_adherence_log')
      .select('*').eq('plan_id', planId).eq('specialist_id', specialist.id)
      .order('check_date', { ascending: false }).limit(20),
  ])

  const { data: templates } = await db
    .from('communication_templates')
    .select('id, name, role, trigger_event, is_confirmation_request')
    .or(`specialist_id.eq.${specialist.id},specialist_id.is.null`)
    .eq('is_active', true).order('role')

  const stakeholders  = stakeholdersRes.data  || []
  const confirmations = confirmationsRes.data  || []
  const escalations   = escalationsRes.data    || []
  const milestones    = milestonesRes.data     || []
  const adherence     = adherenceRes.data      || []

  const sentConfs      = confirmations.length
  const respondedConfs = confirmations.filter((c: any) => c.responded_at != null).length
  const engagementRate = sentConfs > 0 ? Math.round((respondedConfs / sentConfs) * 100) : 0

  const pendingConfs  = confirmations.filter((c: any) => !c.responded_at).length
  const unreadThreads = stakeholders.filter(
    (s: any) => s.communication_threads?.[0]?.unread_count > 0
  ).length

  const insightData: InsightData = {
    moduleTitle: 'Procedure Communications',
    score: engagementRate || (stakeholders.length > 0 ? 50 : 0),
    scoreLabel: 'Stakeholder Engagement',
    scoreColor: engagementRate >= 70 ? 'green' : engagementRate >= 40 ? 'amber' : 'red',
    insights: [
      pendingConfs > 0
        ? { text: `${pendingConfs} confirmation${pendingConfs > 1 ? 's' : ''} awaiting response from stakeholders.`, severity: 'warning' as const }
        : sentConfs > 0
        ? { text: 'All confirmations responded to. Stakeholders are aligned.', severity: 'positive' as const }
        : { text: 'Send confirmation requests to keep stakeholders aligned on procedure day.', severity: 'info' as const },
      unreadThreads > 0
        ? { text: `${unreadThreads} thread${unreadThreads > 1 ? 's' : ''} with unread messages. Reply to maintain momentum.`, severity: 'warning' as const }
        : { text: 'No unread messages across stakeholder threads.', severity: 'positive' as const },
      escalations.length > 0
        ? { text: `${escalations.length} escalation event${escalations.length > 1 ? 's' : ''} logged. Review for patient safety.`, severity: 'critical' as const }
        : { text: 'No escalations raised for this procedure.', severity: 'positive' as const },
    ],
    benchmark: `Teams with >80% stakeholder engagement have 55% fewer procedure-day complications.`,
    cta:          { label: 'Send confirmation',    href: '#confirmations' },
    secondaryCta: { label: 'View stakeholders',    href: '#stakeholders' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <CommsDashboardClient
        plan={plan}
        specialist={specialist}
        stakeholders={stakeholders}
        confirmations={confirmations}
        escalations={escalations}
        milestones={milestones}
        adherence={adherence}
        templates={templates || []}
      />
    </AppLayout>
  )
}
