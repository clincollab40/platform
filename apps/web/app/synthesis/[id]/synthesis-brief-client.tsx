'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

// ── Types ──────────────────────────────────────────────────────────────────
type ReferralCase = {
  id: string
  reference_no: string
  patient_name: string
  patient_mobile: string | null
  patient_dob: string | null
  patient_gender: string | null
  chief_complaint: string
  soap_notes: string | null
  procedure_recommended: string | null
  urgency: string
  status: string
  created_at: string
  submitted_at: string
  accepted_at: string | null
  poc_specialist_name: string | null
  poc_specialist_mobile: string | null
  referring_doctor: {
    id: string; name: string; specialty: string | null
    clinic_name: string | null; city: string | null; mobile: string
  } | null
  clinical_data: {
    vitals: any; medications: any[]
    allergies: string | null; comorbidities: string | null
    ecg_findings: string | null; echo_findings: string | null
    lab_summary: string | null; imaging_summary: string | null
    other_findings: string | null; created_at: string
  } | null
  documents: {
    id: string; file_name: string; file_type: string
    mime_type: string; storage_path: string
    size_bytes: number | null; uploaded_by: string; created_at: string
  }[]
}

type TriageSession = {
  id: string; status: string; red_flag_level: string
  red_flag_summary: string | null; ai_synopsis: string | null
  language: string; channel: string
  completed_at: string | null; started_at: string | null; created_at: string
  poc_reviewed_at: string | null; poc_notes: string | null
  triage_protocols: { name: string; protocol_type: string } | null
  triage_answers: {
    id: string; answer_value: string; answer_display: string | null
    is_red_flag: boolean; red_flag_level: string; red_flag_message: string | null
    answered_at: string
    triage_questions: { question_text: string; section: string | null; question_type: string } | null
  }[]
} | null

type Appointment = {
  id: string; status: string; reason: string | null; notes: string | null; created_at: string
  appointment_slots: { slot_date: string; slot_time: string; duration_minutes: number | null } | null
}

type SynthesisJob = {
  id: string; status: string; clinical_brief: string | null
  data_completeness: number; created_at: string; completed_at: string | null
  agent_traces: { tool_name: string; tool_status: string; output_summary: string | null; duration_ms: number | null }[]
  synthesis_findings: {
    id: string; category: string; finding: string
    significance: string; source: string; is_red_flag: boolean; red_flag_message: string | null
  }[]
} | null

// ── Constants ──────────────────────────────────────────────────────────────
const URGENCY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  routine:   { label: 'Routine',   bg: 'bg-gray-100',  text: 'text-gray-600'  },
  urgent:    { label: 'Urgent',    bg: 'bg-amber-50',  text: 'text-amber-700' },
  emergency: { label: 'Emergency', bg: 'bg-red-50',    text: 'text-red-700'   },
}

const FLAG_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  none:         { label: 'No flags',    bg: 'bg-gray-100',  text: 'text-gray-600',  dot: 'bg-gray-400'  },
  needs_review: { label: 'Needs review',bg: 'bg-amber-50',  text: 'text-amber-700', dot: 'bg-amber-500' },
  urgent:       { label: 'Urgent flag', bg: 'bg-red-50',    text: 'text-red-700',   dot: 'bg-red-500'   },
}

const DOC_TYPE_ICON: Record<string, string> = {
  ecg:              '💓',
  echo_report:      '🫀',
  lab_report:       '🧪',
  imaging:          '🩻',
  discharge_summary:'📋',
  prescription:     '💊',
  referral_letter:  '📄',
  other:            '📎',
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function fmtDateTime(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-IN', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtBytes(b: number | null) {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// Group triage answers by section
function groupAnswers(answers: NonNullable<TriageSession>['triage_answers']) {
  const groups: Record<string, typeof answers> = {}
  for (const a of answers) {
    const section = a.triage_questions?.section || 'General'
    if (!groups[section]) groups[section] = []
    groups[section]!.push(a)
  }
  return groups
}

// ── Component ──────────────────────────────────────────────────────────────
export default function SynthesisBriefClient({
  referralCase, triageSession, appointments, synthesisJob, specialist,
}: {
  referralCase: ReferralCase
  triageSession: TriageSession
  appointments: Appointment[]
  synthesisJob: SynthesisJob
  specialist: { id: string; name: string; specialty: string }
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'referring' | 'triage' | 'appointments' | 'documents' | 'emr'>('referring')

  const urgency = URGENCY_CONFIG[referralCase.urgency] || URGENCY_CONFIG.routine
  const triageFlag = FLAG_CONFIG[triageSession?.red_flag_level || 'none'] || FLAG_CONFIG.none

  // Docs split by uploader
  const drDocs      = referralCase.documents.filter(d => d.uploaded_by === 'referring_doctor')
  const patientDocs = referralCase.documents.filter(d => d.uploaded_by === 'patient' || d.uploaded_by === 'nok')
  const otherDocs   = referralCase.documents.filter(d => !['referring_doctor','patient','nok'].includes(d.uploaded_by))

  const confirmedAppt = appointments.find(a => a.status === 'confirmed') || appointments[0] || null

  const tabs = [
    { key: 'referring',    label: 'Referring Dr',  hasData: !!referralCase.referring_doctor },
    { key: 'triage',       label: 'Triage',         hasData: !!triageSession },
    { key: 'appointments', label: 'Appointment',    hasData: appointments.length > 0 },
    { key: 'documents',    label: `Documents (${referralCase.documents.length})`, hasData: referralCase.documents.length > 0 },
    { key: 'emr',          label: 'EMR / Lab',      hasData: false },
  ] as const

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Non-sticky inner nav */}
      <div className="bg-white border-b border-navy-800/8">
        <div className="px-5 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/synthesis')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <div className="flex-1 min-w-0">
            <div className="font-sans font-medium text-navy-800 truncate">{referralCase.patient_name}</div>
            <div className="text-2xs text-navy-800/40 font-mono">{referralCase.reference_no}</div>
          </div>
          <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${urgency.bg} ${urgency.text} flex-shrink-0`}>
            {urgency.label}
          </span>
        </div>
      </div>

      <main className="px-5 py-4 space-y-4">

        {/* AI synopsis banner — shown if synthesis job exists */}
        {synthesisJob?.clinical_brief && (
          <div className="bg-purple-50 border border-purple-200/60 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="data-label text-purple-700/70">AI pre-consultation brief</div>
              <span className="text-2xs text-purple-600/50">{synthesisJob.data_completeness}% data coverage</span>
            </div>
            <p className="text-sm text-purple-900 leading-relaxed">{synthesisJob.clinical_brief}</p>
            <p className="text-2xs text-purple-500/50 mt-2">Advisory only · specialist makes all clinical decisions</p>
          </div>
        )}

        {/* Urgent triage flag */}
        {triageSession?.red_flag_level === 'urgent' && triageSession.red_flag_summary && (
          <div className="bg-red-50 border border-red-300 rounded-2xl p-4">
            <div className="data-label text-red-700/70 mb-1">🔴 Urgent triage flag</div>
            <p className="text-sm font-medium text-red-900">{triageSession.red_flag_summary}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1 -mx-5 px-5">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all border
                ${activeTab === tab.key
                  ? 'bg-navy-800 text-white border-navy-800'
                  : tab.hasData
                  ? 'bg-white text-navy-800/70 border-navy-800/15 hover:border-navy-800/30'
                  : 'bg-white text-navy-800/30 border-navy-800/8'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab: Referring Doctor ─────────────────────────────────────────── */}
        {activeTab === 'referring' && (
          <div className="space-y-3">
            {/* Referring doctor identity */}
            <div className="card-clinical">
              <div className="data-label mb-3">Referring doctor</div>
              {referralCase.referring_doctor ? (
                <div className="space-y-1.5">
                  <div className="text-sm font-medium text-navy-800">
                    Dr {referralCase.referring_doctor.name}
                  </div>
                  {referralCase.referring_doctor.specialty && (
                    <div className="text-xs text-navy-800/50">{referralCase.referring_doctor.specialty}</div>
                  )}
                  {referralCase.referring_doctor.clinic_name && (
                    <div className="text-xs text-navy-800/50">{referralCase.referring_doctor.clinic_name}</div>
                  )}
                  {referralCase.referring_doctor.city && (
                    <div className="text-xs text-navy-800/40">{referralCase.referring_doctor.city}</div>
                  )}
                  <div className="text-xs text-navy-800/40 font-mono">{referralCase.referring_doctor.mobile}</div>
                </div>
              ) : (
                <p className="text-sm text-navy-800/40">Referring doctor details not available</p>
              )}
            </div>

            {/* Patient demographics */}
            <div className="card-clinical">
              <div className="data-label mb-3">Patient details</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  { label: 'Name',    value: referralCase.patient_name },
                  { label: 'Mobile',  value: referralCase.patient_mobile || '—' },
                  { label: 'DOB',     value: fmtDate(referralCase.patient_dob) },
                  { label: 'Gender',  value: referralCase.patient_gender || '—' },
                  { label: 'Referred',value: fmtDate(referralCase.submitted_at) },
                  { label: 'Urgency', value: urgency.label },
                ].map(row => (
                  <div key={row.label}>
                    <div className="data-label">{row.label}</div>
                    <div className="text-xs font-medium text-navy-800">{row.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Chief complaint + SOAP */}
            <div className="card-clinical">
              <div className="data-label mb-2">Chief complaint</div>
              <p className="text-sm text-navy-800 leading-relaxed mb-3">{referralCase.chief_complaint}</p>
              {referralCase.soap_notes && (
                <>
                  <div className="data-label mb-2">SOAP notes</div>
                  <p className="text-sm text-navy-800/70 leading-relaxed whitespace-pre-wrap">{referralCase.soap_notes}</p>
                </>
              )}
              {referralCase.procedure_recommended && (
                <>
                  <div className="data-label mb-1 mt-3">Procedure recommended</div>
                  <p className="text-sm font-medium text-navy-800">{referralCase.procedure_recommended}</p>
                </>
              )}
            </div>

            {/* Clinical data from referring doctor */}
            {referralCase.clinical_data && (
              <div className="card-clinical">
                <div className="data-label mb-3">Clinical data (from referring doctor)</div>

                {/* Vitals */}
                {referralCase.clinical_data.vitals && Object.keys(referralCase.clinical_data.vitals).length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-medium text-navy-800/70 mb-2">Vitals</div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { key: 'bp_systolic',  label: 'BP Sys',  unit: 'mmHg' },
                        { key: 'bp_diastolic', label: 'BP Dia',  unit: 'mmHg' },
                        { key: 'heart_rate',   label: 'HR',      unit: 'bpm'  },
                        { key: 'spo2',         label: 'SpO₂',    unit: '%'    },
                        { key: 'weight',       label: 'Weight',  unit: 'kg'   },
                        { key: 'rbs',          label: 'RBS',     unit: 'mg/dL'},
                      ].filter(v => referralCase.clinical_data?.vitals?.[v.key]).map(v => (
                        <div key={v.key} className="bg-navy-800/3 rounded-xl p-2 text-center">
                          <div className="text-xs font-medium text-navy-800">
                            {referralCase.clinical_data!.vitals[v.key]}
                          </div>
                          <div className="text-2xs text-navy-800/40">{v.label}</div>
                          <div className="text-2xs text-navy-800/25">{v.unit}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Clinical findings */}
                {[
                  { label: 'ECG findings',     value: referralCase.clinical_data.ecg_findings },
                  { label: 'Echo findings',    value: referralCase.clinical_data.echo_findings },
                  { label: 'Lab summary',      value: referralCase.clinical_data.lab_summary },
                  { label: 'Imaging summary',  value: referralCase.clinical_data.imaging_summary },
                  { label: 'Other findings',   value: referralCase.clinical_data.other_findings },
                  { label: 'Allergies',        value: referralCase.clinical_data.allergies },
                  { label: 'Comorbidities',    value: referralCase.clinical_data.comorbidities },
                ].filter(f => f.value).map(f => (
                  <div key={f.label} className="mb-3 last:mb-0">
                    <div className="data-label mb-1">{f.label}</div>
                    <p className="text-xs text-navy-800/70 leading-relaxed">{f.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Triage ───────────────────────────────────────────────────── */}
        {activeTab === 'triage' && (
          <div className="space-y-3">
            {!triageSession ? (
              <div className="card-clinical text-center py-10">
                <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-blue-500">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h3 className="font-display text-lg text-navy-800 mb-2">Not triaged yet</h3>
                <p className="text-sm text-navy-800/50 max-w-xs mx-auto leading-relaxed">
                  A triage link will be sent to the patient via WhatsApp once their appointment is confirmed.
                </p>
              </div>
            ) : (
              <>
                {/* Triage header */}
                <div className="card-clinical">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex-1">
                      <div className="data-label mb-1">Virtual nurse triage</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${triageFlag.bg} ${triageFlag.text}`}>
                          {triageFlag.label}
                        </span>
                        <span className="text-2xs text-navy-800/40 capitalize">
                          {triageSession.triage_protocols?.name || 'Unknown protocol'}
                        </span>
                        <span className="text-2xs text-navy-800/30">
                          {triageSession.channel === 'whatsapp' ? '📱 WhatsApp' : '🌐 Web'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs text-navy-800/40">{fmtDateTime(triageSession.completed_at)}</div>
                    </div>
                  </div>

                  {triageSession.red_flag_summary && (
                    <div className={`rounded-xl p-3 ${triageFlag.bg} mb-3`}>
                      <p className={`text-xs leading-relaxed ${triageFlag.text}`}>{triageSession.red_flag_summary}</p>
                    </div>
                  )}

                  {triageSession.ai_synopsis && (
                    <>
                      <div className="data-label mb-1">AI synopsis</div>
                      <p className="text-sm text-navy-800/70 leading-relaxed">{triageSession.ai_synopsis}</p>
                    </>
                  )}
                </div>

                {/* POC review status */}
                <div className={`rounded-2xl p-3 border ${
                  triageSession.poc_reviewed_at
                    ? 'bg-forest-50 border-forest-200/60'
                    : 'bg-amber-50 border-amber-200/60'
                }`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      triageSession.poc_reviewed_at ? 'bg-forest-600' : 'bg-amber-500'
                    }`} />
                    <span className="text-xs font-medium text-navy-800">
                      {triageSession.poc_reviewed_at
                        ? `POC reviewed on ${fmtDateTime(triageSession.poc_reviewed_at)}`
                        : 'Pending POC review'}
                    </span>
                  </div>
                  {triageSession.poc_notes && (
                    <p className="text-xs text-navy-800/60 mt-2 ml-4 leading-relaxed">{triageSession.poc_notes}</p>
                  )}
                </div>

                {/* Triage Q&A grouped by section */}
                {triageSession.triage_answers.length > 0 && (
                  <div className="card-clinical p-0 overflow-hidden">
                    <div className="px-4 py-3 border-b border-navy-800/8">
                      <div className="data-label">Patient responses ({triageSession.triage_answers.length} questions)</div>
                    </div>
                    {Object.entries(groupAnswers(triageSession.triage_answers)).map(([section, answers]) => (
                      <div key={section}>
                        <div className="px-4 py-2 bg-navy-800/3">
                          <div className="text-2xs font-medium text-navy-800/50 uppercase tracking-wider">{section}</div>
                        </div>
                        {answers.map((ans) => (
                          <div key={ans.id}
                            className={`flex gap-3 px-4 py-3 border-b border-navy-800/5 last:border-0
                              ${ans.is_red_flag ? 'bg-red-50/40' : ''}`}
                          >
                            <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                              ans.red_flag_level === 'urgent'       ? 'bg-red-500' :
                              ans.red_flag_level === 'needs_review' ? 'bg-amber-500' :
                              'bg-navy-800/15'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-navy-800/60 mb-0.5">
                                {ans.triage_questions?.question_text || '—'}
                              </div>
                              <div className="text-sm font-medium text-navy-800">
                                {ans.answer_display || ans.answer_value}
                              </div>
                              {ans.red_flag_message && (
                                <div className="text-2xs text-red-600/70 mt-0.5">{ans.red_flag_message}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Tab: Appointments ─────────────────────────────────────────────── */}
        {activeTab === 'appointments' && (
          <div className="space-y-3">
            {appointments.length === 0 ? (
              <div className="card-clinical text-center py-10">
                <div className="w-12 h-12 bg-navy-800/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-navy-800/40">
                    <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <h3 className="font-display text-lg text-navy-800 mb-2">No appointment booked</h3>
                <p className="text-sm text-navy-800/50 max-w-xs mx-auto leading-relaxed">
                  Appointments can be booked via WhatsApp chatbot or from the Appointments module.
                </p>
                <button
                  onClick={() => router.push('/appointments')}
                  className="btn-primary mt-4"
                >
                  Go to appointments
                </button>
              </div>
            ) : (
              appointments.map(appt => (
                <div key={appt.id} className="card-clinical">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="data-label mb-1">Appointment</div>
                      <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${
                        appt.status === 'confirmed'  ? 'bg-forest-50 text-forest-700' :
                        appt.status === 'cancelled'  ? 'bg-red-50 text-red-600'      :
                        appt.status === 'completed'  ? 'bg-gray-100 text-gray-600'   :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        {appt.status.charAt(0).toUpperCase() + appt.status.slice(1)}
                      </span>
                    </div>
                    {appt.appointment_slots && (
                      <div className="text-right">
                        <div className="text-sm font-medium text-navy-800">
                          {fmtDate(appt.appointment_slots.slot_date)}
                        </div>
                        <div className="text-xs text-navy-800/50">
                          {appt.appointment_slots.slot_time}
                          {appt.appointment_slots.duration_minutes
                            ? ` · ${appt.appointment_slots.duration_minutes} min`
                            : ''}
                        </div>
                      </div>
                    )}
                  </div>
                  {appt.reason && (
                    <>
                      <div className="data-label mb-1">Reason</div>
                      <p className="text-sm text-navy-800/70">{appt.reason}</p>
                    </>
                  )}
                  {appt.notes && (
                    <>
                      <div className="data-label mb-1 mt-2">Notes</div>
                      <p className="text-xs text-navy-800/50 leading-relaxed">{appt.notes}</p>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Tab: Documents ────────────────────────────────────────────────── */}
        {activeTab === 'documents' && (
          <div className="space-y-3">
            {referralCase.documents.length === 0 ? (
              <div className="card-clinical text-center py-10">
                <div className="w-12 h-12 bg-navy-800/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-navy-800/40">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h3 className="font-display text-lg text-navy-800 mb-2">No documents yet</h3>
                <p className="text-sm text-navy-800/50 max-w-xs mx-auto leading-relaxed">
                  Referring doctors and patients can share discharge summaries, lab reports, ECGs, and more via WhatsApp.
                </p>
              </div>
            ) : (
              <>
                {/* Documents from referring doctor */}
                {drDocs.length > 0 && (
                  <div className="card-clinical p-0 overflow-hidden">
                    <div className="px-4 py-3 border-b border-navy-800/8">
                      <div className="data-label">From referring doctor ({drDocs.length})</div>
                    </div>
                    {drDocs.map((doc, idx) => (
                      <DocRow key={doc.id} doc={doc} isLast={idx === drDocs.length - 1} />
                    ))}
                  </div>
                )}

                {/* Documents from patient / NOK */}
                {patientDocs.length > 0 && (
                  <div className="card-clinical p-0 overflow-hidden">
                    <div className="px-4 py-3 border-b border-navy-800/8">
                      <div className="data-label">From patient / NOK ({patientDocs.length})</div>
                    </div>
                    {patientDocs.map((doc, idx) => (
                      <DocRow key={doc.id} doc={doc} isLast={idx === patientDocs.length - 1} />
                    ))}
                  </div>
                )}

                {/* Other documents */}
                {otherDocs.length > 0 && (
                  <div className="card-clinical p-0 overflow-hidden">
                    <div className="px-4 py-3 border-b border-navy-800/8">
                      <div className="data-label">Other ({otherDocs.length})</div>
                    </div>
                    {otherDocs.map((doc, idx) => (
                      <DocRow key={doc.id} doc={doc} isLast={idx === otherDocs.length - 1} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Tab: EMR / Lab ────────────────────────────────────────────────── */}
        {activeTab === 'emr' && (
          <div className="card-clinical text-center py-10">
            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-blue-500">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="font-display text-lg text-navy-800 mb-2">EMR / Lab / Radiology</h3>
            <p className="text-sm text-navy-800/50 max-w-xs mx-auto leading-relaxed">
              Connect your EMR system to automatically pull lab reports, radiology images, and investigation results for this patient.
            </p>
            <div className="mt-4 bg-navy-800/3 rounded-2xl p-4 text-left max-w-xs mx-auto">
              <div className="data-label mb-2">Supported integrations (coming soon)</div>
              {['Practo', 'eVital', 'MedMantra', 'HealthPlix', 'Drlogy'].map(emr => (
                <div key={emr} className="flex items-center gap-2 py-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-navy-800/20" />
                  <span className="text-xs text-navy-800/50">{emr}</span>
                </div>
              ))}
            </div>
            <button className="btn-secondary mt-4" disabled>Request integration</button>
          </div>
        )}

      </main>
    </div>
  )
}

// ── Document row sub-component ─────────────────────────────────────────────
function DocRow({ doc, isLast }: {
  doc: { id: string; file_name: string; file_type: string; size_bytes: number | null; uploaded_by: string; created_at: string }
  isLast: boolean
}) {
  const icon = DOC_TYPE_ICON[doc.file_type] || DOC_TYPE_ICON.other
  const fmtBytes = (b: number | null) => {
    if (!b) return ''
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
    return `${(b / (1024 * 1024)).toFixed(1)} MB`
  }
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${isLast ? '' : 'border-b border-navy-800/5'}`}>
      <div className="w-9 h-9 bg-navy-800/5 rounded-xl flex items-center justify-center flex-shrink-0 text-base">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-navy-800 truncate">{doc.file_name}</div>
        <div className="text-2xs text-navy-800/40">
          {doc.file_type.replace(/_/g, ' ')}
          {doc.size_bytes ? ` · ${fmtBytes(doc.size_bytes)}` : ''}
          {' · '}{fmtDate(doc.created_at)}
        </div>
      </div>
      <span className="text-2xs text-navy-800/25 flex-shrink-0">View →</span>
    </div>
  )
}
