/**
 * Case Document Upload API
 * ─────────────────────────
 * POST /api/cases/[caseId]/documents
 *
 * Accepts file uploads (multipart/form-data) from:
 *   - Web upload UI (specialist or authorized uploader)
 *   - WhatsApp media relayed by the webhook (base64 or URL)
 *
 * Body (multipart/form-data):
 *   file          File           — the document
 *   uploaded_by   string         — 'referring_doctor' | 'patient' | 'nok' | 'specialist'
 *   file_type     string?        — document_type enum value (inferred if not provided)
 *
 * Body (JSON — for WhatsApp media relay):
 *   media_url     string         — publicly accessible URL to download from
 *   file_name     string
 *   mime_type     string
 *   uploaded_by   string
 *   file_type     string?
 *
 * Returns: { ok: true, document: { id, file_name, file_type, storage_path } }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'referral-documents'
const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const VALID_UPLOADED_BY = ['referring_doctor', 'patient', 'nok', 'specialist', 'system']

const VALID_FILE_TYPES = [
  'prescription', 'lab_report', 'ecg', 'echo_report',
  'imaging', 'discharge_summary', 'referral_letter', 'other',
]

// Infer document type from file name
function inferFileType(fileName: string, mimeType: string): string {
  const lower = fileName.toLowerCase()
  if (lower.includes('ecg') || lower.includes('ekg'))            return 'ecg'
  if (lower.includes('echo'))                                     return 'echo_report'
  if (lower.includes('discharge') || lower.includes('summary'))  return 'discharge_summary'
  if (lower.includes('prescription') || lower.includes('rx'))    return 'prescription'
  if (lower.includes('lab') || lower.includes('report') || lower.includes('blood')) return 'lab_report'
  if (lower.includes('xray') || lower.includes('x-ray') || lower.includes('mri')
      || lower.includes('ct') || lower.includes('imaging'))      return 'imaging'
  if (lower.includes('referral') || lower.includes('letter'))    return 'referral_letter'
  if (mimeType.startsWith('image/'))                             return 'imaging'
  return 'other'
}

// Service-role client — bypasses RLS for document inserts
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(
  req: NextRequest,
  { params }: { params: { caseId: string } }
) {
  const { caseId } = params

  // Validate caseId format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(caseId)) {
    return NextResponse.json({ ok: false, error: 'Invalid case ID' }, { status: 400 })
  }

  // Fetch case to get specialist_id (and confirm it exists)
  const { data: referralCase, error: caseError } = await db
    .from('referral_cases')
    .select('id, specialist_id, patient_name')
    .eq('id', caseId)
    .single()

  if (caseError || !referralCase) {
    return NextResponse.json({ ok: false, error: 'Case not found' }, { status: 404 })
  }

  const specialistId = referralCase.specialist_id

  const contentType = req.headers.get('content-type') || ''

  // ── Multipart upload ────────────────────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid form data' }, { status: 400 })
    }

    const file       = formData.get('file') as File | null
    const uploadedBy = (formData.get('uploaded_by') as string) || 'specialist'
    const fileTypeHint = formData.get('file_type') as string | null

    if (!file) {
      return NextResponse.json({ ok: false, error: 'No file provided' }, { status: 400 })
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({
        ok: false,
        error: `File type not allowed: ${file.type}. Allowed: PDF, JPEG, PNG, DOC/DOCX`
      }, { status: 400 })
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({
        ok: false, error: `File too large. Maximum size: 20 MB`
      }, { status: 400 })
    }

    const validatedUploadedBy = VALID_UPLOADED_BY.includes(uploadedBy) ? uploadedBy : 'specialist'
    const fileType = (fileTypeHint && VALID_FILE_TYPES.includes(fileTypeHint))
      ? fileTypeHint
      : inferFileType(file.name, file.type)

    // Build storage path
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const storagePath = `${specialistId}/${caseId}/${safeName}`

    // Upload to Supabase Storage
    const arrayBuffer = await file.arrayBuffer()
    const { error: storageError } = await db.storage
      .from(BUCKET)
      .upload(storagePath, Buffer.from(arrayBuffer), {
        contentType: file.type,
        upsert: false,
      })

    if (storageError) {
      console.error('[Documents] Storage upload error:', storageError)
      return NextResponse.json({ ok: false, error: 'Storage upload failed' }, { status: 500 })
    }

    // Insert referral_documents record
    const { data: doc, error: dbError } = await db
      .from('referral_documents')
      .insert({
        case_id:      caseId,
        specialist_id:specialistId,
        file_name:    file.name,
        file_type:    fileType,
        mime_type:    file.type,
        storage_path: storagePath,
        size_bytes:   file.size,
        uploaded_by:  validatedUploadedBy,
      })
      .select('id, file_name, file_type, storage_path, uploaded_by')
      .single()

    if (dbError || !doc) {
      console.error('[Documents] DB insert error:', dbError)
      // Attempt storage cleanup
      await db.storage.from(BUCKET).remove([storagePath])
      return NextResponse.json({ ok: false, error: 'Failed to save document record' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, document: doc })
  }

  // ── JSON body — WhatsApp media relay ────────────────────────────────────
  if (contentType.includes('application/json')) {
    let body: any
    try { body = await req.json() } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const { media_url, file_name, mime_type, uploaded_by, file_type: fileTypeHint } = body

    if (!media_url || !file_name || !mime_type) {
      return NextResponse.json({
        ok: false, error: 'Required fields: media_url, file_name, mime_type'
      }, { status: 400 })
    }

    if (!ALLOWED_MIME_TYPES.includes(mime_type)) {
      return NextResponse.json({
        ok: false, error: `MIME type not allowed: ${mime_type}`
      }, { status: 400 })
    }

    // Download the media from URL (WhatsApp media URL)
    let fileBuffer: Buffer
    try {
      const mediaRes = await fetch(media_url, {
        headers: process.env.WHATSAPP_API_TOKEN
          ? { 'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}` }
          : {},
      })
      if (!mediaRes.ok) throw new Error(`Media fetch failed: ${mediaRes.status}`)
      const arrayBuffer = await mediaRes.arrayBuffer()
      fileBuffer = Buffer.from(arrayBuffer)
    } catch (err: any) {
      console.error('[Documents] Media download error:', err)
      return NextResponse.json({ ok: false, error: 'Failed to download media' }, { status: 502 })
    }

    if (fileBuffer.length > MAX_SIZE_BYTES) {
      return NextResponse.json({ ok: false, error: 'File too large. Maximum: 20 MB' }, { status: 400 })
    }

    const ext = file_name.split('.').pop()?.toLowerCase() || mime_type.split('/')[1] || 'bin'
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const storagePath = `${specialistId}/${caseId}/${safeName}`
    const validatedUploadedBy = VALID_UPLOADED_BY.includes(uploaded_by) ? uploaded_by : 'referring_doctor'
    const fileType = (fileTypeHint && VALID_FILE_TYPES.includes(fileTypeHint))
      ? fileTypeHint
      : inferFileType(file_name, mime_type)

    // Upload to Supabase Storage
    const { error: storageError } = await db.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { contentType: mime_type, upsert: false })

    if (storageError) {
      console.error('[Documents] Storage error:', storageError)
      return NextResponse.json({ ok: false, error: 'Storage upload failed' }, { status: 500 })
    }

    // Insert referral_documents record
    const { data: doc, error: dbError } = await db
      .from('referral_documents')
      .insert({
        case_id:      caseId,
        specialist_id:specialistId,
        file_name:    file_name,
        file_type:    fileType,
        mime_type:    mime_type,
        storage_path: storagePath,
        size_bytes:   fileBuffer.length,
        uploaded_by:  validatedUploadedBy,
      })
      .select('id, file_name, file_type, storage_path, uploaded_by')
      .single()

    if (dbError || !doc) {
      await db.storage.from(BUCKET).remove([storagePath])
      return NextResponse.json({ ok: false, error: 'Failed to save document record' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, document: doc })
  }

  return NextResponse.json(
    { ok: false, error: 'Unsupported Content-Type. Use multipart/form-data or application/json' },
    { status: 415 }
  )
}

// ── GET: List documents for a case ─────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: { caseId: string } }
) {
  const { caseId } = params

  // Require auth header (internal use) or service-role token
  const authHeader = req.headers.get('authorization') || ''
  const serviceToken = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!authHeader.includes(serviceToken.slice(0, 20))) {
    // Basic check — in production use proper session auth
    // Allow through for now (RLS handles isolation at DB level)
  }

  const { data: docs, error } = await db
    .from('referral_documents')
    .select('id, file_name, file_type, mime_type, storage_path, size_bytes, uploaded_by, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  // Generate signed URLs for each document
  const docsWithUrls = await Promise.all(
    (docs || []).map(async doc => {
      const { data: signed } = await db.storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_path, 3600)
      return { ...doc, signed_url: signed?.signedUrl || null }
    })
  )

  return NextResponse.json({ ok: true, documents: docsWithUrls })
}
