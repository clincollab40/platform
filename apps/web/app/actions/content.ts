'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient }                from '@supabase/supabase-js'
import { redirect }                    from 'next/navigation'
import { revalidatePath }              from 'next/cache'

type BR<T> = { ok: true; value: T } | { ok: false; error: string }
async function boundary<T>(name: string, fn: () => Promise<T>): Promise<BR<T>> {
  try   { return { ok: true, value: await fn() } }
  catch (e) { console.error(`[M10:${name}]`, e); return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

async function getAuth() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const { data: s } = await supabase.from('specialists')
    .select('id, name, specialty').eq('google_id', user.id).single()
  if (!s) redirect('/onboarding')
  return { supabase, specialist: s }
}

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

function dispatchAsync(requestId: string) {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) return
  fetch(`${url}/api/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
    body: JSON.stringify({ requestId }),
  }).catch(e => console.error('[M10] dispatch error:', e))
}

// ════════════════════════════════════════════════════════════
// CREATE REQUEST
// ════════════════════════════════════════════════════════════

export async function createContentRequestAction(formData: FormData) {
  return boundary('create_request', async () => {
    const { supabase, specialist } = await getAuth()

    const topic        = (formData.get('topic') as string)?.trim()
    const contentType  = formData.get('content_type') as string
    const audience     = formData.get('audience') as string
    const depth        = formData.get('depth') as string
    const instructions = (formData.get('special_instructions') as string)?.trim() || null

    if (!topic || !contentType) throw new Error('Topic and content type are required')
    if (topic.length < 5) throw new Error('Topic is too short — please be more specific')
    if (topic.length > 500) throw new Error('Topic is too long — please be more concise')

    const { data, error } = await supabase.from('content_requests').insert({
      specialist_id:        specialist.id,
      topic,
      content_type:         contentType as any,
      specialty:            specialist.specialty,
      audience:             (audience || 'specialist_peers') as any,
      depth:                (depth || 'standard') as any,
      special_instructions: instructions,
      status:               'queued',
    }).select('id').single()

    if (error || !data) throw new Error('Could not create content request')

    // Dispatch to async pipeline
    dispatchAsync(data.id)

    revalidatePath('/content')
    return { requestId: data.id }
  })
}

// ════════════════════════════════════════════════════════════
// READ
// ════════════════════════════════════════════════════════════

export async function listContentRequestsAction() {
  return boundary('list_requests', async () => {
    const { supabase, specialist } = await getAuth()
    const { data } = await supabase
      .from('content_requests')
      .select('id, topic, content_type, status, sections_generated, tier1_sources_used, tier2_sources_found, sections_deleted, requires_specialist_review, specialist_reviewed, created_at, processing_ended_at')
      .eq('specialist_id', specialist.id)
      .order('created_at', { ascending: false })
      .limit(50)
    return data || []
  })
}

export async function getContentRequestAction(requestId: string) {
  return boundary('get_request', async () => {
    const { supabase, specialist } = await getAuth()
    const { data } = await supabase
      .from('content_requests')
      .select(`
        *,
        content_sections ( * ),
        content_sources ( id, url, title, credibility_score, evidence_tier, source_type, institution, used_in_output, excluded_reason, vancouver_citation, citation_number ),
        content_outputs ( id, format, file_url, file_size_kb, include_tier2, generated_at )
      `)
      .eq('id', requestId).eq('specialist_id', specialist.id).single()
    if (!data) throw new Error('Request not found')
    return data
  })
}

export async function getAgentTracesAction(requestId: string) {
  return boundary('get_traces', async () => {
    const { supabase, specialist } = await getAuth()
    const { data } = await supabase
      .from('content_agent_traces')
      .select('step_number, step_name, step_label, step_status, detail, duration_ms, created_at')
      .eq('request_id', requestId).eq('specialist_id', specialist.id)
      .order('step_number').order('created_at')
    return data || []
  })
}

// ════════════════════════════════════════════════════════════
// EDIT AND REVIEW
// ════════════════════════════════════════════════════════════

export async function editSectionAction(sectionId: string, newText: string) {
  return boundary('edit_section', async () => {
    const { supabase, specialist } = await getAuth()
    const { error } = await supabase.from('content_sections').update({
      is_edited:   true,
      edited_text: newText.trim(),
      edited_at:   new Date().toISOString(),
    }).eq('id', sectionId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not save edit')
    return true
  })
}

export async function approvePatientEducationAction(requestId: string) {
  return boundary('approve_patient_ed', async () => {
    const { supabase, specialist } = await getAuth()
    const { data: req } = await supabase.from('content_requests')
      .select('requires_specialist_review, content_type')
      .eq('id', requestId).eq('specialist_id', specialist.id).single()
    if (!req) throw new Error('Request not found')
    if (req.content_type !== 'patient_education') throw new Error('Only patient education requires review')

    const { error } = await supabase.from('content_requests').update({
      specialist_reviewed: true,
      reviewed_at:         new Date().toISOString(),
    }).eq('id', requestId).eq('specialist_id', specialist.id)
    if (error) throw new Error('Could not mark as reviewed')
    revalidatePath(`/content/${requestId}`)
    return true
  })
}

// ════════════════════════════════════════════════════════════
// GENERATE FILES (trigger re-render)
// ════════════════════════════════════════════════════════════

export async function generateFileAction(requestId: string, format: 'pptx' | 'docx', includeTier2: boolean) {
  return boundary('generate_file', async () => {
    const { specialist } = await getAuth()
    const url = process.env.NEXT_PUBLIC_APP_URL
    if (!url) throw new Error('APP_URL not configured')

    const res = await fetch(`${url}/api/content/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
      body: JSON.stringify({ requestId, format, includeTier2, specialistId: specialist.id }),
    })

    if (!res.ok) throw new Error('File generation failed')
    const { fileUrl, filename, sizeKb } = await res.json()
    return { fileUrl, filename, sizeKb }
  })
}
