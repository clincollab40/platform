'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

type Session = {
  id: string
  patient_name: string
  patient_mobile: string | null
  patient_age: number | null
  patient_gender: string | null
  status: string
  red_flag_level: string
  red_flag_summary: string | null
  ai_synopsis: string | null
  language: string
  channel: string
  created_at: string
  completed_at: string | null
  started_at: string | null
  triage_protocols: { name: string; protocol_type: string } | null
}

type Answer = {
  id: string
  answer_value: string
  answer_display: string | null
  is_red_flag: boolean
  red_flag_level: string
  red_flag_message: string | null
  answered_at: string
  triage_questions: {
    id: string
    question_text: string
    question_type: string
    options: { value: string; label: string }[]
    unit: string | null
    section: string | null
    sort_order: number
  } | null
}

const FLAG_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  none:         { label: 'No flags',     bg: 'bg-gray-50',   text: 'text-gray-500',   border: 'border-gray-200' },
  needs_review: { label: 'Needs review', bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-300' },
  urgent:       { label: 'Urgent',       bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-300' },
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function displayAnswer(answer: Answer): string {
  return answer.answer_display || answer.answer_value || '—'
}

// Extract vitals for the strip
function extractVitals(answers: Answer[]) {
  const vitals: { label: string; value: string; unit: string; isFlag: boolean }[] = []

  answers.forEach(a => {
    const qt = a.triage_questions?.question_type
    if (qt === 'vitals_bp') {
      const parts = a.answer_value.split('/')
      vitals.push({
        label: 'BP',
        value: parts.length === 2 ? `${parts[0]}/${parts[1]}` : a.answer_value,
        unit: 'mmHg',
        isFlag: a.is_red_flag,
      })
    } else if (qt === 'vitals_single') {
      const qText = a.triage_questions?.question_text || ''
      const unit  = a.triage_questions?.unit || ''
      const label = qText.toLowerCase().includes('heart') ? 'HR'
        : qText.toLowerCase().includes('spo2') || qText.toLowerCase().includes('oxygen') ? 'SpO2'
        : qText.toLowerCase().includes('weight') ? 'Weight'
        : qText.toLowerCase().includes('rbs') || qText.toLowerCase().includes('sugar') ? 'RBS'
        : qText.slice(0, 6)
      vitals.push({ label, value: a.answer_value, unit, isFlag: a.is_red_flag })
    }
  })

  return vitals
}

export default function SessionDetailClient({
  session, answers, sectionMap, vitals: rawVitals, redFlags, specialist,
}: {
  session: Session
  answers: Answer[]
  sectionMap: Record<string, Answer[] | undefined>
  vitals: Answer[]
  redFlags: Answer[]
  specialist: { id: string; name: string; specialty: string }
}) {
  const router = useRouter()
  const [showAllAnswers, setShowAllAnswers] = useState(false)

  const protocol  = session.triage_protocols
  const flag      = FLAG_CONFIG[session.red_flag_level] || FLAG_CONFIG.none
  const vitals    = extractVitals(rawVitals)
  const sections  = Object.keys(sectionMap)
  const nonVitalAnswers = answers.filter(a => {
    const qt = a.triage_questions?.question_type
    return qt !== 'vitals_bp' && qt !== 'vitals_single'
  })

  const completionMins = session.started_at && session.completed_at
    ? Math.round((new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 60000)
    : null

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/triage/sessions')} className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1 truncate">{session.patient_name}</span>
          {session.red_flag_level !== 'none' && (
            <span className={`text-2xs px-2.5 py-1 rounded-full font-medium ${flag.bg} ${flag.text}`}>
              {flag.label}
            </span>
          )}
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Patient header card */}
        <div className="card-clinical">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h1 className="font-display text-xl text-navy-800">{session.patient_name}</h1>
              <div className="text-sm text-navy-800/50 mt-0.5 flex items-center gap-1.5 flex-wrap">
                {session.patient_age && <span>{session.patient_age} years</span>}
                {session.patient_age && session.patient_gender && <span>·</span>}
                {session.patient_gender && <span className="capitalize">{session.patient_gender}</span>}
                {session.patient_mobile && <><span>·</span><span>{session.patient_mobile}</span></>}
              </div>
            </div>
            {/* Status */}
            <div className={`text-2xs px-2.5 py-1 rounded-full font-medium flex-shrink-0
              ${session.status === 'completed' ? 'bg-forest-50 text-forest-700' :
                session.status === 'in_progress' ? 'bg-blue-50 text-blue-700' :
                'bg-gray-100 text-gray-500'}`}>
              {session.status === 'completed' ? 'Completed' :
               session.status === 'in_progress' ? 'In progress' :
               session.status === 'pending' ? 'Not started' : session.status}
            </div>
          </div>

          <div className="pt-3 border-t border-navy-800/8 grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="data-label mb-0.5">Protocol</div>
              <div className="text-navy-800/70">{protocol?.name || '—'}</div>
            </div>
            <div>
              <div className="data-label mb-0.5">Submitted</div>
              <div className="text-navy-800/70">
                {session.completed_at
                  ? new Date(session.completed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                  : '—'}
              </div>
            </div>
            <div>
              <div className="data-label mb-0.5">Duration</div>
              <div className="text-navy-800/70">{completionMins ? `${completionMins} min` : '—'}</div>
            </div>
          </div>
        </div>

        {/* Red flags — show prominently at top */}
        {redFlags.length > 0 && (
          <div className={`border rounded-2xl p-4 ${flag.bg} ${flag.border}`}>
            <div className={`data-label ${flag.text} mb-2`}>
              {session.red_flag_level === 'urgent' ? '🔴 Urgent red flags' : '🟡 Review needed'}
            </div>
            <div className="space-y-2">
              {redFlags.map(rf => (
                <div key={rf.id} className="flex gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                    rf.red_flag_level === 'urgent' ? 'bg-red-500' : 'bg-amber-500'
                  }`} />
                  <div>
                    <div className="text-sm font-medium text-navy-800">
                      {rf.triage_questions?.question_text}
                    </div>
                    <div className="text-xs text-navy-800/60">
                      Answer: <span className="font-medium">{displayAnswer(rf)}</span>
                      {rf.red_flag_message && ` — ${rf.red_flag_message}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI synopsis */}
        {session.ai_synopsis && (
          <div className="bg-purple-50 border border-purple-200/60 rounded-2xl p-4">
            <div className="data-label text-purple-700/70 mb-2">AI clinical synopsis</div>
            <p className="text-sm text-purple-900 leading-relaxed">{session.ai_synopsis}</p>
            <p className="text-2xs text-purple-600/50 mt-2">
              Advisory only — generated from patient-reported answers. Specialist makes all clinical decisions.
            </p>
          </div>
        )}

        {/* Vitals strip */}
        {vitals.length > 0 && (
          <div className="card-clinical">
            <div className="data-label mb-3">Vitals (self-reported)</div>
            <div className="grid grid-cols-3 gap-2">
              {vitals.map((v, i) => (
                <div key={i} className={`rounded-xl p-2.5 text-center
                  ${v.isFlag ? 'bg-red-50 border border-red-200/60' : 'bg-navy-50'}`}>
                  <div className={`font-display text-lg ${v.isFlag ? 'text-red-700' : 'text-navy-800'}`}>
                    {v.value}
                  </div>
                  <div className="data-label leading-tight">{v.label}</div>
                  {v.unit && <div className="text-2xs text-navy-800/30">{v.unit}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Answers grouped by section */}
        <div className="card-clinical p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-800/8 flex items-center justify-between">
            <div className="data-label">Clinical answers ({nonVitalAnswers.length})</div>
            {!showAllAnswers && nonVitalAnswers.length > 6 && (
              <button onClick={() => setShowAllAnswers(true)}
                className="text-xs text-navy-800/60 hover:text-navy-800 transition-colors">
                Show all
              </button>
            )}
          </div>

          {sections.map(section => {
            const sectionAnswers = (sectionMap[section] || []).filter(a => {
              const qt = a.triage_questions?.question_type
              return qt !== 'vitals_bp' && qt !== 'vitals_single'
            })
            if (sectionAnswers.length === 0) return null

            return (
              <div key={section}>
                <div className="px-4 py-2 bg-navy-800/3">
                  <div className="text-2xs font-medium text-navy-800/50 uppercase tracking-wider">{section}</div>
                </div>
                {sectionAnswers.map((a, i) => {
                  if (!showAllAnswers && i >= 6) return null
                  const q = a.triage_questions
                  if (!q) return null
                  return (
                    <div key={a.id}
                      className={`flex gap-3 px-4 py-3 border-b border-navy-800/5 last:border-0
                        ${a.is_red_flag ? (a.red_flag_level === 'urgent' ? 'bg-red-50/50' : 'bg-amber-50/40') : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-navy-800/60 mb-0.5 leading-relaxed">{q.question_text}</div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className={`text-sm font-medium ${a.is_red_flag ? (a.red_flag_level === 'urgent' ? 'text-red-700' : 'text-amber-700') : 'text-navy-800'}`}>
                          {displayAnswer(a)}
                        </div>
                        {a.is_red_flag && a.red_flag_message && (
                          <div className={`text-2xs ${a.red_flag_level === 'urgent' ? 'text-red-500' : 'text-amber-500'}`}>
                            ⚠ {a.red_flag_message}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {!showAllAnswers && nonVitalAnswers.length > 6 && (
            <div className="px-4 py-3 text-center">
              <button onClick={() => setShowAllAnswers(true)}
                className="text-sm text-navy-800/60 hover:text-navy-800 transition-colors">
                Show remaining {nonVitalAnswers.length - 6} answers
              </button>
            </div>
          )}
        </div>

        {/* WhatsApp patient */}
        {session.patient_mobile && (
          <a
            href={`https://wa.me/91${session.patient_mobile.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-green-50 border border-green-200/60
                       text-green-700 text-sm font-medium py-3 rounded-xl hover:bg-green-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#16a34a">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            WhatsApp {session.patient_name.split(' ')[0]}
          </a>
        )}

      </main>
    </div>
  )
}
