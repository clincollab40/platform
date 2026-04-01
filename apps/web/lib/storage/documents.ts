import { createServerSupabaseClient } from '@/lib/supabase/server'

const BUCKET = 'referral-documents'
const SIGNED_URL_EXPIRY = 3600 // 1 hour

// Upload a file to Supabase Storage
// Path: {specialistId}/{caseId}/{filename}
export async function uploadReferralDocument(
  file: File,
  specialistId: string,
  caseId: string
): Promise<{ path: string; error?: string }> {
  const supabase = await createServerSupabaseClient()

  const ext = file.name.split('.').pop()?.toLowerCase()
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const path = `${specialistId}/${caseId}/${safeName}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: file.type,
      upsert: false,
    })

  if (error) {
    console.error('[Storage] Upload error:', error)
    return { path: '', error: error.message }
  }

  return { path }
}

// Generate a signed URL for secure, time-limited access
export async function getSignedUrl(
  storagePath: string
): Promise<{ url: string; error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY)

  if (error || !data) {
    return { url: '', error: error?.message }
  }

  return { url: data.signedUrl }
}

// Get signed URLs for multiple documents
export async function getSignedUrls(
  paths: string[]
): Promise<Record<string, string>> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_EXPIRY)

  if (error || !data) return {}

  return data.reduce((acc, item) => {
    if (item.signedUrl) acc[item.path] = item.signedUrl
    return acc
  }, {} as Record<string, string>)
}

// Validate file before upload
export function validateUploadFile(file: File): { valid: boolean; error?: string } {
  const MAX_SIZE = 10 * 1024 * 1024 // 10MB
  const ALLOWED_TYPES = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/heic',
    'application/pdf',
  ]

  if (file.size > MAX_SIZE) {
    return { valid: false, error: `${file.name} exceeds 10MB limit` }
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: `${file.name}: only JPEG, PNG, HEIC, and PDF files are supported` }
  }

  return { valid: true }
}

// Map MIME type to document_type enum
export function inferDocumentType(
  fileName: string,
  mimeType: string
): string {
  const lower = fileName.toLowerCase()
  if (lower.includes('ecg') || lower.includes('ekg'))    return 'ecg'
  if (lower.includes('echo'))                            return 'echo_report'
  if (lower.includes('discharge'))                       return 'discharge_summary'
  if (lower.includes('lab') || lower.includes('report')) return 'lab_report'
  if (lower.includes('prescription') || lower.includes('rx')) return 'prescription'
  if (mimeType === 'application/pdf')                    return 'lab_report'
  return 'other'
}
