import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import TemplatesClient from './templates-client'

export default async function TemplatesPage() {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: specialist } = await db
    .from('specialists').select('id, name, specialty').eq('google_id', user.id).single()
  if (!specialist) redirect('/onboarding')

  const { data: templates } = await db
    .from('note_templates')
    .select('*')
    .eq('specialist_id', specialist.id)
    .order('created_at', { ascending: false })

  const { data: defaults } = await db
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
