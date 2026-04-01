'use client'

import { useState, useRef, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createSessionAction, submitAudioAction } from '@/app/actions/transcription'

type Session = {
  id: string
  patient_name: string
  consultation_type: string
  status: string
  audio_duration_secs: number | null
  recording_started_at: string | null
  created_at: string
  note_templates: { name: string } | null
  consultation_notes: { ai_confidence: number; ai_flags: any[] }[] | null
}

type Template = { id: string; name: string; consultation_type: string; is_default: boolean }

const STATUS = {
  recording:      { label: 'Recording',      bg: 'bg-red-50',    text: 'text-red-600',    dot: 'bg-red-500 animate-pulse' },
  processing:     { label: 'Processing',      bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-500 animate-pulse' },
  extracting:     { label: 'Extracting',      bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-400 animate-pulse' },
  pending_review: { label: 'Review needed',   bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500' },
  approved:       { label: 'Approved',        bg: 'bg-forest-50', text: 'text-forest-700', dot: 'bg-forest-600' },
  sent_to_patient:{ label: 'Sent to patient', bg: 'bg-gray-100',  text: 'text-gray-600',   dot: 'bg-gray-400' },
  failed:         { label: 'Failed',          bg: 'bg-red-50',    text: 'text-red-600',    dot: 'bg-red-500' },
  cancelled:      { label: 'Cancelled',       bg: 'bg-gray-100',  text: 'text-gray-400',   dot: 'bg-gray-300' },
}

const CONSULT_TYPE_LABELS: Record<string, string> = {
  new_opd:      'New OPD',    follow_up:       'Follow-up',
  pre_procedure:'Pre-procedure', procedure_note:'Procedure note',
  discharge:    'Discharge',  emergency:       'Emergency',
  teleconsult:  'Teleconsult',
}

function fmtDuration(secs: number | null) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60); const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

type RecorderState = 'idle' | 'recording' | 'stopped' | 'uploading'

export default function TranscriptionListClient({ specialist, sessions, templates, analytics }: {
  specialist: { id: string; name: string; specialty: string }
  sessions:   Session[]
  templates:  Template[]
  analytics:  { total: number; pendingReview: number; approved: number; sent: number }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // New session form
  const [showNew,       setShowNew]       = useState(false)
  const [newForm,       setNewForm]       = useState({ patient_name: '', template_id: '', consult_type: 'new_opd' })

  // Recorder state
  const [recorderState, setRecorderState] = useState<RecorderState>('idle')
  const [recDuration,   setRecDuration]   = useState(0)
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [audioBlob,     setAudioBlob]     = useState<Blob | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef        = useRef<Blob[]>([])
  const timerRef         = useRef<NodeJS.Timeout | null>(null)

  // Status filter
  const [statusFilter, setStatusFilter] = useState('all')
  const displayed = statusFilter === 'all' ? sessions
    : sessions.filter(s => s.status === statusFilter)

  async function handleCreateAndRecord(e: React.FormEvent) {
    e.preventDefault()
    if (!newForm.patient_name.trim()) return

    startTransition(async () => {
      const result = await createSessionAction(
        newForm.patient_name, newForm.template_id || null, newForm.consult_type
      )
      if (!result.ok) { toast.error(result.error); return }

      setActiveSession(result.value.id)
      setShowNew(false)
      await startRecording(result.value.id)
    })
  }

  async function startRecording(sessionId: string) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mr = new MediaRecorder(stream, { mimeType })

      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setAudioBlob(blob)
        stream.getTracks().forEach(t => t.stop())
      }

      mr.start(1000) // capture every 1 second
      mediaRecorderRef.current = mr
      setRecorderState('recording')
      setRecDuration(0)

      timerRef.current = setInterval(() => setRecDuration(d => d + 1), 1000)
    } catch (err) {
      toast.error('Could not access microphone. Please check browser permissions.')
      console.error('[Recorder]', err)
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    if (timerRef.current) clearInterval(timerRef.current)
    setRecorderState('stopped')
  }

  async function uploadRecording() {
    if (!audioBlob || !activeSession) return
    setRecorderState('uploading')

    startTransition(async () => {
      const fd = new FormData()
      fd.append('audio', audioBlob, 'consultation.webm')

      const result = await submitAudioAction(activeSession, fd)
      if (!result.ok) {
        toast.error(result.error)
        setRecorderState('stopped')
      } else {
        toast.success('Recording submitted — transcription in progress')
        setRecorderState('idle')
        setAudioBlob(null)
        setActiveSession(null)
        router.refresh()
        // Navigate to session detail after short delay
        setTimeout(() => router.push(`/transcription/${activeSession}`), 500)
      }
    })
  }

  function discardRecording() {
    mediaRecorderRef.current?.stop()
    if (timerRef.current) clearInterval(timerRef.current)
    setRecorderState('idle')
    setAudioBlob(null)
    setActiveSession(null)
    chunksRef.current = []
  }

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1">Consultation transcription</span>
          <button onClick={() => router.push('/transcription/templates')}
            className="text-xs text-navy-800/60 hover:text-navy-800 transition-colors mr-1">Templates</button>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-medium px-3 py-2 rounded-xl hover:bg-red-600 active:scale-95 transition-all">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="5"/></svg>
            New recording
          </button>
        </div>
      </nav>

      {/* Floating recorder */}
      {recorderState !== 'idle' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
          <div className="bg-navy-800 rounded-2xl px-5 py-4 shadow-clinical-lg flex items-center gap-4 min-w-72">
            <div className="flex items-center gap-2 flex-1">
              {recorderState === 'recording' && (
                <div className="w-3 h-3 rounded-full bg-red-400 animate-pulse flex-shrink-0" />
              )}
              {recorderState === 'stopped' && (
                <div className="w-3 h-3 rounded-full bg-amber-400 flex-shrink-0" />
              )}
              {recorderState === 'uploading' && (
                <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin flex-shrink-0" />
              )}
              <div>
                <div className="text-white text-xs font-medium">
                  {recorderState === 'recording' ? 'Recording' : recorderState === 'stopped' ? 'Recording stopped' : 'Uploading...'}
                </div>
                <div className="text-white/50 text-2xs font-mono">{fmtDuration(recDuration)}</div>
              </div>
            </div>
            {recorderState === 'recording' && (
              <button onClick={stopRecording}
                className="bg-red-500 text-white text-xs font-medium px-3 py-2 rounded-xl hover:bg-red-600 transition-colors">
                Stop
              </button>
            )}
            {recorderState === 'stopped' && (
              <div className="flex gap-2">
                <button onClick={discardRecording}
                  className="text-white/50 text-xs hover:text-white/80 transition-colors px-2 py-2">
                  Discard
                </button>
                <button onClick={uploadRecording} disabled={isPending}
                  className="bg-forest-700 text-white text-xs font-medium px-3 py-2 rounded-xl hover:bg-forest-800 transition-colors">
                  {isPending ? 'Uploading...' : 'Transcribe'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Analytics */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Total',          value: analytics.total,         color: 'text-navy-800' },
            { label: 'Review needed',  value: analytics.pendingReview, color: 'text-amber-600' },
            { label: 'Approved',       value: analytics.approved,      color: 'text-forest-700' },
            { label: 'Sent to patient',value: analytics.sent,          color: 'text-navy-800/50' },
          ].map(s => (
            <div key={s.label} className="card-clinical text-center p-2.5">
              <div className={`font-display text-xl font-medium ${s.color}`}>{s.value}</div>
              <div className="data-label leading-tight mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Review needed alert */}
        {analytics.pendingReview > 0 && (
          <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4 cursor-pointer"
            onClick={() => setStatusFilter('pending_review')}>
            <div className="flex items-center justify-between">
              <div>
                <div className="data-label text-amber-700/70 mb-1">Review required</div>
                <p className="text-sm font-medium text-amber-900">
                  {analytics.pendingReview} consultation note{analytics.pendingReview > 1 ? 's' : ''} awaiting your review before sending
                </p>
              </div>
              <div className="w-8 h-8 bg-amber-500 rounded-xl flex items-center justify-center text-white font-medium text-sm">
                {analytics.pendingReview}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {['all', 'pending_review', 'approved', 'processing', 'failed'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all border
                ${statusFilter === s ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}>
              {s === 'all' ? `All (${sessions.length})` : (STATUS[s as keyof typeof STATUS]?.label || s)}
            </button>
          ))}
        </div>

        {/* Sessions list */}
        {displayed.length > 0 ? (
          <div className="card-clinical p-0 overflow-hidden">
            {displayed.map((session, idx) => {
              const cfg = STATUS[session.status as keyof typeof STATUS] || STATUS.processing
              const note = session.consultation_notes?.[0]
              const flagCount = note?.ai_flags ? (note.ai_flags as any[]).filter((f: any) => f.severity === 'critical').length : 0

              return (
                <button key={session.id}
                  onClick={() => router.push(`/transcription/${session.id}`)}
                  className={`w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-navy-50/60 transition-colors
                    ${idx < displayed.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${cfg.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-medium text-navy-800">{session.patient_name}</span>
                      <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                      {flagCount > 0 && (
                        <span className="text-2xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">
                          {flagCount} flag{flagCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-navy-800/50">
                      {CONSULT_TYPE_LABELS[session.consultation_type] || session.consultation_type}
                      {session.note_templates && ` · ${session.note_templates.name}`}
                      {session.audio_duration_secs && ` · ${fmtDuration(session.audio_duration_secs)}`}
                    </div>
                  </div>
                  <span className="text-xs text-navy-800/35 flex-shrink-0">{timeAgo(session.created_at)}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="card-clinical text-center py-10">
            <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-red-500">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h3 className="font-display text-xl text-navy-800 mb-2">No recordings yet</h3>
            <p className="text-sm text-navy-800/50 mb-5 max-w-xs mx-auto leading-relaxed">
              Record your first consultation. The AI will transcribe and extract a structured note automatically.
            </p>
            <button onClick={() => setShowNew(true)} className="btn-primary">Start recording</button>
          </div>
        )}
      </main>

      {/* New session modal */}
      {showNew && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-1">New consultation recording</h2>
            <p className="text-sm text-navy-800/50 mb-4 leading-relaxed">
              Select the template and enter the patient name to begin. Recording starts immediately after.
            </p>
            <form onSubmit={handleCreateAndRecord} className="space-y-4">
              <div>
                <label className="data-label block mb-1.5">Patient name</label>
                <input type="text" value={newForm.patient_name}
                  onChange={e => setNewForm(p => ({ ...p, patient_name: e.target.value }))}
                  placeholder="Full name" className="input-clinical" autoFocus required />
              </div>
              <div>
                <label className="data-label block mb-1.5">Consultation type</label>
                <select value={newForm.consult_type}
                  onChange={e => setNewForm(p => ({ ...p, consult_type: e.target.value }))}
                  className="input-clinical">
                  {Object.entries(CONSULT_TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="data-label block mb-1.5">Note template (optional)</label>
                <select value={newForm.template_id}
                  onChange={e => setNewForm(p => ({ ...p, template_id: e.target.value }))}
                  className="input-clinical">
                  <option value="">No template — raw transcription only</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>
                  ))}
                </select>
                {templates.length === 0 && (
                  <p className="text-xs text-navy-800/40 mt-1">
                    No templates yet.{' '}
                    <button type="button" onClick={() => { setShowNew(false); router.push('/transcription/templates') }}
                      className="text-navy-800 underline">Create one</button>
                    {' '}for structured extraction.
                  </p>
                )}
              </div>
              <div className="bg-amber-50 rounded-xl p-3">
                <p className="text-xs text-amber-800/80 leading-relaxed">
                  Recording captures audio from your device microphone. Audio is processed immediately and is never stored permanently. The transcript is generated within 30–60 seconds after stopping.
                </p>
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={isPending || !newForm.patient_name.trim()}
                  className="flex-1 bg-red-500 text-white rounded-xl py-3 text-sm font-medium hover:bg-red-600 active:scale-95 transition-all disabled:opacity-50">
                  {isPending ? 'Starting...' : '● Start recording'}
                </button>
                <button type="button" onClick={() => setShowNew(false)} className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
