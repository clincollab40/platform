import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import type { InsightData } from '@/components/layout/InsightPanel'
import ContentListClient from './content-list-client'

export default async function ContentPage() {
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

  const { data: requests } = await db
    .from('content_requests')
    .select('id, topic, content_type, status, sections_generated, tier1_sources_used, tier2_sources_found, sections_deleted, requires_specialist_review, specialist_reviewed, created_at, processing_ended_at')
    .eq('specialist_id', specialist.id)
    .order('created_at', { ascending: false })
    .limit(100)

  const all = requests || []
  const now  = new Date()
  const som  = new Date(now.getFullYear(), now.getMonth(), 1)          // start of this month
  const soy  = new Date(now.getFullYear(), 0, 1)                       // start of this year
  const ly   = new Date(now.getFullYear() - 1, now.getMonth(), 1)     // 12 months ago

  function isAfter(d: string, ref: Date) { return new Date(d) >= ref }

  const analytics = {
    total:        all.length,
    completed:    all.filter(r => r.status === 'completed').length,
    inProgress:   all.filter(r => !['completed','failed'].includes(r.status)).length,
    awaiting:     all.filter(r => r.requires_specialist_review && !r.specialist_reviewed).length,
    thisMonth:    all.filter(r => isAfter(r.created_at, som)).length,
    ytd:          all.filter(r => isAfter(r.created_at, soy)).length,
    lastYear:     all.filter(r => isAfter(r.created_at, ly)).length,
    // by category counts
    byType: {
      cme_presentation:   all.filter(r => r.content_type === 'cme_presentation').length,
      grand_rounds:       all.filter(r => r.content_type === 'grand_rounds').length,
      referral_guide:     all.filter(r => r.content_type === 'referral_guide').length,
      clinical_protocol:  all.filter(r => r.content_type === 'clinical_protocol').length,
      conference_abstract:all.filter(r => r.content_type === 'conference_abstract').length,
      roundtable_points:  all.filter(r => r.content_type === 'roundtable_points').length,
      case_discussion:    all.filter(r => r.content_type === 'case_discussion').length,
      patient_education:  all.filter(r => r.content_type === 'patient_education').length,
    },
    totalTier1Sources: all
      .filter(r => r.status === 'completed')
      .reduce((sum, r) => sum + (r.tier1_sources_used ?? 0), 0),
  }

  const cmeScore = analytics.total > 0
    ? Math.min(100, Math.round((analytics.completed / analytics.total) * 80) + (analytics.awaiting === 0 ? 20 : 0))
    : 0

  const insightData: InsightData = {
    moduleTitle: 'CME & Content Impact',
    score: cmeScore,
    scoreLabel: 'Content Impact Score',
    scoreColor: cmeScore >= 70 ? 'green' : cmeScore >= 40 ? 'amber' : 'blue',
    insights: [
      analytics.awaiting > 0
        ? { text: `${analytics.awaiting} content piece${analytics.awaiting > 1 ? 's need' : ' needs'} your review before download.`, severity: 'warning' as const }
        : analytics.completed > 0
        ? { text: 'All completed content has been reviewed. Ready to share.', severity: 'positive' as const }
        : { text: 'Generate your first evidence-based content to establish thought leadership.', severity: 'info' as const },
      analytics.inProgress > 0
        ? { text: `${analytics.inProgress} content job${analytics.inProgress > 1 ? 's' : ''} generating — check back shortly.`, severity: 'info' as const }
        : { text: 'No content generation in progress.', severity: 'info' as const },
      analytics.totalTier1Sources > 0
        ? { text: `${analytics.totalTier1Sources} peer-reviewed sources used. High credibility.`, severity: 'positive' as const }
        : { text: 'Content backed by Tier 1 sources (PubMed, Lancet, NEJM) builds referrer trust.', severity: 'info' as const },
    ],
    benchmark: `Specialists who share 2+ evidence pieces/month get 28% more peer engagement on WhatsApp.`,
    cta:          { label: 'Generate new content', href: '/content' },
    secondaryCta: { label: 'Review pending items', href: '/content?filter=review' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <ContentListClient
        specialist={specialist}
        requests={all}
        analytics={analytics}
      />
    </AppLayout>
  )
}
