import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import TriageSessionsClient from './sessions-client'

export default async function TriageSessionsPage({
  searchParams,
}: {
  searchParams: { status?: string; protocol?: string }
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists')
    .select('id, name, specialty, city')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  // Fetch sessions — last 90 days
  const since = new Date(Date.now() - 90 * 86400000).toISOString()

  const { data: sessions } = await supabase
    .from('triage_sessions')
    .select(`
      id, patient_name, patient_mobile, patient_age, patient_gender,
      status, red_flag_level, red_flag_summary, ai_synopsis,
      language, channel, created_at, completed_at, started_at,
      triage_protocols ( name, protocol_type )
    `)
    .eq('specialist_id', specialist.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200)

  // Fetch protocols for filter dropdown
  const { data: protocols } = await supabase
    .from('triage_protocols')
    .select('id, name')
    .eq('specialist_id', specialist.id)
    .eq('is_active', true)
    .order('name')

  // Analytics
  const all = sessions || []
  const analytics = {
    total:       all.length,
    completed:   all.filter(s => s.status === 'completed').length,
    flagged:     all.filter(s => s.red_flag_level !== 'none' && s.status === 'completed').length,
    urgent:      all.filter(s => s.red_flag_level === 'urgent').length,
    thisWeek:    all.filter(s => new Date(s.created_at) > new Date(Date.now() - 7 * 86400000)).length,
  }

  return (
    <TriageSessionsClient
      specialist={specialist}
      sessions={all}
      protocols={protocols || []}
      analytics={analytics}
      initialStatus={searchParams.status || 'all'}
      initialProtocol={searchParams.protocol || 'all'}
    />
  )
}
