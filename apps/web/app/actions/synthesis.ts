'use server'

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

type BoundaryResult<T> = { ok: true; value: T } | { ok: false; error: string }

async function boundary<T>(name: string, fn: () => Promise<T>): Promise<BoundaryResult<T>> {
  try   { return { ok: true, value: await fn() } }
  catch (e) { console.error(`[M6:${name}]`, e); return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

async function getAuthSpecialist() {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')
  const supabase = createServiceRoleClient()
  const { data: s } = await supabase.from('specialists').select('id, name, specialty, role').eq('google_id', user.id).single()
  if (!s) redirect('/onboarding')
  return { supabase, specialist: s }
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

function dispatchAsync(jobId: string) {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) return
  fetch(`${url}/api/synthesis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
    body: JSON.stringify({ jobId }),
  }).catch(e => console.error('[M6] async dispatch error:', e))
}

export async function triggerSynthesisAction(
  patientName: string, patientMobile?: string,
  triageSessionId?: string, referralCaseId?: string, appointmentId?: string
): Promise<BoundaryResult<{ jobId: string }>> {
  return boundary('trigger', async () => {
    const { supabase, specialist } = await getAuthSpecialist()
    const { data: jobId, error } = await supabase.rpc('create_synthesis_job', {
      p_specialist_id: specialist.id, p_patient_name: patientName,
      p_patient_mobile: patientMobile || null, p_trigger: 'manual',
      p_triage_session_id: triageSessionId || null,
      p_referral_case_id: referralCaseId || null,
      p_appointment_id: appointmentId || null, p_priority: 5,
    })
    if (error || !jobId) throw new Error('Could not create synthesis job.')
    dispatchAsync(String(jobId))
    revalidatePath('/synthesis')
    return { jobId: String(jobId) }
  })
}

export async function getSynthesisJobAction(jobId: string) {
  return boundary('get_job', async () => {
    const { supabase, specialist } = await getAuthSpecialist()
    const { data: job, error } = await supabase
      .from('synthesis_jobs')
      .select(`id, status, clinical_brief, data_completeness, output_json, error_message, created_at, completed_at, patient_name, trigger,
        agent_traces ( tool_name, tool_status, output_summary, duration_ms, data_source, executed_at ),
        synthesis_findings ( id, category, finding, significance, source, is_red_flag, red_flag_message )`)
      .eq('id', jobId).eq('specialist_id', specialist.id).single()
    if (error || !job) throw new Error('Job not found.')
    return job
  })
}

export async function listSynthesisJobsAction(limit = 20) {
  return boundary('list_jobs', async () => {
    const { supabase, specialist } = await getAuthSpecialist()
    const { data: jobs } = await supabase
      .from('synthesis_jobs')
      .select(`id, status, patient_name, trigger, data_completeness, clinical_brief, created_at, completed_at, synthesis_findings ( is_red_flag, significance )`)
      .eq('specialist_id', specialist.id).order('created_at', { ascending: false }).limit(limit)
    return jobs || []
  })
}

export async function retrySynthesisAction(jobId: string) {
  return boundary('retry', async () => {
    const { supabase, specialist } = await getAuthSpecialist()
    const { data: existing } = await supabase
      .from('synthesis_jobs').select('id, retry_count, max_retries')
      .eq('id', jobId).eq('specialist_id', specialist.id).eq('status', 'failed').single()
    if (!existing) throw new Error('Cannot retry — job not found or not failed.')
    if (existing.retry_count >= existing.max_retries) throw new Error('Maximum retries reached.')
    await supabase.from('synthesis_jobs')
      .update({ status: 'queued', error_message: null, retry_count: existing.retry_count + 1 })
      .eq('id', jobId)
    dispatchAsync(jobId)
    revalidatePath(`/synthesis/${jobId}`)
    return { jobId }
  })
}

export async function getModuleHealthAction() {
  return boundary('health', async () => {
    const sc = serviceClient()
    const { data } = await sc.from('v_latest_module_health').select('*')
    return data || []
  })
}
