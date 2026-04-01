import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import TranscriptionListClient from './transcription-list-client'

export default async function TranscriptionPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists').select('id, name, specialty').eq('google_id', user.id).single()
  if (!specialist) redirect('/onboarding')

  const { data: sessions } = await supabase
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

  const { data: templates } = await supabase
    .from('note_templates')
    .select('id, name, consultation_type, is_default')
    .eq('specialist_id', specialist.id)
    .eq('is_active', true)
    .order('name')

  const analytics = {
    total:         (sessions || []).length,
    pendingReview: (sessions || []).filter(s => s.status === 'pending_review').length,
    approved:      (sessions || []).filter(s => s.status === 'approved').length,
    sent:          (sessions || []).filter(s => s.status === 'sent_to_patient').length,
  }

  return (
    <TranscriptionListClient
      specialist={specialist}
      sessions={sessions || []}
      templates={templates || []}
      analytics={analytics}
    />
  )
}
