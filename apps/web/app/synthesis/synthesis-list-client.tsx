'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

type Case = {
  id: string
  reference_no: string
  patient_name: string
  patient_mobile: string | null
  patient_gender: string | null
  chief_complaint: string
  procedure_recommended: string | null
  urgency: string
  status: string
  created_at: string
  submitted_at: string
  referring_doctor: { name: string; specialty: string | null; clinic_name: string | null } | null
  document_count: number
  has_referring_dr_data: boolean
  has_triage_completed: boolean
  has_poc_review: boolean
  has_appointment: boolean
  triage_red_flag: string | null
  triage_synopsis: string | null
  ai_brief: string | null
  completeness_stage: number   // 0–4
  synthesis_job_id: string | null
  synthesis_status: string | null
}

const URGENCY_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  routine:   { label: 'Routine',   bg: 'bg-gray-100',  text: 'text-gray-600',  dot: 'bg-gray-400' },
  urgent:    { label: 'Urgent',    bg: 'bg-amber-50',  text: 'text-amber-700', dot: 'bg-amber-500' },
  emergency: { label: 'Emergency', bg: 'bg-red-50',    text: 'text-red-700',   dot: 'bg-red-500' },
}

const FLAG_DOT: Record<string, string> = {
  none:         'bg-gray-300',
  needs_review: 'bg-amber-500',
  urgent:       'bg-red-500',
}

function StageChip({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={`text-2xs px-1.5 py-0.5 rounded-full font-medium ${
      done ? 'bg-forest-50 text-forest-700' : 'bg-navy-800/6 text-navy-800/35'
    }`}>
      {done ? '✓ ' : ''}{label}
    </span>
  )
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function SynthesisListClient({
  specialist, cases, analytics,
}: {
  specialist: { id: string; name: string; specialty: string }
  cases: Case[]
  analytics: {
    total: number
    hasReferringDrData: number
    hasTriaged: number
    hasAppointment: number
    complete: number
    urgent: number
  }
}) {
  const router = useRouter()
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [urgencyFilter, setUrgencyFilter] = useState<string>('all')
  const [query, setQuery] = useState('')

  const displayed = cases.filter(c => {
    if (stageFilter === 'incomplete' && c.completeness_stage >= 3) return false
    if (stageFilter === 'complete'   && c.completeness_stage < 3)  return false
    if (stageFilter === 'no_triage'  && c.has_triage_completed)    return false
    if (stageFilter === 'no_ref_data'&& c.has_referring_dr_data)   return false
    if (urgencyFilter !== 'all' && c.urgency !== urgencyFilter)    return false
    if (query.trim()) {
      const q = query.toLowerCase()
      if (
        !c.patient_name.toLowerCase().includes(q) &&
        !c.reference_no.toLowerCase().includes(q) &&
        !c.chief_complaint.toLowerCase().includes(q) &&
        !(c.referring_doctor?.name?.toLowerCase().includes(q))
      ) return false
    }
    return true
  })

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Non-sticky inner nav */}
      <div className="bg-white border-b border-navy-800/8">
        <div className="px-5 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1">Patient synthesis</span>
          <button
            onClick={() => router.push('/network')}
            className="text-xs font-medium text-navy-800/60 hover:text-navy-800 transition-colors"
          >
            Referral network
          </button>
        </div>
      </div>

      <main className="px-5 py-5 space-y-4">

        {/* Summary strip */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'Referrals',   value: analytics.total,              color: 'text-navy-800' },
            { label: 'Dr data',     value: analytics.hasReferringDrData, color: 'text-navy-800' },
            { label: 'Triaged',     value: analytics.hasTriaged,         color: 'text-blue-600' },
            { label: 'Appt booked', value: analytics.hasAppointment,     color: 'text-forest-700' },
            { label: 'Complete',    value: analytics.complete,           color: 'text-forest-700' },
          ].map(stat => (
            <div key={stat.label} className="card-clinical text-center p-2.5">
              <div className={`font-display text-xl font-medium ${stat.color}`}>{stat.value}</div>
              <div className="data-label leading-tight mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Urgent alert */}
        {analytics.urgent > 0 && (
          <div
            className="bg-red-50 border border-red-200/60 rounded-2xl p-4 cursor-pointer"
            onClick={() => setUrgencyFilter(urgencyFilter === 'urgent' ? 'all' : 'urgent')}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="data-label text-red-600/70 mb-1">Urgent / emergency cases</div>
                <p className="text-sm font-medium text-red-900">
                  {analytics.urgent} case{analytics.urgent > 1 ? 's' : ''} flagged urgent — prioritise before consultation
                </p>
              </div>
              <div className="w-8 h-8 bg-red-500 rounded-xl flex items-center justify-center text-white font-medium text-sm">
                {analytics.urgent}
              </div>
            </div>
          </div>
        )}

        {/* Stage filters */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[
            { key: 'all',          label: `All (${cases.length})` },
            { key: 'incomplete',   label: 'Incomplete' },
            { key: 'complete',     label: 'Complete' },
            { key: 'no_triage',    label: 'Not triaged' },
            { key: 'no_ref_data',  label: 'No Dr data' },
          ].map(f => (
            <button key={f.key} onClick={() => setStageFilter(f.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all border
                ${stageFilter === f.key
                  ? 'bg-navy-800 text-white border-navy-800'
                  : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}>
              {f.label}
            </button>
          ))}
          <div className="w-px bg-navy-800/10 mx-0.5 flex-shrink-0" />
          {['all', 'urgent', 'emergency'].map(u => (
            <button key={u} onClick={() => setUrgencyFilter(u)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all border
                ${urgencyFilter === u
                  ? 'bg-navy-800 text-white border-navy-800'
                  : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}>
              {u === 'all' ? 'All urgency' : u.charAt(0).toUpperCase() + u.slice(1)}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-800/30">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M10.5 10.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search patient, reference, or complaint..."
            className="input-clinical pl-9"
          />
        </div>

        {/* Cases list */}
        {displayed.length > 0 ? (
          <div className="card-clinical p-0 overflow-hidden">
            {displayed.map((c, idx) => {
              const urgency = URGENCY_CONFIG[c.urgency] || URGENCY_CONFIG.routine
              const flagDot = FLAG_DOT[c.triage_red_flag || 'none'] || FLAG_DOT.none

              return (
                <button
                  key={c.id}
                  onClick={() => router.push(`/synthesis/${c.id}`)}
                  className={`w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-navy-50/60 transition-colors
                    ${idx < displayed.length - 1 ? 'border-b border-navy-800/5' : ''}`}
                >
                  {/* Urgency / triage red flag dot */}
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                    c.has_triage_completed ? flagDot : urgency.dot
                  }`} />

                  <div className="flex-1 min-w-0">
                    {/* Row 1: patient name + urgency badge */}
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-medium text-navy-800">{c.patient_name}</span>
                      {(c.urgency === 'urgent' || c.urgency === 'emergency') && (
                        <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${urgency.bg} ${urgency.text}`}>
                          {urgency.label}
                        </span>
                      )}
                      <span className="text-2xs text-navy-800/35 font-mono">{c.reference_no}</span>
                    </div>

                    {/* Row 2: referring doctor + chief complaint */}
                    <div className="text-xs text-navy-800/50 mb-1.5">
                      {c.referring_doctor?.name
                        ? `Dr ${c.referring_doctor.name}${c.referring_doctor.specialty ? ` · ${c.referring_doctor.specialty}` : ''}`
                        : 'Unknown referrer'}
                      {' · '}{c.chief_complaint.slice(0, 60)}{c.chief_complaint.length > 60 ? '…' : ''}
                    </div>

                    {/* Row 3: completeness stage chips */}
                    <div className="flex gap-1 flex-wrap">
                      <StageChip done={c.has_referring_dr_data} label="Dr data" />
                      <StageChip done={c.has_triage_completed}  label="Triaged" />
                      <StageChip done={c.has_poc_review}        label="POC reviewed" />
                      <StageChip done={c.has_appointment}       label="Appt booked" />
                      {c.document_count > 0 && (
                        <span className="text-2xs px-1.5 py-0.5 rounded-full font-medium bg-blue-50 text-blue-600">
                          {c.document_count} doc{c.document_count > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {/* Row 4: synopsis if available */}
                    {(c.triage_synopsis || c.ai_brief) && (
                      <p className="text-xs text-navy-800/35 mt-1 line-clamp-1 leading-relaxed">
                        {c.triage_synopsis || c.ai_brief}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-navy-800/35">{timeAgo(c.created_at)}</span>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-navy-800/20">
                      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.3"
                        strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="card-clinical text-center py-10">
            <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-purple-600">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="font-display text-xl text-navy-800 mb-2">No cases found</h3>
            <p className="text-sm text-navy-800/50 mb-5 max-w-xs mx-auto leading-relaxed">
              {cases.length === 0
                ? 'Referring doctors share cases via WhatsApp. Generate a referral link from the Network module.'
                : 'No cases match your current filters.'}
            </p>
            {cases.length === 0 ? (
              <button onClick={() => router.push('/network')} className="btn-primary">
                Go to referral network
              </button>
            ) : (
              <button onClick={() => { setStageFilter('all'); setUrgencyFilter('all'); setQuery('') }} className="btn-secondary">
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* WhatsApp intake tip — shown when no cases */}
        {cases.length === 0 && (
          <div className="bg-green-50 border border-green-200/60 rounded-2xl px-4 py-3">
            <p className="text-xs text-green-800/80 leading-relaxed">
              <span className="font-medium">WhatsApp referral intake:</span> Share your referral WhatsApp number with referring doctors.
              They text you with patient details — the system automatically creates a case, collects clinical info, and prompts document upload.
              No app required for the referring doctor.
            </p>
          </div>
        )}

      </main>
    </div>
  )
}
