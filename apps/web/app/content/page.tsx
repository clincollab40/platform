import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import ContentListClient from './content-list-client'

export default async function ContentPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists').select('id, name, specialty').eq('google_id', user.id).single()
  if (!specialist) redirect('/onboarding')

  const { data: requests } = await supabase
    .from('content_requests')
    .select('id, topic, content_type, status, sections_generated, tier1_sources_used, tier2_sources_found, sections_deleted, requires_specialist_review, specialist_reviewed, created_at, processing_ended_at')
    .eq('specialist_id', specialist.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const analytics = {
    total:    (requests || []).length,
    completed:(requests || []).filter(r => r.status === 'completed').length,
    inProgress:(requests || []).filter(r => !['completed','failed'].includes(r.status)).length,
    awaiting: (requests || []).filter(r => r.requires_specialist_review && !r.specialist_reviewed).length,
  }

  return (
    <ContentListClient
      specialist={specialist}
      requests={requests || []}
      analytics={analytics}
    />
  )
}
