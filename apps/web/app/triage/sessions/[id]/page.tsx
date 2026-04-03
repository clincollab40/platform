import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import SessionDetailClient from './session-detail-client'
import { formatAnswerForDisplay } from '@/lib/ai/triage-engine'

export default async function SessionDetailPage({
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
    .select('id, name, specialty')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  // Fetch session
  const { data: session } = await db
    .from('triage_sessions')
    .select(`
      *,
      triage_protocols ( name, protocol_type, welcome_message )
    `)
    .eq('id', params.id)
    .eq('specialist_id', specialist.id)
    .single()

  if (!session) notFound()

  // Fetch answers with question data
  const { data: answers } = await db
    .from('triage_answers')
    .select(`
      id, answer_value, answer_display, is_red_flag,
      red_flag_level, red_flag_message, answered_at,
      triage_questions (
        id, question_text, question_type, options, unit,
        section, sort_order
      )
    `)
    .eq('session_id', params.id)
    .order('answered_at', { ascending: true })

  // Group answers by section
  const sectionMap: Record<string, typeof answers> = {}
  ;(answers || []).forEach(a => {
    const section = (a.triage_questions as any)?.section || 'General'
    if (!sectionMap[section]) sectionMap[section] = []
    sectionMap[section]!.push(a)
  })

  // Extract vitals answers
  const vitals = (answers || []).filter(a => {
    const qt = (a.triage_questions as any)?.question_type
    return qt === 'vitals_bp' || qt === 'vitals_single'
  })

  // Red flagged answers
  const redFlags = (answers || []).filter(a => a.is_red_flag)

  return (
    <SessionDetailClient
      session={session}
      answers={answers || []}
      sectionMap={sectionMap}
      vitals={vitals}
      redFlags={redFlags}
      specialist={specialist}
    />
  )
}
