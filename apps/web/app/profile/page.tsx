import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import type { InsightData } from '@/components/layout/InsightPanel'
import ProfileClient from './profile-client'

export default async function ProfilePage() {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: specialist } = await db
    .from('specialists')
    .select('id, name, specialty, city, email, role, status, whatsapp_number, created_at')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  const { data: profile } = await db
    .from('specialist_profiles')
    .select('designation, sub_specialty, hospitals, years_experience, mci_number, photo_url, bio, completeness_pct')
    .eq('specialist_id', specialist.id)
    .single()

  const completeness = profile?.completeness_pct ?? 0

  const insightData: InsightData = {
    moduleTitle: 'Profile Completeness',
    score: completeness,
    scoreLabel: 'Profile Score',
    scoreColor: completeness >= 80 ? 'green' : completeness >= 50 ? 'amber' : 'red',
    insights: [
      completeness < 100
        ? { text: 'Complete your profile to unlock advanced referral analytics.', severity: 'warning' as const }
        : { text: 'Profile fully complete. You are discoverable by peers.', severity: 'positive' as const },
      !profile?.mci_number
        ? { text: 'Add your MCI registration number to build credibility with referrers.', severity: 'info' as const }
        : { text: 'MCI number verified and on record.', severity: 'positive' as const },
      !profile?.bio
        ? { text: 'A short professional bio improves trust with new referral partners.', severity: 'info' as const }
        : { text: 'Professional bio added — peers can understand your clinical focus.', severity: 'positive' as const },
    ],
    benchmark: 'Specialists with complete profiles receive 28% more peer referrals on average.',
    cta: { label: 'View referral network', href: '/network' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <ProfileClient
        specialist={specialist as any}
        profile={profile || null}
      />
    </AppLayout>
  )
}
