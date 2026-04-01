import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import SynthesisListClient from './synthesis-list-client'

export default async function SynthesisPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists').select('id, name, specialty').eq('google_id', user.id).single()
  if (!specialist) redirect('/onboarding')

  const { data: jobs } = await supabase
    .from('synthesis_jobs')
    .select(`
      id, status, patient_name, trigger, data_completeness,
      clinical_brief, created_at, completed_at,
      synthesis_findings ( is_red_flag, significance )
    `)
    .eq('specialist_id', specialist.id)
    .order('created_at', { ascending: false })
    .limit(50)

  // Analytics
  const all = jobs || []
  const analytics = {
    total:     all.length,
    completed: all.filter(j => j.status === 'completed').length,
    running:   all.filter(j => j.status === 'running' || j.status === 'queued').length,
    withFlags: all.filter(j =>
      (j.synthesis_findings as any[])?.some((f: any) => f.is_red_flag)
    ).length,
  }

  // Fetch active triage protocols for the "send triage + synthesise" flow
  const { data: protocols } = await supabase
    .from('triage_protocols')
    .select('id, name').eq('specialist_id', specialist.id).eq('is_active', true)

  return (
    <SynthesisListClient
      specialist={specialist}
      jobs={all}
      analytics={analytics}
      protocols={protocols || []}
    />
  )
}
