'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { triggerSynthesisAction } from '@/app/actions/synthesis'

type Job = {
  id: string
  status: string
  patient_name: string
  trigger: string
  data_completeness: number
  clinical_brief: string | null
  created_at: string
  completed_at: string | null
  synthesis_findings: { is_red_flag: boolean; significance: string }[]
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  queued:    { label: 'Queued',     bg: 'bg-gray-100',    text: 'text-gray-500',    dot: 'bg-gray-400' },
  running:   { label: 'Running',   bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500 animate-pulse' },
  completed: { label: 'Ready',     bg: 'bg-forest-50',   text: 'text-forest-700',  dot: 'bg-forest-600' },
  partial:   { label: 'Partial',   bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-500' },
  failed:    { label: 'Failed',    bg: 'bg-red-50',      text: 'text-red-600',     dot: 'bg-red-500' },
}

const TRIGGER_LABELS: Record<string, string> = {
  pre_consultation: 'Pre-consultation',
  post_referral:    'Post-referral',
  manual:           'Manual',
  pre_procedure:    'Pre-procedure',
  scheduled:        'Scheduled',
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function SynthesisListClient({
  specialist, jobs, analytics, protocols,
}: {
  specialist: { id: string; name: string; specialty: string }
  jobs: Job[]
  analytics: { total: number; completed: number; running: number; withFlags: number }
  protocols: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showTrigger, setShowTrigger] = useState(false)
  const [form, setForm] = useState({
    patient_name:   '',
    patient_mobile: '',
    trigger_note:   '',
  })
  const [statusFilter, setStatusFilter] = useState('all')

  const displayed = statusFilter === 'all' ? jobs
    : jobs.filter(j => j.status === statusFilter)

  async function handleTrigger(e: React.FormEvent) {
    e.preventDefault()
    if (!form.patient_name.trim()) return

    startTransition(async () => {
      const result = await triggerSynthesisAction(
        form.patient_name,
        form.patient_mobile || undefined
      )
      if (!result.ok) {
        toast.error(result.error)
      } else {
        toast.success('360° synthesis started')
        setShowTrigger(false)
        setForm({ patient_name: '', patient_mobile: '', trigger_note: '' })
        router.refresh()
        // Navigate to brief after short delay
        setTimeout(() => router.push(`/synthesis/${result.value.jobId}`), 800)
      }
    })
  }

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1">360° Clinical synthesis</span>
          <button
            onClick={() => setShowTrigger(true)}
            className="flex items-center gap-1.5 bg-navy-800 text-white text-xs font-medium
                       px-3 py-2 rounded-xl hover:bg-navy-900 active:scale-95 transition-all"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            New synthesis
          </button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Explainer — first-time context */}
        <div className="bg-purple-50 border border-purple-200/60 rounded-2xl px-4 py-3">
          <p className="text-xs text-purple-800/80 leading-relaxed">
            <span className="font-medium">360° synthesis</span> aggregates triage, referral, appointment, and chatbot data for a patient into a single pre-consultation clinical brief — automatically generated when triage completes.
          </p>
        </div>

        {/* Analytics strip */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Total',     value: analytics.total,     color: 'text-navy-800' },
            { label: 'Ready',     value: analytics.completed, color: 'text-forest-700' },
            { label: 'Running',   value: analytics.running,   color: 'text-blue-600' },
            { label: 'Flagged',   value: analytics.withFlags, color: 'text-red-600' },
          ].map(s => (
            <div key={s.label} className="card-clinical text-center p-2.5">
              <div className={`font-display text-xl font-medium ${s.color}`}>{s.value}</div>
              <div className="data-label leading-tight mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {['all', 'completed', 'running', 'queued', 'failed'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap
                flex-shrink-0 capitalize transition-all border
                ${statusFilter === s
                  ? 'bg-navy-800 text-white border-navy-800'
                  : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}>
              {s === 'all' ? `All (${jobs.length})` :
               s === 'running' ? `In progress (${jobs.filter(j=>j.status===s||j.status==='queued').length})` :
               `${STATUS_CONFIG[s]?.label || s} (${jobs.filter(j=>j.status===s).length})`}
            </button>
          ))}
        </div>

        {/* Jobs list */}
        {displayed.length > 0 ? (
          <div className="card-clinical p-0 overflow-hidden">
            {displayed.map((job, idx) => {
              const cfg     = STATUS_CONFIG[job.status] || STATUS_CONFIG.queued
              const flags   = (job.synthesis_findings || []).filter(f => f.is_red_flag)
              const critical = (job.synthesis_findings || []).filter(f => f.significance === 'critical')
              const isReady = job.status === 'completed' || job.status === 'partial'

              return (
                <button
                  key={job.id}
                  onClick={() => isReady && router.push(`/synthesis/${job.id}`)}
                  disabled={!isReady}
                  className={`w-full flex items-start gap-3 px-4 py-4 text-left transition-colors
                    ${idx < displayed.length - 1 ? 'border-b border-navy-800/5' : ''}
                    ${isReady ? 'hover:bg-navy-50/60 cursor-pointer' : 'cursor-default'}`}
                >
                  {/* Status dot */}
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${cfg.dot}`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-medium text-navy-800">{job.patient_name}</span>
                      <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
                        {cfg.label}
                      </span>
                      {critical.length > 0 && (
                        <span className="text-2xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-600">
                          🔴 {critical.length} critical
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-navy-800/50 mb-0.5">
                      {TRIGGER_LABELS[job.trigger] || job.trigger}
                      {job.data_completeness > 0 && ` · ${job.data_completeness}% data`}
                    </div>
                    {job.clinical_brief && (
                      <p className="text-xs text-navy-800/40 line-clamp-2 leading-relaxed">
                        {job.clinical_brief}
                      </p>
                    )}
                    {(job.status === 'running' || job.status === 'queued') && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="w-2 h-2 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-2xs text-blue-600">Synthesising data...</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-navy-800/35">{timeAgo(job.created_at)}</span>
                    {isReady && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                        className="text-navy-800/20">
                        <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.3"
                          strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="card-clinical text-center py-10">
            <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center
                            justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-purple-600">
                <path d="M12 2a10 10 0 110 20A10 10 0 0112 2z" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12 8v4l3 3" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="font-display text-xl text-navy-800 mb-2">No synthesis briefs yet</h3>
            <p className="text-sm text-navy-800/50 mb-5 max-w-xs mx-auto leading-relaxed">
              Briefs are generated automatically when a patient completes triage.
              You can also trigger one manually.
            </p>
            <button onClick={() => setShowTrigger(true)} className="btn-primary">
              Trigger manual synthesis
            </button>
          </div>
        )}

        {/* Architecture note */}
        <div className="text-center">
          <button
            onClick={() => router.push('/api/health')}
            className="text-2xs text-navy-800/25 hover:text-navy-800/40 transition-colors"
          >
            Module health status →
          </button>
        </div>
      </main>

      {/* Manual trigger modal */}
      {showTrigger && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center
                        px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-1">Manual synthesis</h2>
            <p className="text-sm text-navy-800/50 mb-4 leading-relaxed">
              Aggregate all available clinical data for a patient into a pre-consultation brief.
            </p>
            <form onSubmit={handleTrigger} className="space-y-4">
              <div>
                <label className="data-label block mb-1.5">Patient name</label>
                <input
                  type="text"
                  value={form.patient_name}
                  onChange={e => setForm(p => ({ ...p, patient_name: e.target.value }))}
                  placeholder="Full name"
                  className="input-clinical"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="data-label block mb-1.5">Patient mobile (optional — improves data matching)</label>
                <input
                  type="tel"
                  value={form.patient_mobile}
                  onChange={e => setForm(p => ({ ...p, patient_mobile: e.target.value }))}
                  placeholder="9876543210"
                  className="input-clinical"
                />
              </div>
              <div className="bg-navy-50 rounded-xl p-3">
                <p className="text-xs text-navy-800/50 leading-relaxed">
                  The synthesis agent will search triage sessions, referral records,
                  appointment history, and case communications for this patient.
                  Results typically arrive in 10–20 seconds.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={isPending || !form.patient_name.trim()}
                  className="btn-primary flex-1"
                >
                  {isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white
                                       rounded-full animate-spin"/>
                      Starting...
                    </span>
                  ) : 'Run synthesis'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowTrigger(false)}
                  className="btn-secondary px-5"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
