import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import ProtocolBuilderClient from './protocol-builder-client'

export default async function ProtocolBuilderPage({
  searchParams,
}: {
  searchParams: { protocol?: string }
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists')
    .select('id, name, specialty, city, role')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  // Fetch all protocols for this specialist
  const { data: protocols } = await supabase
    .from('triage_protocols')
    .select('id, name, protocol_type, is_active, is_default, version, created_at')
    .eq('specialist_id', specialist.id)
    .order('created_at', { ascending: false })

  // Fetch selected protocol questions
  let selectedProtocol = null
  let questions: any[] = []

  if (searchParams.protocol) {
    const { data: p } = await supabase
      .from('triage_protocols')
      .select('*')
      .eq('id', searchParams.protocol)
      .eq('specialist_id', specialist.id)
      .single()

    if (p) {
      selectedProtocol = p
      const { data: qs } = await supabase
        .from('triage_questions')
        .select('*')
        .eq('protocol_id', p.id)
        .order('sort_order')
      questions = qs || []
    }
  }

  // Fetch specialty templates
  const { data: templates } = await supabase
    .from('triage_protocol_templates')
    .select('id, specialty, name, description, protocol_type')
    .order('specialty')

  return (
    <ProtocolBuilderClient
      specialist={specialist}
      protocols={protocols || []}
      selectedProtocol={selectedProtocol}
      questions={questions}
      templates={templates || []}
    />
  )
}
