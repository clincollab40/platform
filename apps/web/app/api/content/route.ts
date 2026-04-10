import { NextRequest, NextResponse } from 'next/server'

// STATIC import — always bundled by Next.js into the serverless function.
// Previously this was a dynamic import('../../../../../services/content-agent/content-pipeline')
// which resolved to a file OUTSIDE apps/web/ — that file does not exist in the
// Vercel deployment bundle, causing "Cannot find module" → status='failed' on every run.
import { runContentPipeline } from '@/lib/content-pipeline'
import { createClient }       from '@supabase/supabase-js'

export const dynamic    = 'force-dynamic'
export const maxDuration = 60   // Vercel Hobby plan max

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// POST /api/content — trigger pipeline for a queued request
export async function POST(request: NextRequest) {
  // Validate internal key
  const key = request.headers.get('x-internal-key') || ''
  if (process.env.INTERNAL_API_KEY && key !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let requestId: string
  try {
    const body = await request.json()
    requestId  = body.requestId
    if (!requestId) throw new Error('missing requestId')
  } catch {
    return NextResponse.json({ error: 'requestId required' }, { status: 400 })
  }

  const sc = svc()

  // Load request — verify it exists and is actionable
  const { data: req } = await sc
    .from('content_requests')
    .select('*, specialists(id, name, specialty)')
    .eq('id', requestId)
    .single()

  if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (!['queued', 'failed'].includes(req.status)) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  // Mark as started
  await sc.from('content_requests').update({
    status: 'decomposing',
    processing_started_at: new Date().toISOString(),
    error_message: null,
  }).eq('id', requestId)

  const specialist = req.specialists as any

  try {
    // AWAITED — Vercel keeps the function alive for maxDuration.
    // The client polls /api/content (GET) independently for progress.
    await runContentPipeline({
      requestId,
      specialistId:        specialist.id,
      specialistName:      specialist.name       || 'Dr. Specialist',
      specialistSpecialty: specialist.specialty  || 'Clinical Specialist',
      topic:               req.topic,
      contentType:         req.content_type,
      audience:            req.audience          || 'specialist_peers',
      depth:               req.depth             || 'standard',
      specialInstructions: req.special_instructions || null,
    })

    return NextResponse.json({ ok: true, requestId })

  } catch (error) {
    // Pipeline threw — write actual error to DB so UI can display it
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[/api/content] Pipeline error:', msg)
    await sc.from('content_requests').update({
      status: 'failed',
      error_message: msg,
    }).eq('id', requestId).catch(() => {})

    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// GET /api/content?requestId=xxx&after=N — polling endpoint for client
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const requestId = searchParams.get('requestId')
  const after     = parseInt(searchParams.get('after') || '0', 10)

  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 })

  const sc = svc()

  const [{ data: traces }, { data: req }] = await Promise.all([
    sc.from('content_agent_traces')
      .select('step_number, step_name, step_label, step_status, detail, duration_ms, created_at')
      .eq('request_id', requestId)
      .gt('step_number', after)
      .order('step_number').order('created_at'),
    sc.from('content_requests')
      .select('status, error_message, sections_generated, tier1_sources_used, tier2_sources_found, sections_deleted')
      .eq('id', requestId)
      .single(),
  ])

  return NextResponse.json({
    traces: traces || [],
    status: req?.status || 'unknown',
    summary: req ? {
      sectionsGenerated: req.sections_generated,
      tier1SourcesUsed:  req.tier1_sources_used,
      tier2SourcesFound: req.tier2_sources_found,
      sectionsDeleted:   req.sections_deleted,
      errorMessage:      req.error_message,
    } : null,
  })
}
