import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import ReferrerReplyClient from './referrer-reply-client'

// Public page — no auth required
// Referring doctor accesses this via WhatsApp link sent by specialist
export default async function ReferrerReplyPage({
  params,
}: {
  params: { referenceNo: string }
}) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Fetch case by reference number
  const { data: referralCase } = await supabase
    .from('referral_cases')
    .select(`
      id, reference_no, patient_name, chief_complaint,
      status, query_text, submitted_at,
      specialists ( name, specialty, city ),
      referring_doctors ( name, specialty )
    `)
    .eq('reference_no', params.referenceNo)
    .single()

  if (!referralCase) notFound()

  // Only allow reply if case is in queried state
  const canReply = referralCase.status === 'queried'

  // Fetch recent messages for context
  const { data: messages } = await supabase
    .from('case_messages')
    .select('role, content, message_type, created_at')
    .eq('case_id', referralCase.id)
    .order('created_at', { ascending: false })
    .limit(10)

  const specialist  = referralCase.specialists as any
  const referrer    = referralCase.referring_doctors as any

  return (
    <ReferrerReplyClient
      referenceNo={params.referenceNo}
      caseId={referralCase.id}
      patientName={referralCase.patient_name}
      chiefComplaint={referralCase.chief_complaint}
      queryText={referralCase.query_text}
      specialistName={specialist?.name || 'the specialist'}
      specialistSpecialty={specialist?.specialty || ''}
      referrerName={referrer?.name || ''}
      canReply={canReply}
      recentMessages={(messages || []).reverse()}
      caseStatus={referralCase.status}
    />
  )
}
