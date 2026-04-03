import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import ContentDetailClient from './content-detail-client'

export default async function ContentDetailPage({ params }: { params: { id: string } }) {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: specialist } = await db
    .from('specialists').select('id, name, specialty').eq('google_id', user.id).single()
  if (!specialist) redirect('/onboarding')

  const { data: request } = await db
    .from('content_requests')
    .select(`
      *,
      content_sections ( * ),
      content_sources ( id, url, title, credibility_score, evidence_tier, source_type, institution, used_in_output, excluded_reason, vancouver_citation, citation_number ),
      content_outputs ( * )
    `)
    .eq('id', params.id).eq('specialist_id', specialist.id).single()

  if (!request) notFound()

  const { data: traces } = await db
    .from('content_agent_traces')
    .select('step_number, step_name, step_label, step_status, detail, duration_ms, created_at')
    .eq('request_id', params.id).eq('specialist_id', specialist.id)
    .order('step_number').order('created_at')

  return (
    <ContentDetailClient
      request={request}
      traces={traces || []}
      specialist={specialist}
    />
  )
}
