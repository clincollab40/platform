'use client'

import { useState, useTransition, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  amendNoteAction, approveNoteAction,
  sendPatientSummaryAction, sendReferrerSummaryAction,
  discardSessionAction, retryTranscriptionAction,
} from '@/app/actions/transcription'

type Session = any
type Specialist = { id: string; name: string; specialty: string }

const STATUS_LABELS: Record<string, string> = {
  recording: 'Recording', processing: 'Processing', extracting: 'Extracting',
  pending_review: 'Pending review', approved: 'Approved',
  sent_to_patient: 'Sent to patient', failed: 'Failed', cancelled: 'Cancelled',
}

const SECTION_LABELS: Record<string, string> = {
  history: 'Presenting Complaint & History', cardiac_history: 'Past Cardiac History',
  risk_factors: 'Cardiovascular Risk Factors', medications: 'Current Medications',
  examination: 'Clinical Examination', investigations: 'Investigations Reviewed',
  assessment: 'Clinical Assessment', plan: 'Management Plan',
  procedure_plan: 'Procedure Plan', surgical_plan: 'Planned Surgery',
  patient_instructions: 'Patient Instructions', follow_up: 'Follow-up Plan',
  risk_discussion: 'Risk Discussion & Consent', pre_op_instructions: 'Pre-operative Instructions',
  presenting: 'Presenting Complaint', neuro_history: 'Neurological History',
  current_symptoms: 'Current Neurological Symptoms', imaging: 'Imaging Reviewed',
  surgical_discussion: 'Surgical Plan & Risk Discussion',
  functional_status: 'Functional Status', comorbidities: 'Co-morbidities',
  surgical_history: 'Prior Surgical History', raw: 'Consultation Transcript',
}

export default function SessionDetailClient({ session, specialist }: {
  session: Session; specialist: Specialist
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<'note' | 'transcript' | 'summary' | 'flags'>('note')
  const [editingSection, setEditingSection] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [referrerMobile, setReferrerMobile] = useState('')
  const [showSendReferrer, setShowSendReferrer] = useState(false)
  const [reviewNotes, setReviewNotes] = useState('')

  const note       = session.consultation_notes?.[0]
  const template   = session.note_templates
  const sections   = (note?.sections || {}) as Record<string, string>
  const aiFlags    = (note?.ai_flags || []) as any[]
  const criticalFlags = aiFlags.filter((f: any) => f.severity === 'critical')
  const warnings      = aiFlags.filter((f: any) => f.severity === 'warning')

  // Auto-poll while processing — refresh every 5s until ready
  useEffect(() => {
    if (!['processing', 'extracting', 'recording'].includes(session.status)) return
    const interval = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(interval)
  }, [session.status, router])

  const isProcessing = ['processing', 'extracting'].includes(session.status)
  const canApprove   = session.status === 'pending_review'
  const canSend      = ['approved', 'sent_to_patient'].includes(session.status)
  const isFailed     = session.status === 'failed'

  function startEdit(sectionId: string) {
    setEditingSection(sectionId)
    setEditContent(sections[sectionId] || '')
  }

  async function saveEdit() {
    if (!editingSection) return
    startTransition(async () => {
      const result = await amendNoteAction(session.id, editingSection, editContent)
      if (!result.ok) toast.error(result.error)
      else { toast.success('Section updated'); setEditingSection(null); router.refresh() }
    })
  }

  async function handleApprove() {
    startTransition(async () => {
      const result = await approveNoteAction(session.id, reviewNotes || undefined)
      if (!result.ok) toast.error(result.error)
      else { toast.success('Note approved'); router.refresh() }
    })
  }

  async function handleSendPatient() {
    if (!session.patient_mobile) {
      toast.error('No patient mobile number on record. Add it to the session to send.')
      return
    }
    startTransition(async () => {
      const result = await sendPatientSummaryAction(session.id)
      if (!result.ok) toast.error(result.error)
      else { toast.success('Patient summary sent via WhatsApp'); router.refresh() }
    })
  }

  async function handleSendReferrer(e: React.FormEvent) {
    e.preventDefault()
    if (!referrerMobile.trim()) return
    startTransition(async () => {
      const result = await sendReferrerSummaryAction(session.id, referrerMobile)
      if (!result.ok) toast.error(result.error)
      else { toast.success('Referrer summary sent'); setShowSendReferrer(false) }
    })
  }

  // Get ordered sections from template or from note keys
  const orderedSectionIds = template?.sections
    ? (template.sections as any[]).map((s: any) => s.id).filter((id: string) => sections[id])
    : Object.keys(sections)

  return (
    <div className="min-h-screen bg-clinical-light">
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/transcription')} className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1 truncate">{session.patient_name}</span>
          <span className={`text-2xs px-2.5 py-1 rounded-full font-medium flex-shrink-0
            ${session.status === 'pending_review' ? 'bg-amber-50 text-amber-700' :
              session.status === 'approved' ? 'bg-forest-50 text-forest-700' :
              session.status === 'sent_to_patient' ? 'bg-gray-100 text-gray-500' :
              session.status === 'failed' ? 'bg-red-50 text-red-600' :
              'bg-blue-50 text-blue-700'}`}>
            {STATUS_LABELS[session.status] || session.status}
          </span>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Processing state */}
        {isProcessing && (
          <div className="card-clinical text-center py-8">
            <div className="w-10 h-10 border-2 border-navy-800/20 border-t-navy-800 rounded-full animate-spin mx-auto mb-4"/>
            <h2 className="font-display text-xl text-navy-800 mb-2">
              {session.status === 'processing' ? 'Transcribing audio...' : 'Extracting structured note...'}
            </h2>
            <p className="text-sm text-navy-800/50">This takes 20–60 seconds depending on consultation length.</p>
            <button onClick={() => router.refresh()} className="mt-4 text-sm text-navy-800/50 hover:text-navy-800 transition-colors">
              Refresh status
            </button>
          </div>
        )}

        {/* Failed state */}
        {isFailed && (
          <div className="bg-red-50 border border-red-200/60 rounded-2xl p-5 text-center">
            <h2 className="font-medium text-red-700 mb-2">Transcription failed</h2>
            <p className="text-sm text-red-600/80 mb-4">{session.error_message || 'An error occurred during transcription.'}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => startTransition(async () => {
                const r = await retryTranscriptionAction(session.id)
                if (!r.ok) toast.error(r.error); else { toast.success('Retrying...'); router.refresh() }
              })} disabled={isPending} className="btn-primary text-sm py-2 px-5">
                {isPending ? 'Retrying...' : 'Retry transcription'}
              </button>
              <button onClick={() => startTransition(async () => {
                await discardSessionAction(session.id); router.push('/transcription')
              })} className="btn-secondary text-sm py-2 px-5">Discard</button>
            </div>
          </div>
        )}

        {/* Critical flags — always at top when present */}
        {criticalFlags.length > 0 && (
          <div className="bg-red-50 border border-red-300 rounded-2xl p-4">
            <div className="data-label text-red-700/70 mb-3">🔴 Critical flags — review before approving</div>
            {criticalFlags.map((f: any, i: number) => (
              <div key={i} className="flex gap-2.5 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0"/>
                <div>
                  <div className="text-sm font-medium text-navy-800 capitalize">{f.type.replace(/_/g, ' ')}</div>
                  <div className="text-xs text-red-600/80">{f.message}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Note content */}
        {note && !isProcessing && (
          <>
            {/* Tabs */}
            <div className="card-clinical p-0 overflow-hidden">
              <div className="flex border-b border-navy-800/8">
                {[
                  { key: 'note',       label: `Note (${orderedSectionIds.length})` },
                  { key: 'transcript', label: 'Transcript' },
                  { key: 'summary',    label: 'Patient summary' },
                  { key: 'flags',      label: `Flags (${aiFlags.length})` },
                ].map(t => (
                  <button key={t.key} onClick={() => setTab(t.key as any)}
                    className={`flex-1 py-3 text-xs font-medium transition-colors
                      ${tab === t.key ? 'text-navy-800 border-b-2 border-navy-800' : 'text-navy-800/40'}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Note tab */}
              {tab === 'note' && (
                <div className="p-4 space-y-4">
                  {/* AI confidence */}
                  <div className="flex items-center gap-3">
                    <div className="text-xs text-navy-800/50">AI confidence</div>
                    <div className="flex-1 h-1.5 bg-navy-800/8 rounded-full overflow-hidden">
                      <div className="h-full bg-forest-700 rounded-full transition-all"
                        style={{ width: `${Math.round((note.ai_confidence || 0) * 100)}%` }}/>
                    </div>
                    <div className="text-xs font-medium text-navy-800">
                      {Math.round((note.ai_confidence || 0) * 100)}%
                    </div>
                  </div>

                  {/* ICD-10 codes */}
                  {(note.icd10_codes || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(note.icd10_codes as string[]).map(code => (
                        <span key={code} className="text-2xs bg-navy-50 text-navy-800/60 px-2 py-0.5 rounded font-mono">{code}</span>
                      ))}
                    </div>
                  )}

                  {/* Sections */}
                  {orderedSectionIds.map(sectionId => {
                    const content = sections[sectionId]
                    if (!content || content === 'Not documented in this consultation.') return null
                    const label = SECTION_LABELS[sectionId] || sectionId
                    const sectionFlags = aiFlags.filter((f: any) => f.section === sectionId)
                    const isEditing = editingSection === sectionId

                    return (
                      <div key={sectionId} className={`rounded-xl p-4 ${sectionFlags.length > 0 ? 'bg-amber-50/50 border border-amber-200/60' : 'bg-navy-800/3'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="data-label">{label}</div>
                          {canApprove && !isEditing && (
                            <button onClick={() => startEdit(sectionId)}
                              className="text-2xs text-navy-800/40 hover:text-navy-800/70 transition-colors">
                              Edit
                            </button>
                          )}
                        </div>
                        {isEditing ? (
                          <div className="space-y-2">
                            <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                              rows={Math.max(4, editContent.split('\n').length + 2)}
                              className="input-clinical resize-none text-sm w-full"/>
                            <div className="flex gap-2">
                              <button onClick={saveEdit} disabled={isPending}
                                className="btn-primary text-xs py-2 px-4">{isPending ? 'Saving...' : 'Save'}</button>
                              <button onClick={() => setEditingSection(null)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-navy-800/80 leading-relaxed whitespace-pre-wrap">{content}</p>
                        )}
                        {sectionFlags.map((f: any, i: number) => (
                          <div key={i} className="mt-2 flex gap-1.5 text-xs text-amber-700">
                            <span>⚠</span><span>{f.message}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Transcript tab */}
              {tab === 'transcript' && (
                <div className="p-4">
                  <p className="text-2xs text-navy-800/40 mb-3">
                    Raw transcript from Whisper. Speaker labels are heuristic estimates.
                  </p>
                  {session.speaker_segments ? (
                    <div className="space-y-3">
                      {(session.speaker_segments as any[]).map((seg: any, i: number) => (
                        <div key={i} className={`text-sm rounded-xl p-3 ${seg.speaker === 'doctor' ? 'bg-navy-50 border-l-2 border-navy-800' : seg.speaker === 'patient' ? 'bg-green-50 border-l-2 border-forest-700' : 'bg-gray-50'}`}>
                          <div className="data-label mb-1 capitalize">{seg.speaker}</div>
                          <p className="text-navy-800/80 leading-relaxed">{seg.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-navy-800/70 leading-relaxed whitespace-pre-wrap">
                      {session.raw_transcript || 'Transcript not available.'}
                    </p>
                  )}
                </div>
              )}

              {/* Patient summary tab */}
              {tab === 'summary' && (
                <div className="p-4 space-y-3">
                  {note.patient_summary ? (
                    <>
                      <div className="bg-green-50 rounded-xl p-4">
                        <div className="data-label mb-2 text-forest-700/70">Patient-facing WhatsApp summary</div>
                        <p className="text-sm text-navy-800/80 leading-relaxed whitespace-pre-wrap">{note.patient_summary}</p>
                      </div>
                      <p className="text-xs text-navy-800/40 leading-relaxed">
                        This summary is in plain English. Review before sending. The specialist note above contains the full clinical documentation.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-navy-800/50 text-center py-4">Patient summary not yet generated.</p>
                  )}
                </div>
              )}

              {/* Flags tab */}
              {tab === 'flags' && (
                <div className="p-4 space-y-3">
                  {aiFlags.length === 0 ? (
                    <div className="text-center py-4">
                      <div className="text-forest-700 text-lg mb-1">✓</div>
                      <p className="text-sm text-navy-800/50">No AI flags — note looks complete</p>
                    </div>
                  ) : (
                    aiFlags.map((f: any, i: number) => (
                      <div key={i} className={`rounded-xl p-3 border ${f.severity === 'critical' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium capitalize">{f.type.replace(/_/g, ' ')}</span>
                          <span className={`text-2xs px-1.5 py-0.5 rounded-full font-medium ${f.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {f.severity}
                          </span>
                        </div>
                        <p className="text-xs text-navy-800/70">{f.message}</p>
                        {f.section && <p className="text-2xs text-navy-800/40 mt-0.5">Section: {SECTION_LABELS[f.section] || f.section}</p>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Action buttons */}
            {canApprove && (
              <div className="card-clinical space-y-3">
                <div className="data-label">Approve and send</div>
                <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)}
                  placeholder="Optional: add review notes or amendments made..."
                  rows={2} className="input-clinical resize-none text-sm"/>
                <button onClick={handleApprove} disabled={isPending}
                  className="btn-primary w-full py-3">
                  {isPending ? 'Approving...' : 'Approve note — ready to send'}
                </button>
                <button onClick={() => startTransition(async () => {
                  await discardSessionAction(session.id); router.push('/transcription')
                })} className="w-full text-xs text-red-500 hover:text-red-700 transition-colors py-1">
                  Discard this recording
                </button>
              </div>
            )}

            {canSend && (
              <div className="grid grid-cols-2 gap-3">
                <button onClick={handleSendPatient} disabled={isPending || !session.patient_mobile}
                  className="bg-forest-700 text-white rounded-xl py-3 text-sm font-medium hover:bg-forest-800 active:scale-95 transition-all disabled:opacity-50">
                  {session.status === 'sent_to_patient' ? '✓ Sent to patient' : 'Send to patient (WA)'}
                </button>
                <button onClick={() => setShowSendReferrer(true)}
                  className="btn-secondary py-3 text-sm">
                  Send to referrer
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Send to referrer modal */}
      {showSendReferrer && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center px-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-2">Send referrer summary</h2>
            <p className="text-sm text-navy-800/50 mb-4">Enter the referring doctor's WhatsApp number to send the clinical summary.</p>
            <form onSubmit={handleSendReferrer} className="space-y-4">
              <div>
                <label className="data-label block mb-1.5">Referring doctor mobile</label>
                <input type="tel" value={referrerMobile} onChange={e => setReferrerMobile(e.target.value)}
                  placeholder="9876543210" className="input-clinical" autoFocus required/>
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={isPending || !referrerMobile.trim()} className="btn-primary flex-1">
                  {isPending ? 'Sending...' : 'Send via WhatsApp'}
                </button>
                <button type="button" onClick={() => setShowSendReferrer(false)} className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
