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

  // ── Case-centric query ────────────────────────────────────────────────────
  // referral_cases is the source of truth; all completeness is derived here
  const { data: cases } = await db
    .from('referral_cases')
    .select(`
      id, reference_no, patient_name, patient_mobile, patient_gender,
      chief_complaint, procedure_recommended, urgency, status,
      created_at, submitted_at,
      referring_doctors ( name, specialty, clinic_name ),
      referral_clinical_data ( id, lab_summary, ecg_findings, vitals ),
      referral_documents ( id, file_name, file_type, uploaded_by ),
      triage_sessions (
        id, status, red_flag_level, red_flag_summary, ai_synopsis,
        completed_at, poc_reviewed_at
      )
    `)
    .eq('specialist_id', specialist.id)
    .not('status', 'in', '("declined","cancelled")')
    .order('created_at', { ascending: false })
    .limit(100)

  // ── Parallel: synthesis jobs + confirmed appointments ─────────────────────
  const [{ data: synthJobs }, { data: appointments }] = await Promise.all([
    db
      .from('synthesis_jobs')
      .select('id, referral_case_id, status, clinical_brief, data_completeness, created_at')
      .eq('specialist_id', specialist.id)
      .not('referral_case_id', 'is', null)
      .order('created_at', { ascending: false }),
    db
      .from('appointments')
      .select('id, referral_case_id, status')
      .eq('specialist_id', specialist.id)
      .eq('status', 'confirmed'),
  ])

  // Build O(1) lookup maps
  const synthJobMap = new Map<string, { id: string; status: string; clinical_brief: string | null; data_completeness: number }>()
  for (const j of synthJobs || []) {
    if (j.referral_case_id && !synthJobMap.has(j.referral_case_id)) {
      synthJobMap.set(j.referral_case_id, j)
    }
  }
  const appointmentCaseIds = new Set(
    (appointments || []).map((a: any) => a.referral_case_id).filter(Boolean)
  )

  // ── Enrich each case with completeness stages ─────────────────────────────
  const enrichedCases = (cases || []).map(c => {
    const docs        = (c.referral_documents as any[]) || []
    const clinData    = (c.referral_clinical_data as any[]) || []
    const triageSess  = (c.triage_sessions as any[]) || []
    const synthJob    = synthJobMap.get(c.id) || null

    const hasReferringDrData =
      clinData.length > 0 ||
      docs.some((d: any) => d.uploaded_by === 'referring_doctor')

    const completedTriage = triageSess.find((t: any) => t.status === 'completed')
    const hasTriageCompleted = !!completedTriage
    const hasPocReview       = triageSess.some((t: any) => t.poc_reviewed_at != null)
    const hasAppointment     = appointmentCaseIds.has(c.id)

    // 0 – 4 stages complete
    const completenessStage = [
      hasReferringDrData,
      hasTriageCompleted,
      hasPocReview,
      hasAppointment,
    ].filter(Boolean).length

    return {
      id:                   c.id,
      reference_no:         c.reference_no,
      patient_name:         c.patient_name,
      patient_mobile:       c.patient_mobile,
      patient_gender:       c.patient_gender,
      chief_complaint:      c.chief_complaint,
      procedure_recommended:c.procedure_recommended,
      urgency:              c.urgency as string,
      status:               c.status as string,
      created_at:           c.created_at,
      submitted_at:         c.submitted_at,
      referring_doctor:     (c.referring_doctors as any) || null,
      document_count:       docs.length,
      has_referring_dr_data: hasReferringDrData,
      has_triage_completed:  hasTriageCompleted,
      has_poc_review:        hasPocReview,
      has_appointment:       hasAppointment,
      triage_red_flag:       completedTriage?.red_flag_level || null,
      triage_synopsis:       completedTriage?.ai_synopsis || null,
      ai_brief:              synthJob?.clinical_brief || null,
      completeness_stage:    completenessStage,
      synthesis_job_id:      synthJob?.id || null,
      synthesis_status:      synthJob?.status || null,
    }
  })

  // ── Summary analytics ─────────────────────────────────────────────────────
  const analytics = {
    total:              enrichedCases.length,
    hasReferringDrData: enrichedCases.filter(c => c.has_referring_dr_data).length,
    hasTriaged:         enrichedCases.filter(c => c.has_triage_completed).length,
    hasAppointment:     enrichedCases.filter(c => c.has_appointment).length,
    complete:           enrichedCases.filter(c => c.completeness_stage >= 3).length,
    urgent:             enrichedCases.filter(c => c.urgency === 'urgent' || c.urgency === 'emergency').length,
  }

  const synthesisScore = analytics.total > 0
    ? Math.round((analytics.complete / analytics.total) * 100)
    : 0

  const insightData: InsightData = {
    moduleTitle:  'Pre-Consultation Synthesis',
    score:        synthesisScore,
    scoreLabel:   'Case Completeness',
    scoreColor:   synthesisScore >= 70 ? 'green' : synthesisScore >= 40 ? 'amber' : 'blue',
    insights: [
      analytics.total === 0
        ? { text: 'No referral cases yet. Once referring doctors send cases, they appear here.', severity: 'info' as const }
        : { text: `${analytics.total} case${analytics.total > 1 ? 's' : ''} received. ${analytics.complete} fully complete.`, severity: 'positive' as const },
      analytics.urgent > 0
        ? { text: `${analytics.urgent} urgent/emergency case${analytics.urgent > 1 ? 's' : ''} in pipeline.`, severity: 'critical' as const }
        : { text: 'No urgent cases pending.', severity: 'positive' as const },
      analytics.hasTriaged < analytics.total
        ? { text: `${analytics.total - analytics.hasTriaged} case${analytics.total - analytics.hasTriaged > 1 ? 's' : ''} not yet triaged.`, severity: 'warning' as const }
        : analytics.total > 0
        ? { text: 'All cases have been triaged by the virtual nurse.', severity: 'positive' as const }
        : { text: 'Virtual nurse will triage patients automatically via WhatsApp.', severity: 'info' as const },
    ],
    benchmark:    'Complete case data reduces average consultation time by 18 minutes.',
    cta:          { label: 'View all cases',    href: '/synthesis' },
    secondaryCta: { label: 'Referral network',  href: '/network' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <SynthesisListClient
        specialist={specialist}
        cases={enrichedCases}
        analytics={analytics}
      />
    </AppLayout>
  )
}
