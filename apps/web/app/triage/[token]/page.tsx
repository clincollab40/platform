import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import TriageFormClient from './triage-form-client'

export default async function TriagePage({ params }: { params: { token: string } }) {
  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const { data: session } = await sc
    .from('triage_sessions')
    .select(`
      id, status, patient_name, patient_age, patient_gender,
      language, token_expires_at, protocol_id,
      triage_protocols (
        name, welcome_message, completion_message,
        estimated_minutes, specialist_id,
        specialists ( name, specialty )
      )
    `)
    .eq('access_token', params.token)
    .single()

  if (!session) notFound()

  if (new Date(session.token_expires_at) < new Date()) {
    return (
      <div className="min-h-screen bg-clinical-light flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-2xl text-navy-800 mb-2">Link expired</h1>
          <p className="text-sm text-navy-800/60">This triage link has expired. Please ask your doctor for a new link.</p>
        </div>
      </div>
    )
  }

  if (session.status === 'completed') {
    const protocol = session.triage_protocols as any
    return (
      <div className="min-h-screen bg-clinical-light flex items-center justify-center px-4">
        <div className="max-w-sm text-center animate-slide-up">
          <div className="w-16 h-16 bg-forest-700 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M5 12l5 5L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="font-display text-2xl text-navy-800 mb-2">Triage complete</h1>
          <p className="text-sm text-navy-800/60 leading-relaxed">
            {protocol?.completion_message || 'Your clinical summary has been sent to your doctor. Please wait to be called.'}
          </p>
        </div>
      </div>
    )
  }

  // Fetch questions
  const { data: questions } = await sc
    .from('triage_questions')
    .select('*')
    .eq('protocol_id', session.protocol_id)
    .order('sort_order')

  // Fetch existing answers (for resume)
  const { data: existingAnswers } = await sc
    .from('triage_answers')
    .select('question_id, answer_value, answer_display')
    .eq('session_id', session.id)

  const answerMap: Record<string, string> = {}
  const displayMap: Record<string, string> = {}
  ;(existingAnswers || []).forEach(a => {
    answerMap[a.question_id]  = a.answer_value
    displayMap[a.question_id] = a.answer_display || a.answer_value
  })

  const protocol = session.triage_protocols as any
  const specialist = protocol?.specialists as any

  return (
    <TriageFormClient
      token={params.token}
      sessionId={session.id}
      patientName={session.patient_name}
      specialistName={specialist?.name || ''}
      specialistSpecialty={specialist?.specialty || ''}
      protocolName={protocol?.name || 'Clinical Triage'}
      welcomeMessage={protocol?.welcome_message || ''}
      estimatedMinutes={protocol?.estimated_minutes || 5}
      questions={questions || []}
      existingAnswers={answerMap}
      existingDisplays={displayMap}
      language={(session.language as any) || 'en'}
    />
  )
}
