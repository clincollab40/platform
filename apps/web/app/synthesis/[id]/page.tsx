import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import SynthesisBriefClient from './synthesis-brief-client'

export default async function SynthesisBriefPage({ params }: { params: { id: string } }) {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: specialist } = await db
    .from('specialists')
    .select('id, name, specialty')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  const { data: job } = await db
    .from('synthesis_jobs')
    .select(`
      id, status, patient_name, trigger, clinical_brief,
      data_completeness, output_json, error_message,
      created_at, completed_at,
      agent_traces (
        tool_name, tool_status, output_summary, duration_ms, data_source, executed_at
      ),
      synthesis_findings (
        id, category, finding, significance, source, is_red_flag, red_flag_message
      )
    `)
    .eq('id', params.id)
    .eq('specialist_id', specialist.id)
    .single()

  if (!job) notFound()

  return <SynthesisBriefClient job={job} specialist={specialist} />
}
