import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import TemplatesClient from './templates-client'

export default async function TemplatesPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists').select('id, name, specialty').eq('google_id', user.id).single()
  if (!specialist) redirect('/onboarding')

  const { data: templates } = await supabase
    .from('note_templates')
    .select('*')
    .eq('specialist_id', specialist.id)
    .order('created_at', { ascending: false })

  const { data: defaults } = await supabase
    .from('note_template_defaults')
    .select('id, specialty, consultation_type, name, description')
    .order('specialty')

  return (
    <TemplatesClient
      specialist={specialist}
      templates={templates || []}
      defaults={defaults || []}
    />
  )
}
