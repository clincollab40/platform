import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import CaseDetailClient from './case-detail-client'
import { getSignedUrls } from '@/lib/storage/documents'

export default async function CaseDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: specialist } = await db
    .from('specialists')
    .select('id, name, specialty, city, role')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  // Fetch case
  const { data: referralCase } = await db
    .from('referral_cases')
    .select(`
      *,
      referring_doctors ( name, specialty, city, clinic_name, mobile ),
      referrers ( name, specialty, clinic_name, clinic_area )
    `)
    .eq('id', params.id)
    .eq('specialist_id', specialist.id)
    .single()

  if (!referralCase) notFound()

  // Fetch clinical data
  const { data: clinicalData } = await db
    .from('referral_clinical_data')
    .select('*')
    .eq('case_id', params.id)
    .single()

  // Fetch documents
  const { data: documents } = await db
    .from('referral_documents')
    .select('*')
    .eq('case_id', params.id)
    .order('created_at', { ascending: true })

  // Get signed URLs for documents
  const docPaths = (documents || []).map(d => d.storage_path)
  const signedUrls = docPaths.length > 0 ? await getSignedUrls(docPaths) : {}

  // Fetch case messages
  const { data: messages } = await db
    .from('case_messages')
    .select('*')
    .eq('case_id', params.id)
    .order('created_at', { ascending: true })

  // Fetch case updates
  const { data: updates } = await db
    .from('case_updates')
    .select('*')
    .eq('case_id', params.id)
    .order('created_at', { ascending: false })

  return (
    <CaseDetailClient
      referralCase={referralCase}
      clinicalData={clinicalData}
      documents={(documents || []).map(d => ({
        ...d,
        signedUrl: signedUrls[d.storage_path] || '',
      }))}
      messages={messages || []}
      updates={updates || []}
      specialist={specialist}
    />
  )
}
