import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/transcription
 * Receives audio (multipart FormData) and runs the transcription pipeline.
 * Isolated service — pipeline errors never propagate to callers.
 * Returns 202 immediately; processing happens asynchronously.
 *
 * Path from this file to transcription-pipeline.ts:
 * apps/web/app/api/transcription/route.ts -> ../../../../../services/transcription-agent/transcription-pipeline
 */
export async function POST(request: NextRequest) {
  const key      = request.headers.get('x-internal-key') || ''
  const expected = process.env.INTERNAL_API_KEY || ''
  if (expected && key !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const sessionId       = formData.get('sessionId') as string
  const specialistId    = formData.get('specialistId') as string
  const audioFile       = formData.get('audio') as File | null
  const templateId      = formData.get('templateId') as string || null
  const language        = formData.get('language') as string || 'en'
  const specialistName  = formData.get('specialistName') as string || ''
  const patientName     = formData.get('patientName') as string || ''
  const clinicName      = formData.get('clinicName') as string || ''
  const consultationDate= formData.get('consultationDate') as string || new Date().toLocaleDateString('en-IN')

  if (!sessionId || !specialistId || !audioFile) {
    return NextResponse.json({ error: 'sessionId, specialistId, and audio are required' }, { status: 400 })
  }

  // Return 202 immediately
  const responsePromise = runTranscriptionPipeline({
    sessionId, specialistId, audioFile, templateId: templateId || null,
    language, specialistName, patientName, clinicName, consultationDate,
  })
  responsePromise.catch(e =>
    console.error('[/api/transcription] Pipeline error for session', sessionId, ':', e)
  )

  return NextResponse.json({ accepted: true, sessionId }, { status: 202 })
}

async function runTranscriptionPipeline(params: {
  sessionId: string; specialistId: string; audioFile: File
  templateId: string | null; language: string; specialistName: string
  patientName: string; clinicName: string; consultationDate: string
}) {
  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  try {
    // Read audio into Buffer
    const audioBuffer = Buffer.from(await params.audioFile.arrayBuffer())

    // Dynamic import — pipeline errors stay isolated
    const { processConsultationAudio } = await import(
      '../../../../../services/transcription-agent/transcription-pipeline'
    )

    const result = await processConsultationAudio({
      sessionId:        params.sessionId,
      specialistId:     params.specialistId,
      audioBuffer,
      audioMimeType:    params.audioFile.type || 'audio/webm',
      language:         params.language,
      templateId:       params.templateId,
      patientName:      params.patientName,
      specialistName:   params.specialistName,
      clinicName:       params.clinicName,
      consultationDate: params.consultationDate,
    })

    if (!result.ok) {
      console.error('[Transcription API] Pipeline failed for session', params.sessionId, ':', result.error)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Transcription API] Fatal error:', msg)

    await sc.from('transcription_sessions').update({
      status: 'failed', error_message: msg,
    }).eq('id', params.sessionId).in('status', ['processing', 'extracting'])
  }
}

/**
 * GET /api/transcription?sessionId=xxx
 * Lightweight status poll for the UI.
 */
export async function GET(request: NextRequest) {
  const sessionId = new URL(request.url).searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const { data } = await sc.from('transcription_sessions')
    .select('id, status, audio_duration_secs, error_message, processing_ended_at')
    .eq('id', sessionId).single()

  return NextResponse.json(data || { status: 'not_found', sessionId })
}
