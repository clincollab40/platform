import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/content
 * Receives requestId, runs content pipeline in isolation.
 * Returns 202 immediately. Pipeline streams progress via DB traces (SSE reads traces).
 *
 * Path: apps/web/app/api/content/route.ts
 * Pipeline: ../../../../../services/content-agent/content-pipeline.ts
 */
export async function POST(request: NextRequest) {
  const key = request.headers.get('x-internal-key') || ''
  if (process.env.INTERNAL_API_KEY && key !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let requestId: string
  try {
    const body = await request.json()
    requestId = body.requestId
    if (!requestId) throw new Error('missing requestId')
  } catch {
    return NextResponse.json({ error: 'requestId required' }, { status: 400 })
  }

  // Acknowledge immediately
  const bg = runPipeline(requestId)
  bg.catch(e => console.error('[/api/content] Pipeline error:', e))

  return NextResponse.json({ accepted: true, requestId }, { status: 202 })
}

async function runPipeline(requestId: string) {
  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Load request
  const { data: req } = await sc
    .from('content_requests')
    .select('*, specialists(id, name, specialty)')
    .eq('id', requestId).single()

  if (!req || !['queued', 'failed'].includes(req.status)) return

  try {
    await sc.from('content_requests').update({
      status: 'decomposing',
      processing_started_at: new Date().toISOString(),
    }).eq('id', requestId)

    const { runContentPipeline } = await import(
      '../../../../../services/content-agent/content-pipeline'
    )

    const specialist = req.specialists as any
    const result = await runContentPipeline({
      requestId,
      specialistId:         specialist.id,
      specialistName:       specialist.name,
      specialistSpecialty:  specialist.specialty,
      topic:                req.topic,
      contentType:          req.content_type,
      audience:             req.audience,
      depth:                req.depth,
      specialInstructions:  req.special_instructions,
    })

    // Upload files to Supabase Storage
    if (result.pptxBuffer) {
      await uploadFile(sc, requestId, specialist.id, result.pptxBuffer, result.pptxFilename, 'pptx')
    }
    if (result.docxBuffer) {
      await uploadFile(sc, requestId, specialist.id, result.docxBuffer, result.docxFilename, 'docx')
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[/api/content] Pipeline error:', msg)
    await sc.from('content_requests').update({
      status: 'failed', error_message: msg,
    }).eq('id', requestId)
  }
}

async function uploadFile(
  sc: ReturnType<typeof createClient>,
  requestId: string,
  specialistId: string,
  buffer: Buffer,
  filename: string,
  format: string
) {
  try {
    const path = `${specialistId}/${requestId}/${filename}`
    const { data: uploadData, error } = await sc.storage
      .from('content-outputs')
      .upload(path, buffer, {
        contentType: format === 'pptx'
          ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      })

    if (error) {
      console.error('[/api/content] Storage upload error:', error.message)
      // Still save the output record with null URL
    }

    // Get signed URL (valid 7 days)
    let fileUrl: string | null = null
    if (uploadData) {
      const { data: signedData } = await sc.storage
        .from('content-outputs')
        .createSignedUrl(path, 7 * 24 * 3600)
      fileUrl = signedData?.signedUrl || null
    }

    await sc.from('content_outputs').insert({
      request_id:   requestId,
      specialist_id: specialistId,
      format,
      file_name:    filename,
      file_url:     fileUrl,
      file_size_kb: Math.round(buffer.length / 1024),
      include_tier2:true,
      expires_at:   new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    })
  } catch (e) {
    console.error('[/api/content] File upload error:', e)
  }
}

/**
 * GET /api/content/stream?requestId=xxx
 * Server-Sent Events: streams agent trace updates to client in real time.
 * Client polls this endpoint; server streams new trace records.
 */
export async function GET(request: NextRequest) {
  const requestId = new URL(request.url).searchParams.get('requestId')
  const after     = new URL(request.url).searchParams.get('after') || '0'

  if (!requestId) {
    return NextResponse.json({ error: 'requestId required' }, { status: 400 })
  }

  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Get all traces after the given step number
  const { data: traces } = await sc
    .from('content_agent_traces')
    .select('step_number, step_name, step_label, step_status, detail, created_at')
    .eq('request_id', requestId)
    .gt('step_number', parseInt(after))
    .order('step_number').order('created_at')

  // Get current request status
  const { data: req } = await sc
    .from('content_requests')
    .select('status, error_message, sections_generated, tier1_sources_used, tier2_sources_found, sections_deleted')
    .eq('id', requestId).single()

  return NextResponse.json({
    traces:  traces || [],
    status:  req?.status || 'unknown',
    summary: req ? {
      sectionsGenerated: req.sections_generated,
      tier1SourcesUsed:  req.tier1_sources_used,
      tier2SourcesFound: req.tier2_sources_found,
      sectionsDeleted:   req.sections_deleted,
      errorMessage:      req.error_message,
    } : null,
  })
}
