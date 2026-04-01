'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  acceptReferralAction,
  queryReferralAction,
  declineReferralAction,
  sendCaseUpdateAction,
  sendCaseMessageAction,
} from '@/app/actions/referrals'

// ── Types ─────────────────────────────────────────
type ReferralCase = {
  id: string; reference_no: string; patient_name: string
  patient_dob: string | null; patient_gender: string | null; patient_mobile: string | null
  chief_complaint: string; soap_notes: string | null; procedure_recommended: string | null
  urgency: string; status: string; expected_visit_date: string | null
  poc_referrer_name: string | null; poc_referrer_mobile: string | null
  poc_specialist_name: string | null; poc_specialist_mobile: string | null
  decline_reason: string | null; query_text: string | null
  ai_eligibility_note: string | null; submitted_at: string; accepted_at: string | null
  referring_doctors: { name: string | null; specialty: string | null; city: string | null; clinic_name: string | null; mobile: string | null } | null
  referrers: { name: string | null; specialty: string | null; clinic_name: string | null; clinic_area: string | null } | null
}

type ClinicalData = {
  vitals: Record<string, string>; medications: any[]; allergies: string | null
  comorbidities: string | null; ecg_findings: string | null; lab_summary: string | null
  imaging_summary: string | null; other_findings: string | null
} | null

type Document = {
  id: string; file_name: string; file_type: string; mime_type: string
  storage_path: string; size_bytes: number; uploaded_by: string; created_at: string
  signedUrl: string
}

type Message = {
  id: string; sender_type: string; content: string; message_type: string; created_at: string
}

type Update = {
  id: string; update_type: string; structured_data: Record<string, string>
  whatsapp_delivered: boolean; created_at: string
}

const DECLINE_REASONS = [
  'Patient does not meet clinical criteria for this procedure',
  'Insufficient clinical information provided — please resubmit with complete details',
  'Please refer to [specialist name] for this condition',
  'Patient should be stabilised before referral',
  'Currently at capacity — please contact clinic to schedule',
  'Other (see note)',
]

const UPDATE_TYPES = [
  { value: 'patient_arrived',     label: 'Patient has arrived',   fields: ['actual_date', 'notes'] },
  { value: 'findings_shared',     label: 'Share findings',         fields: ['summary', 'next_steps'] },
  { value: 'procedure_planned',   label: 'Procedure planned',      fields: ['procedure_name', 'planned_date', 'notes'] },
  { value: 'procedure_completed', label: 'Procedure completed',    fields: ['procedure_name', 'outcome', 'notes'] },
  { value: 'discharged',          label: 'Patient discharged',     fields: ['discharge_date', 'medications', 'follow_up_date', 'follow_up_notes'] },
  { value: 'follow_up_required',  label: 'Follow-up required',     fields: ['reason', 'follow_up_date', 'instructions'] },
]

const UPDATE_FIELD_LABELS: Record<string, string> = {
  actual_date: 'Arrival date', notes: 'Notes', summary: 'Clinical summary',
  next_steps: 'Next steps', procedure_name: 'Procedure name',
  planned_date: 'Planned date', outcome: 'Outcome',
  discharge_date: 'Discharge date', medications: 'Discharge medications',
  follow_up_date: 'Follow-up date', follow_up_notes: 'Follow-up instructions',
  reason: 'Reason', instructions: 'Patient instructions',
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function getReferrerInfo(c: ReferralCase) {
  const rd = c.referring_doctors
  const r = c.referrers
  return {
    name:     rd?.name || r?.name || 'Unknown',
    specialty:rd?.specialty || r?.specialty || '',
    clinic:   rd?.clinic_name || r?.clinic_name || '',
    area:     r?.clinic_area || rd?.city || '',
    mobile:   rd?.mobile || c.poc_referrer_mobile || '',
  }
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  submitted:        { label: 'Awaiting response', bg: 'bg-blue-50',    text: 'text-blue-700' },
  queried:          { label: 'Query sent',         bg: 'bg-purple-50',  text: 'text-purple-700' },
  info_provided:    { label: 'Info provided',      bg: 'bg-indigo-50',  text: 'text-indigo-700' },
  accepted:         { label: 'Accepted',           bg: 'bg-emerald-50', text: 'text-emerald-700' },
  patient_arrived:  { label: 'Patient arrived',    bg: 'bg-teal-50',    text: 'text-teal-700' },
  procedure_planned:{ label: 'Procedure planned',  bg: 'bg-cyan-50',    text: 'text-cyan-700' },
  completed:        { label: 'Completed',          bg: 'bg-green-50',   text: 'text-green-700' },
  closed:           { label: 'Closed',             bg: 'bg-gray-100',   text: 'text-gray-500' },
  declined:         { label: 'Declined',           bg: 'bg-red-50',     text: 'text-red-600' },
  cancelled:        { label: 'Cancelled',          bg: 'bg-red-50',     text: 'text-red-400' },
}

export default function CaseDetailClient({
  referralCase: c, clinicalData, documents, messages, updates, specialist,
}: {
  referralCase: ReferralCase; clinicalData: ClinicalData
  documents: Document[]; messages: Message[]; updates: Update[]
  specialist: { id: string; name: string; specialty: string; role: string }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<'clinical' | 'thread' | 'updates'>('clinical')
  const [action, setAction] = useState<'accept' | 'query' | 'decline' | 'update' | null>(null)
  const [msgText, setMsgText] = useState('')
  const [queryText, setQueryText] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [selectedUpdateType, setSelectedUpdateType] = useState('')
  const [updateFields, setUpdateFields] = useState<Record<string, string>>({})
  const [acceptForm, setAcceptForm] = useState({
    expected_visit_date: c.expected_visit_date || '',
    poc_specialist_name: specialist.name,
    poc_specialist_mobile: '',
  })
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (tab === 'thread') bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [tab, messages.length])

  const referrer = getReferrerInfo(c)
  const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.submitted
  const isActionable = ['submitted', 'queried', 'info_provided'].includes(c.status)
  const isClosed = ['closed', 'declined', 'cancelled'].includes(c.status)

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    Object.entries(acceptForm).forEach(([k, v]) => { if (v) fd.set(k, v) })

    startTransition(async () => {
      const result = await acceptReferralAction(c.id, fd)
      if (result?.error) toast.error(result.error)
      else { toast.success('Referral accepted — referring doctor notified'); setAction(null); router.refresh() }
    })
  }

  async function handleQuery(e: React.FormEvent) {
    e.preventDefault()
    if (!queryText.trim()) return

    startTransition(async () => {
      const result = await queryReferralAction(c.id, queryText)
      if (result?.error) toast.error(result.error)
      else { toast.success('Query sent to referring doctor via WhatsApp'); setAction(null); setQueryText(''); router.refresh() }
    })
  }

  async function handleDecline(e: React.FormEvent) {
    e.preventDefault()
    if (!declineReason.trim()) return

    startTransition(async () => {
      const result = await declineReferralAction(c.id, declineReason)
      if (result?.error) toast.error(result.error)
      else { toast.success('Referring doctor has been notified'); setAction(null); router.refresh() }
    })
  }

  async function handleSendUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUpdateType) return
    const fd = new FormData()
    fd.set('update_type', selectedUpdateType)
    Object.entries(updateFields).forEach(([k, v]) => { if (v) fd.set(k, v) })

    startTransition(async () => {
      const result = await sendCaseUpdateAction(c.id, fd)
      if (result?.error) toast.error(result.error)
      else {
        toast.success('Update sent to referring doctor via WhatsApp')
        setAction(null); setSelectedUpdateType(''); setUpdateFields({})
        router.refresh()
      }
    })
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!msgText.trim()) return

    startTransition(async () => {
      const result = await sendCaseMessageAction(c.id, msgText)
      if (result?.error) toast.error(result.error)
      else { setMsgText(''); router.refresh() }
    })
  }

  const updateTypeConfig = UPDATE_TYPES.find(u => u.value === selectedUpdateType)

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/referrals')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1 truncate">
            {c.patient_name}
          </span>
          <span className={`text-2xs px-2.5 py-1 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
            {cfg.label}
          </span>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Case header */}
        <div className="card-clinical">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h1 className="font-display text-xl text-navy-800">{c.patient_name}</h1>
              <div className="text-sm text-navy-800/50 mt-0.5">
                {c.patient_gender && `${c.patient_gender.charAt(0).toUpperCase() + c.patient_gender.slice(1)} · `}
                {c.patient_dob && `${formatDate(c.patient_dob)} · `}
                {c.patient_mobile}
              </div>
            </div>
            <div className={`px-2 py-0.5 rounded-full text-2xs font-medium flex-shrink-0
              ${c.urgency === 'emergency' ? 'bg-red-50 text-red-600' :
                c.urgency === 'urgent'    ? 'bg-amber-50 text-amber-600' :
                'bg-gray-100 text-gray-500'}`}>
              {c.urgency.charAt(0).toUpperCase() + c.urgency.slice(1)}
            </div>
          </div>

          <div className="py-3 border-y border-navy-800/8 my-3">
            <div className="data-label mb-1">From Dr. {referrer.name}</div>
            <div className="text-sm text-navy-800/60">
              {[referrer.specialty, referrer.clinic, referrer.area].filter(Boolean).join(' · ')}
            </div>
          </div>

          <div>
            <div className="data-label mb-1">Chief complaint</div>
            <p className="text-sm text-navy-800 leading-relaxed">{c.chief_complaint}</p>
          </div>

          {c.procedure_recommended && (
            <div className="mt-3">
              <div className="data-label mb-1">Procedure recommended</div>
              <p className="text-sm text-navy-800">{c.procedure_recommended}</p>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-navy-800/8 flex justify-between text-xs">
            <span className="text-navy-800/40 font-mono">{c.reference_no}</span>
            <span className="text-navy-800/40">Submitted {formatDate(c.submitted_at)}</span>
          </div>
        </div>

        {/* AI eligibility note */}
        {c.ai_eligibility_note && (
          <div className="bg-purple-50 border border-purple-200/60 rounded-2xl p-4">
            <div className="data-label text-purple-700/70 mb-1">Clinical eligibility note</div>
            <p className="text-sm text-purple-900 leading-relaxed">{c.ai_eligibility_note}</p>
            <p className="text-2xs text-purple-600/60 mt-2">
              Advisory only — specialist makes the final clinical decision
            </p>
          </div>
        )}

        {/* Primary action buttons */}
        {isActionable && !action && (
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => setAction('accept')}
              className="bg-forest-700 text-white rounded-xl py-3 text-sm font-medium
                         hover:bg-forest-800 active:scale-95 transition-all">
              Accept
            </button>
            <button onClick={() => setAction('query')}
              className="bg-purple-600 text-white rounded-xl py-3 text-sm font-medium
                         hover:bg-purple-700 active:scale-95 transition-all">
              Query
            </button>
            <button onClick={() => setAction('decline')}
              className="bg-red-500 text-white rounded-xl py-3 text-sm font-medium
                         hover:bg-red-600 active:scale-95 transition-all">
              Decline
            </button>
          </div>
        )}

        {/* Send update button for accepted cases */}
        {['accepted', 'patient_arrived', 'procedure_planned'].includes(c.status) && !action && (
          <button
            onClick={() => setAction('update')}
            className="btn-primary w-full"
          >
            Send clinical update to referring doctor
          </button>
        )}

        {/* Accept form */}
        {action === 'accept' && (
          <form onSubmit={handleAccept} className="card-clinical space-y-4 animate-slide-up">
            <div className="data-label">Accept referral</div>
            <div>
              <label className="data-label block mb-1.5">Expected consultation date</label>
              <input type="date" value={acceptForm.expected_visit_date}
                onChange={e => setAcceptForm(p => ({ ...p, expected_visit_date: e.target.value }))}
                min={new Date().toISOString().split('T')[0]}
                className="input-clinical" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="data-label block mb-1.5">Your POC name</label>
                <input value={acceptForm.poc_specialist_name}
                  onChange={e => setAcceptForm(p => ({ ...p, poc_specialist_name: e.target.value }))}
                  className="input-clinical text-sm" placeholder="Dr. name or coordinator" />
              </div>
              <div>
                <label className="data-label block mb-1.5">POC mobile</label>
                <input value={acceptForm.poc_specialist_mobile}
                  onChange={e => setAcceptForm(p => ({ ...p, poc_specialist_mobile: e.target.value }))}
                  className="input-clinical text-sm" placeholder="Clinic number" type="tel" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={isPending} className="btn-primary flex-1 py-3">
                {isPending ? 'Accepting...' : 'Confirm acceptance'}
              </button>
              <button type="button" onClick={() => setAction(null)} className="btn-secondary px-4">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Query form */}
        {action === 'query' && (
          <form onSubmit={handleQuery} className="card-clinical space-y-3 animate-slide-up">
            <div className="data-label">Send clinical query to referring doctor</div>
            <p className="text-xs text-navy-800/50">
              Your query will be delivered via WhatsApp with a reply link.
            </p>
            <textarea value={queryText} onChange={e => setQueryText(e.target.value)}
              placeholder="Specific clinical question or additional information needed..."
              rows={4} className="input-clinical resize-none text-sm" autoFocus />
            <div className="flex gap-2">
              <button type="submit" disabled={isPending || !queryText.trim()}
                className="btn-primary flex-1 py-3">
                {isPending ? 'Sending...' : 'Send via WhatsApp'}
              </button>
              <button type="button" onClick={() => setAction(null)} className="btn-secondary px-4">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Decline form */}
        {action === 'decline' && (
          <form onSubmit={handleDecline} className="card-clinical space-y-3 animate-slide-up">
            <div className="data-label">Decline reason</div>
            <div className="space-y-2">
              {DECLINE_REASONS.map(r => (
                <button key={r} type="button"
                  onClick={() => setDeclineReason(r)}
                  className={`w-full text-left text-xs p-3 rounded-xl border transition-all
                    ${declineReason === r
                      ? 'border-navy-800/50 bg-navy-50 text-navy-800'
                      : 'border-navy-800/15 text-navy-800/60 hover:border-navy-800/30'}`}>
                  {r}
                </button>
              ))}
              <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)}
                placeholder="Or type a custom reason..."
                rows={2} className="input-clinical text-sm resize-none" />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={isPending || !declineReason.trim()}
                className="flex-1 bg-red-500 text-white rounded-xl py-3 text-sm font-medium
                           hover:bg-red-600 active:scale-95 transition-all">
                {isPending ? 'Sending...' : 'Decline and notify doctor'}
              </button>
              <button type="button" onClick={() => setAction(null)} className="btn-secondary px-4">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Send update form */}
        {action === 'update' && (
          <form onSubmit={handleSendUpdate} className="card-clinical space-y-4 animate-slide-up">
            <div className="data-label">Clinical update to referring doctor</div>
            <div className="grid grid-cols-2 gap-2">
              {UPDATE_TYPES.map(u => (
                <button key={u.value} type="button"
                  onClick={() => { setSelectedUpdateType(u.value); setUpdateFields({}) }}
                  className={`p-3 rounded-xl border text-left text-xs font-medium transition-all
                    ${selectedUpdateType === u.value
                      ? 'border-navy-800 bg-navy-50 text-navy-800'
                      : 'border-navy-800/15 text-navy-800/50 hover:border-navy-800/30'}`}>
                  {u.label}
                </button>
              ))}
            </div>
            {updateTypeConfig && (
              <div className="space-y-3 pt-2 border-t border-navy-800/8 animate-fade-in">
                {updateTypeConfig.fields.map(field => (
                  <div key={field}>
                    <label className="data-label block mb-1.5">
                      {UPDATE_FIELD_LABELS[field] || field}
                    </label>
                    {['notes', 'summary', 'next_steps', 'instructions', 'follow_up_notes', 'medications'].includes(field) ? (
                      <textarea value={updateFields[field] || ''}
                        onChange={e => setUpdateFields(p => ({ ...p, [field]: e.target.value }))}
                        rows={2} className="input-clinical resize-none text-sm"
                        placeholder={`Enter ${UPDATE_FIELD_LABELS[field]?.toLowerCase() || field}...`} />
                    ) : ['actual_date', 'planned_date', 'discharge_date', 'follow_up_date'].includes(field) ? (
                      <input type="date" value={updateFields[field] || ''}
                        onChange={e => setUpdateFields(p => ({ ...p, [field]: e.target.value }))}
                        className="input-clinical" />
                    ) : (
                      <input type="text" value={updateFields[field] || ''}
                        onChange={e => setUpdateFields(p => ({ ...p, [field]: e.target.value }))}
                        className="input-clinical text-sm"
                        placeholder={`Enter ${UPDATE_FIELD_LABELS[field]?.toLowerCase() || field}...`} />
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={isPending || !selectedUpdateType}
                className="btn-primary flex-1 py-3">
                {isPending ? 'Sending...' : 'Send update via WhatsApp'}
              </button>
              <button type="button" onClick={() => setAction(null)} className="btn-secondary px-4">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Tabs */}
        <div className="card-clinical p-0 overflow-hidden">
          <div className="flex border-b border-navy-800/8">
            {(['clinical', 'thread', 'updates'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-3 text-xs font-medium transition-colors capitalize
                  ${tab === t ? 'text-navy-800 border-b-2 border-navy-800' : 'text-navy-800/40'}`}>
                {t === 'clinical' ? 'Clinical data' :
                 t === 'thread'   ? `Messages (${messages.length})` :
                 `Updates (${updates.length})`}
              </button>
            ))}
          </div>

          {/* Clinical data tab */}
          {tab === 'clinical' && (
            <div className="p-4 space-y-4">
              {/* Vitals */}
              {clinicalData?.vitals && Object.keys(clinicalData.vitals).length > 0 && (
                <div>
                  <div className="data-label mb-2">Vitals</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'bp_systolic',  label: 'BP Sys',   unit: 'mmHg' },
                      { key: 'bp_diastolic', label: 'BP Dia',   unit: 'mmHg' },
                      { key: 'heart_rate',   label: 'HR',       unit: 'bpm' },
                      { key: 'spo2',         label: 'SpO2',     unit: '%' },
                      { key: 'weight',       label: 'Weight',   unit: 'kg' },
                      { key: 'rbs',          label: 'RBS',      unit: 'mg/dL' },
                    ].filter(v => clinicalData.vitals[v.key]).map(v => (
                      <div key={v.key} className="bg-navy-50 rounded-xl p-2.5 text-center">
                        <div className="font-display text-lg text-navy-800">
                          {clinicalData.vitals[v.key]}
                        </div>
                        <div className="data-label leading-tight">{v.label}</div>
                        <div className="text-2xs text-navy-800/30">{v.unit}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SOAP */}
              {c.soap_notes && (
                <div>
                  <div className="data-label mb-1">SOAP notes</div>
                  <p className="text-sm text-navy-800/80 leading-relaxed whitespace-pre-wrap">
                    {c.soap_notes}
                  </p>
                </div>
              )}

              {/* Findings */}
              {[
                { key: 'ecg_findings',   label: 'ECG findings' },
                { key: 'lab_summary',    label: 'Lab results' },
                { key: 'imaging_summary',label: 'Imaging / echo' },
              ].filter(f => clinicalData?.[f.key as keyof typeof clinicalData]).map(f => (
                <div key={f.key}>
                  <div className="data-label mb-1">{f.label}</div>
                  <p className="text-sm text-navy-800/80 leading-relaxed">
                    {clinicalData?.[f.key as keyof typeof clinicalData] as string}
                  </p>
                </div>
              ))}

              {/* Medications */}
              {clinicalData?.medications && clinicalData.medications.length > 0 && (
                <div>
                  <div className="data-label mb-1">Current medications</div>
                  <div className="space-y-1">
                    {clinicalData.medications.map((m: any, i: number) => (
                      <div key={i} className="text-sm text-navy-800/70">
                        {typeof m === 'string' ? m : `${m.name}${m.dose ? ` ${m.dose}` : ''}${m.frequency ? ` · ${m.frequency}` : ''}`}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {clinicalData?.allergies && (
                <div>
                  <div className="data-label mb-1">Allergies</div>
                  <p className="text-sm text-red-600">{clinicalData.allergies}</p>
                </div>
              )}

              {clinicalData?.comorbidities && (
                <div>
                  <div className="data-label mb-1">Comorbidities</div>
                  <p className="text-sm text-navy-800/70">{clinicalData.comorbidities}</p>
                </div>
              )}

              {/* Documents */}
              {documents.length > 0 && (
                <div>
                  <div className="data-label mb-2">Documents ({documents.length})</div>
                  <div className="space-y-2">
                    {documents.map(doc => (
                      <a key={doc.id} href={doc.signedUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2.5 p-3 bg-navy-50 rounded-xl
                                   hover:bg-navy-100 transition-colors">
                        <div className="w-8 h-8 bg-navy-800/10 rounded-lg flex items-center
                                        justify-center flex-shrink-0">
                          <span className="text-2xs font-mono font-medium text-navy-800/60 uppercase">
                            {doc.file_name.split('.').pop()?.slice(0, 3)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-navy-800 truncate">{doc.file_name}</p>
                          <p className="text-2xs text-navy-800/40">
                            {doc.file_type.replace(/_/g, ' ')} · {(doc.size_bytes / 1024).toFixed(0)}KB
                          </p>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                             className="text-navy-800/30 flex-shrink-0">
                          <path d="M3 8l5 5 5-5M8 3v10" stroke="currentColor" strokeWidth="1.3"
                                strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Thread tab */}
          {tab === 'thread' && (
            <div>
              <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
                {messages.map(msg => (
                  <div key={msg.id}
                    className={`flex ${msg.sender_type === 'specialist' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm
                      ${msg.sender_type === 'system'
                        ? 'bg-gray-100 text-gray-500 text-xs text-center mx-auto rounded-xl'
                        : msg.sender_type === 'specialist'
                        ? 'bg-navy-800 text-white'
                        : 'bg-white border border-navy-800/10 text-navy-800'}`}>
                      <p className="leading-relaxed">{msg.content}</p>
                      <p className={`text-2xs mt-1
                        ${msg.sender_type === 'specialist' ? 'text-white/50' : 'text-navy-800/30'}`}>
                        {new Date(msg.created_at).toLocaleTimeString('en-IN', {
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {!isClosed && (
                <form onSubmit={handleSendMessage}
                  className="flex gap-2 p-3 border-t border-navy-800/8">
                  <input value={msgText} onChange={e => setMsgText(e.target.value)}
                    placeholder="Type a message..."
                    className="input-clinical flex-1 text-sm py-2.5" />
                  <button type="submit" disabled={isPending || !msgText.trim()}
                    className="btn-primary px-4 py-2.5 text-sm">
                    Send
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Updates tab */}
          {tab === 'updates' && (
            <div className="p-4">
              {updates.length > 0 ? (
                <div className="space-y-3">
                  {updates.map(u => {
                    const typeLabel = UPDATE_TYPES.find(t => t.value === u.update_type)?.label
                      || u.update_type.replace(/_/g, ' ')
                    return (
                      <div key={u.id} className="border border-navy-800/8 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-navy-800 capitalize">
                            {typeLabel}
                          </span>
                          <div className="flex items-center gap-2">
                            {u.whatsapp_delivered && (
                              <span className="text-2xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                                WhatsApp sent
                              </span>
                            )}
                            <span className="text-2xs text-navy-800/35">
                              {formatDate(u.created_at)}
                            </span>
                          </div>
                        </div>
                        {Object.entries(u.structured_data || {}).map(([k, v]) => (
                          v && (
                            <div key={k} className="text-xs text-navy-800/60">
                              <span className="font-medium">
                                {UPDATE_FIELD_LABELS[k] || k}:
                              </span>{' '}{v}
                            </div>
                          )
                        ))}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-navy-800/40 text-center py-6">
                  No updates sent yet
                </p>
              )}
            </div>
          )}
        </div>

      </main>
    </div>
  )
}
