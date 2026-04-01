import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { uploadReferralDocument, validateUploadFile, inferDocumentType } from '@/lib/storage/documents'

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(request: NextRequest) {
  try {
    const formData    = await request.formData()
    const caseId      = formData.get('case_id') as string
    const referenceNo = formData.get('reference_no') as string
    const content     = (formData.get('content') as string)?.trim()
    const senderName  = formData.get('sender_name') as string

    if (!caseId || !content) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
    }

    // Verify case exists and is in queried state
    const { data: referralCase } = await serviceSupabase
      .from('referral_cases')
      .select('id, specialist_id, status, patient_name, reference_no')
      .eq('id', caseId)
      .single()

    if (!referralCase) {
      return NextResponse.json({ error: 'Case not found.' }, { status: 404 })
    }

    if (referralCase.status !== 'queried') {
      return NextResponse.json({
        error: 'This case is no longer awaiting a reply.',
      }, { status: 400 })
    }

    // Save the reply message
    const { error: msgError } = await serviceSupabase
      .from('case_messages')
      .insert({
        case_id:       caseId,
        specialist_id: referralCase.specialist_id,
        sender_type:   'referring_doctor',
        sender_id:     'referring_doctor',
        message_type:  'text',
        content,
      })

    if (msgError) {
      return NextResponse.json({ error: 'Could not save reply.' }, { status: 500 })
    }

    // Handle document uploads
    const files = formData.getAll('documents') as File[]
    for (const file of files.slice(0, 3)) {
      if (!file || file.size === 0) continue
      const validation = validateUploadFile(file)
      if (!validation.valid) continue

      const { path, error: uploadError } = await uploadReferralDocument(
        file, referralCase.specialist_id, caseId
      )

      if (!uploadError && path) {
        await serviceSupabase.from('referral_documents').insert({
          case_id:       caseId,
          specialist_id: referralCase.specialist_id,
          file_name:     file.name,
          file_type:     inferDocumentType(file.name, file.type),
          mime_type:     file.type,
          storage_path:  path,
          size_bytes:    file.size,
          uploaded_by:   'referring_doctor_reply',
        })
      }
    }

    // Update case status back to info_provided
    await serviceSupabase
      .from('referral_cases')
      .update({ status: 'info_provided' })
      .eq('id', caseId)

    // Notify specialist via WhatsApp
    const { data: specialist } = await serviceSupabase
      .from('specialists')
      .select('whatsapp_number, name')
      .eq('id', referralCase.specialist_id)
      .single()

    if (specialist?.whatsapp_number) {
      const token      = process.env.WHATSAPP_API_TOKEN
      const phoneNumId = process.env.WHATSAPP_PHONE_NUMBER_ID

      if (token && phoneNumId) {
        const msg = `ClinCollab — Query reply received\n\nDr. ${specialist.name},\n\n` +
          `${senderName ? `Dr. ${senderName}` : 'The referring doctor'} has replied to your query ` +
          `regarding ${referralCase.patient_name}.\n\n` +
          `View reply: ${process.env.NEXT_PUBLIC_APP_URL}/referrals/${caseId}\n\n` +
          `Reference: ${referralCase.reference_no}`

        await fetch(
          `https://graph.facebook.com/v19.0/${phoneNumId}/messages`,
          {
            method:  'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type:    'individual',
              to: specialist.whatsapp_number.replace(/\D/g, '').startsWith('91')
                ? `+${specialist.whatsapp_number.replace(/\D/g, '')}`
                : `+91${specialist.whatsapp_number.replace(/\D/g, '')}`,
              type: 'text',
              text: { preview_url: false, body: msg },
            }),
          }
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Referrer Reply] Error:', error)
    return NextResponse.json(
      { error: 'An error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
