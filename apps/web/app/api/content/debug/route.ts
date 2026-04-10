/**
 * GET /api/content/debug
 * Diagnostic endpoint — verifies every integration the pipeline depends on.
 * Visit this URL after deploy to confirm everything is wired correctly.
 * Protected by INTERNAL_API_KEY header.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Groq from 'groq-sdk'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const key = request.headers.get('x-internal-key') || ''
  if (process.env.INTERNAL_API_KEY && key !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, any> = {}

  // 1. Environment variables
  results.env = {
    GROQ_API_KEY:               process.env.GROQ_API_KEY ? `set (${process.env.GROQ_API_KEY.slice(0, 8)}...)` : 'MISSING ❌',
    NEXT_PUBLIC_SUPABASE_URL:   process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set ✅' : 'MISSING ❌',
    SUPABASE_SERVICE_ROLE_KEY:  process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set ✅' : 'MISSING ❌',
    INTERNAL_API_KEY:           process.env.INTERNAL_API_KEY ? 'set ✅' : 'MISSING ❌',
    NEXT_PUBLIC_APP_URL:        process.env.NEXT_PUBLIC_APP_URL || 'MISSING ❌',
  }

  // 2. Pipeline module import
  try {
    const { runContentPipeline } = await import('@/lib/content-pipeline')
    results.pipeline_import = typeof runContentPipeline === 'function' ? 'ok ✅' : 'imported but not a function ❌'
  } catch (e: any) {
    results.pipeline_import = `FAILED ❌: ${e.message}`
  }

  // 3. Groq API
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'Reply with exactly: {"ok":true}' }],
      max_tokens: 20,
      response_format: { type: 'json_object' },
    })
    const content = completion.choices[0]?.message?.content || ''
    results.groq_api = `ok ✅ response: ${content.slice(0, 50)}`
  } catch (e: any) {
    results.groq_api = `FAILED ❌: ${e.message}`
  }

  // 4. Supabase DB
  try {
    const sc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )
    const { data, error } = await sc.from('content_requests').select('id').limit(1)
    if (error) throw new Error(error.message)
    results.supabase_db = `ok ✅ (content_requests table accessible)`
  } catch (e: any) {
    results.supabase_db = `FAILED ❌: ${e.message}`
  }

  // 5. Recent failed requests — shows actual error messages
  try {
    const sc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )
    const { data } = await sc
      .from('content_requests')
      .select('id, topic, status, error_message, created_at')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(5)
    results.recent_failures = data || []
  } catch (e: any) {
    results.recent_failures = `Could not fetch: ${e.message}`
  }

  return NextResponse.json(results, { status: 200 })
}
