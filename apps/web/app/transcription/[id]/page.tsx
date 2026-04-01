import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import SessionDetailClient from './session-detail-client'

export default async function SessionDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists').select('id, name, specialty').eq('google_id', user.id).single()
  if (!specialist) redirect('/onboarding')

  const { data: session } = await supabase
    .from('transcription_sessions')
    .select(`*, note_templates(*), consultation_notes(*)`)
    .eq('id', params.id).eq('specialist_id', specialist.id).single()

  if (!session) notFound()

  return <SessionDetailClient session={session} specialist={specialist} />
}
