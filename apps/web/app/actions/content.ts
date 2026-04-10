'use server'

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createClient }                from '@supabase/supabase-js'
import { redirect }                    from 'next/navigation'
import { revalidatePath }              from 'next/cache'

type BR<T> = { ok: true; value: T } | { ok: false; error: string }
async function boundary<T>(name: string, fn: () => Promise<T>): Promise<BR<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (e: any) {
    // Re-throw Next.js internal errors (redirect, notFound) — do NOT swallow them
    if (e?.digest?.startsWith('NEXT_REDIRECT') || e?.digest?.startsWith('NEXT_NOT_FOUND')) throw e
    // Also re-throw if the error has the redirect symbol (Next.js 14+)
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e
    console.error(`[M10:${name}]`, e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function getAuth() {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')
  const supabase = createServiceRoleClient()
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
// TOPIC INTELLIGENCE — ANALYSE + REFINE
// ════════════════════════════════════════════════════════════

export type RefinementQuestion = {
  id:       string
  text:     string
  options:  string[]
}

export type TopicAnalysis = {
  score:     number        // 0-100 specificity score
  missing:   string[]     // dimensions not yet present
  questions: RefinementQuestion[]
}

/**
 * Analyse a draft topic and return 3 targeted clinical questions
 * that will sharpen it for the pipeline. Questions are tuned to
 * content type and what is already present in the topic.
 */
export async function analyzeTopicAction(
  topic: string,
  contentType: string,
  specialty: string,
): Promise<{ ok: true; value: TopicAnalysis } | { ok: false; error: string }> {
  return boundary('analyze_topic', async () => {
    await getAuth()
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) throw new Error('Groq not configured')

    const typeLabel: Record<string, string> = {
      cme_presentation: 'CME Presentation', grand_rounds: 'Grand Rounds',
      referral_guide: 'Referring Doctor Guide', clinical_protocol: 'Clinical Protocol',
      conference_abstract: 'Conference Abstract', roundtable_points: 'Roundtable Talking Points',
      case_discussion: 'Case Discussion', patient_education: 'Patient Education',
    }

    const systemPrompt = `You are a clinical content strategist. A ${specialty} specialist is creating a "${typeLabel[contentType] || contentType}".

Analyse their draft topic and return exactly 3 targeted questions to sharpen it.
Each question must address a MISSING clinical dimension: patient population, specific intervention, comparator/context, evidence anchor (trial/guideline/year), or teaching angle.
Do NOT ask about things already clear in the topic.

For each question, provide 4-5 short answer chips (3-7 words each) that are clinically accurate and distinct.

Return ONLY valid JSON:
{
  "score": 35,
  "missing": ["patient population", "evidence anchor"],
  "questions": [
    {
      "id": "population",
      "text": "Which patient population is the focus?",
      "options": ["Diabetic CAD patients", "Post-STEMI patients", "Elderly (>75 yrs)", "High-risk CABG candidates", "General CAD population"]
    },
    {
      "id": "evidence",
      "text": "Which evidence base should anchor this?",
      "options": ["ACC/AHA 2023 guidelines", "ESC 2023 guidelines", "FREEDOM trial data", "Indian registry / CSI data", "Recent meta-analysis"]
    },
    {
      "id": "angle",
      "text": "What is the key clinical teaching point?",
      "options": ["Guidelines vs real-world practice", "Decision-making in complex cases", "Indian context and cost implications", "Emerging trial data impact"]
    }
  ]
}`

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Topic: "${topic}"` },
        ],
        temperature: 0.4,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) throw new Error('AI service unavailable')
    const json = await res.json()
    const parsed = JSON.parse(json.choices?.[0]?.message?.content || '{}')

    return {
      score:     typeof parsed.score === 'number' ? Math.min(100, Math.max(0, parsed.score)) : 30,
      missing:   Array.isArray(parsed.missing) ? parsed.missing : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 3) : [],
    } as TopicAnalysis
  })
}

/**
 * Compose a refined, pipeline-ready topic string from the original draft
 * plus the user's selected answers to the clarifying questions.
 */
export async function buildRefinedTopicAction(
  originalTopic: string,
  contentType:   string,
  answers:       string[],   // e.g. ["Diabetic CAD patients", "FREEDOM trial data", "Guidelines vs practice"]
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  return boundary('build_refined_topic', async () => {
    await getAuth()
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) throw new Error('Groq not configured')

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: `You compose precise, pipeline-ready clinical topic strings for a ${contentType.replace(/_/g,' ')}.
Combine the original topic with the user's additional context into ONE clear, specific topic phrase.
Rules:
- 80–160 characters
- Mention specific patient population, intervention, and evidence anchor
- Do NOT use bullet points or lists — one flowing phrase
- Do NOT start with "How to" or "A study of"
- Format: [Intervention/topic] in [population] — [evidence/guideline/trial] [context/angle]
Return ONLY the topic string, no quotes, no explanation.`,
          },
          {
            role: 'user',
            content: `Original topic: "${originalTopic}"\nUser clarifications: ${answers.join(' | ')}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 100,
      }),
    })

    if (!res.ok) throw new Error('AI service unavailable')
    const json  = await res.json()
    const text  = (json.choices?.[0]?.message?.content || '').trim()
                    .replace(/^["']|["']$/g, '')   // strip surrounding quotes if any
    if (!text || text.length < 20) throw new Error('Could not compose topic')
    return text
  })
}

// ════════════════════════════════════════════════════════════
// SUGGEST TOPIC ANGLES (kept for backwards compat)
// ════════════════════════════════════════════════════════════

export async function suggestTopicAnglesAction(topic: string, contentType: string) {
  return boundary('suggest_angles', async () => {
    await getAuth()
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) throw new Error('Groq not configured')

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: `Suggest 4 specific, evidence-rich clinical topic angles for a ${contentType.replace(/_/g,' ')}. Return ONLY a JSON array of 4 strings.` },
          { role: 'user', content: `Topic: "${topic}"` },
        ],
        temperature: 0.7,
        max_tokens: 400,
      }),
    })
    if (!res.ok) throw new Error('AI service unavailable')
    const json = await res.json()
    const text = json.choices?.[0]?.message?.content?.trim() || '[]'
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []
    return (JSON.parse(match[0]) as string[]).slice(0, 4)
  })
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
