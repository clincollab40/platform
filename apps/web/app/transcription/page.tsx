import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import type { InsightData } from '@/components/layout/InsightPanel'
import TranscriptionListClient from './transcription-list-client'

export default async function TranscriptionPage() {
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

  const { data: sessions } = await db
    .from('transcription_sessions')
    .select(`
      id, patient_name, consultation_type, status,
      audio_duration_secs, recording_started_at, created_at,
      note_templates ( name ),
      consultation_notes ( ai_confidence, ai_flags )
    `)
    .eq('specialist_id', specialist.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const { data: templates } = await db
    .from('note_templates')
    .select('id, name, consultation_type, is_default')
    .eq('specialist_id', specialist.id)
    .eq('is_active', true)
    .order('name')

  const all = sessions || []
  const analytics = {
    total:         all.length,
    pendingReview: all.filter(s => s.status === 'pending_review').length,
    approved:      all.filter(s => s.status === 'approved').length,
    sent:          all.filter(s => s.status === 'sent_to_patient').length,
  }

  const approvalRate = all.length > 0
    ? Math.round(((analytics.approved + analytics.sent) / all.length) * 100)
    : 0

  // Average AI confidence across notes
  const notesWithConfidence = all
    .flatMap(s => (s.consultation_notes as any[]) || [])
    .filter(n => n?.ai_confidence != null)
  const avgConfidence = notesWithConfidence.length > 0
    ? Math.round(notesWithConfidence.reduce((sum: number, n: any) => sum + n.ai_confidence, 0) / notesWithConfidence.length)
    : 0

  const insightData: InsightData = {
    moduleTitle: 'Consultation Notes',
    score: approvalRate || avgConfidence || 0,
    scoreLabel: analytics.total > 0 ? 'Notes Approval Rate' : 'AI Confidence (avg)',
    scoreColor: approvalRate >= 70 ? 'green' : approvalRate >= 40 ? 'amber' : 'blue',
    insights: [
      analytics.pendingReview > 0
        ? { text: `${analytics.pendingReview} note${analytics.pendingReview > 1 ? 's' : ''} awaiting your review. Don't let them pile up.`, severity: 'warning' as const }
        : all.length > 0
        ? { text: 'All notes reviewed. Your documentation is up to date.', severity: 'positive' as const }
        : { text: 'Start your first recording to generate AI-powered consultation notes.', severity: 'info' as const },
      avgConfidence > 0
        ? { text: `Average AI confidence: ${avgConfidence}%. ${avgConfidence >= 85 ? 'Excellent accuracy.' : 'Use a template to improve accuracy.'}`, severity: avgConfidence >= 85 ? 'positive' as const : 'warning' as const }
        : { text: 'Use specialty-specific templates for higher AI accuracy in your notes.', severity: 'info' as const },
      (templates || []).length === 0
        ? { text: 'No note templates configured. Templates improve transcription accuracy.', severity: 'warning' as const }
        : { text: `${(templates || []).length} note template${(templates || []).length > 1 ? 's' : ''} active for your specialty.`, severity: 'positive' as const },
    ],
    benchmark: `Specialists using AI transcription document consultations 4× faster with 91% accuracy.`,
    cta:          { label: 'Start new recording',   href: '/transcription' },
    secondaryCta: { label: 'Manage templates',      href: '/transcription/templates' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <TranscriptionListClient
        specialist={specialist}
        sessions={all}
        templates={templates || []}
        analytics={analytics}
      />
    </AppLayout>
  )
}
