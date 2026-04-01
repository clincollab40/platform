import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/synthesis
 * Internal API route — receives a jobId, runs the synthesis orchestrator.
 * Called asynchronously from triggerSynthesisAction and completeTriage.
 *
 * Isolation principle: this is the ONLY entry point for the synthesis agent.
 * If the agent crashes, it stays here — never propagates to calling module.
 * The route returns 200 immediately; processing happens asynchronously.
 *
 * Dynamic import path: route.ts is at
 *   apps/web/app/api/synthesis/route.ts  (5 dirs deep inside repo)
 * orchestrator.ts is at
 *   services/synthesis-agent/orchestrator.ts
 * Relative path: ../../../../../services/synthesis-agent/orchestrator
 */

export async function POST(request: NextRequest) {
  // Validate internal key — prevents external callers
  const key      = request.headers.get('x-internal-key') || ''
  const expected = process.env.INTERNAL_API_KEY || ''

  // Only enforce key check in production when key is configured
  if (expected && key !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let jobId: string
  try {
    const body = await request.json()
    jobId = body.jobId
    if (!jobId || typeof jobId !== 'string') throw new Error('missing jobId')
  } catch {
    return NextResponse.json({ error: 'Invalid request body — jobId required' }, { status: 400 })
  }

  // Acknowledge immediately — synthesis runs async
  const responsePromise = runSynthesisInBackground(jobId)
  responsePromise.catch(e =>
    console.error('[/api/synthesis] Background synthesis error for job', jobId, ':', e)
  )

  return NextResponse.json({ accepted: true, jobId }, { status: 202 })
}

async function runSynthesisInBackground(jobId: string): Promise<void> {
  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Verify job exists and is in a runnable state before loading orchestrator
  const { data: job, error } = await sc
    .from('synthesis_jobs')
    .select('id, status, specialist_id, retry_count, max_retries')
    .eq('id', jobId)
    .single()

  if (error || !job) {
    console.error('[Synthesis API] Job not found:', jobId, error?.message)
    return
  }

  if (!['queued', 'failed'].includes(job.status)) {
    console.log('[Synthesis API] Job already processed:', jobId, job.status)
    return
  }

  if (job.retry_count >= job.max_retries && job.status === 'failed') {
    console.log('[Synthesis API] Max retries reached for job:', jobId)
    return
  }

  try {
    // Dynamic import — synthesis-agent is isolated. If it fails to import,
    // ONLY this job fails. The API route itself stays healthy for other calls.
    // Path: apps/web/app/api/synthesis/ -> ../../../../../ = repo root (clincollab/)
    const { runSynthesisJob } = await import(
      '../../../../../services/synthesis-agent/orchestrator'
    )
    await runSynthesisJob(jobId)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown orchestrator error'
    console.error('[Synthesis API] Orchestrator error for job', jobId, ':', msg)

    // Mark job failed — specialist can retry from the UI
    await sc
      .from('synthesis_jobs')
      .update({
        status:        'failed',
        error_message: msg,
        completed_at:  new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', 'running')  // Only update if it got stuck in running
  }
}

/**
 * GET /api/synthesis?jobId=xxx
 * Lightweight status poll — used by UI while job is running.
 * Returns 200 with job status, never 404 (returns {status:'not_found'} instead).
 */
export async function GET(request: NextRequest) {
  const jobId = new URL(request.url).searchParams.get('jobId')

  if (!jobId) {
    return NextResponse.json({ error: 'jobId query param required' }, { status: 400 })
  }

  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const { data: job } = await sc
    .from('synthesis_jobs')
    .select('id, status, data_completeness, error_message, completed_at, patient_name')
    .eq('id', jobId)
    .single()

  if (!job) {
    return NextResponse.json({ status: 'not_found', jobId }, { status: 200 })
  }

  return NextResponse.json({
    jobId:             job.id,
    status:            job.status,
    dataCompleteness:  job.data_completeness,
    patientName:       job.patient_name,
    errorMessage:      job.error_message,
    completedAt:       job.completed_at,
  })
}
