'use client'

import { useState, useEffect, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { retrySynthesisAction } from '@/app/actions/synthesis'

type Job = {
  id: string
  status: string
  patient_name: string
  trigger: string
  clinical_brief: string | null
  data_completeness: number
  output_json: any
  error_message: string | null
  created_at: string
  completed_at: string | null
  agent_traces: {
    tool_name: string
    tool_status: string
    output_summary: string | null
    duration_ms: number | null
    data_source: string | null
    executed_at: string
  }[]
  synthesis_findings: {
    id: string
    category: string
    finding: string
    significance: string
    source: string
    is_red_flag: boolean
    red_flag_message: string | null
  }[]
}

const TOOL_LABELS: Record<string, string> = {
  triage_data:          'Triage questionnaire',
  referral_summary:     'Referral clinical data',
  appointment_history:  'Appointment history',
  chatbot_interactions: 'Chatbot interactions',
  specialist_notes:     'Case communications',
}

const SOURCE_LABELS: Record<string, string> = {
  triage_self_report:   'Triage (patient-reported)',
  referral_summary:     'Referral (clinician)',
  appointment_history:  'Appointment records',
  chatbot_interaction:  'Chatbot',
  specialist_notes:     'Notes',
}

const SIG_CONFIG = {
  routine:  { color: 'text-navy-800/60', dot: 'bg-navy-800/20',  label: 'Routine' },
  notable:  { color: 'text-amber-700',   dot: 'bg-amber-400',    label: 'Notable' },
  critical: { color: 'text-red-700',     dot: 'bg-red-500',      label: 'Critical' },
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function SynthesisBriefClient({
  job, specialist,
}: {
  job: Job
  specialist: { id: string; name: string; specialty: string }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showTrace, setShowTrace] = useState(false)
  const [pollingCount, setPollingCount] = useState(0)

  // Poll if job is still running
  useEffect(() => {
    if (job.status === 'running' || job.status === 'queued') {
      const interval = setInterval(() => {
        router.refresh()
        setPollingCount(c => c + 1)
        if (pollingCount > 30) clearInterval(interval) // stop after 30 polls
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [job.status, pollingCount])

  const isRunning  = job.status === 'queued' || job.status === 'running'
  const isFailed   = job.status === 'failed'
  const isDone     = job.status === 'completed' || job.status === 'partial'

  const criticalFindings = job.synthesis_findings.filter(f => f.significance === 'critical')
  const notableFindings  = job.synthesis_findings.filter(f => f.significance === 'notable')
  const routineFindings  = job.synthesis_findings.filter(f => f.significance === 'routine')

  // Group findings by category
  const byCategory: Record<string, typeof job.synthesis_findings> = {}
  job.synthesis_findings.forEach(f => {
    if (!byCategory[f.category]) byCategory[f.category] = []
    byCategory[f.category]!.push(f)
  })

  const output = job.output_json as any

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/synthesis')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1 truncate">
            360° brief — {job.patient_name}
          </span>
          {isDone && (
            <span className="text-2xs bg-forest-50 text-forest-700 px-2.5 py-1 rounded-full font-medium">
              {job.data_completeness}% complete
            </span>
          )}
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Running state */}
        {isRunning && (
          <div className="card-clinical text-center py-8">
            <div className="w-10 h-10 border-2 border-navy-800/20 border-t-navy-800 rounded-full animate-spin mx-auto mb-4" />
            <h2 className="font-display text-xl text-navy-800 mb-2">Synthesising clinical data</h2>
            <p className="text-sm text-navy-800/50 leading-relaxed">
              Gathering data from triage, referrals, appointments, and case history.
              This takes 10–20 seconds.
            </p>
            <div className="mt-4 space-y-1.5">
              {TOOL_LABELS && Object.entries(TOOL_LABELS).map(([key, label]) => {
                const trace = job.agent_traces.find(t => t.tool_name === key)
                return (
                  <div key={key} className="flex items-center gap-2.5 text-xs text-left max-w-xs mx-auto">
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                      trace?.tool_status === 'success' ? 'bg-forest-700' :
                      trace?.tool_status === 'running' ? 'bg-blue-400 animate-pulse' :
                      trace?.tool_status === 'failed'  ? 'bg-red-400' :
                      'bg-navy-800/15'
                    }`} />
                    <span className="text-navy-800/60">{label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Failed state */}
        {isFailed && (
          <div className="bg-red-50 border border-red-200/60 rounded-2xl p-5 text-center">
            <h2 className="font-medium text-red-700 mb-2">Synthesis failed</h2>
            <p className="text-sm text-red-600/80 mb-4">{job.error_message || 'An error occurred during synthesis.'}</p>
            <button
              onClick={() => startTransition(async () => {
                const result = await retrySynthesisAction(job.id)
                if (!result.ok) toast.error(result.error)
                else { toast.success('Retrying synthesis...'); router.refresh() }
              })}
              disabled={isPending}
              className="btn-primary"
            >
              {isPending ? 'Retrying...' : 'Retry synthesis'}
            </button>
          </div>
        )}

        {/* Completed state */}
        {isDone && (
          <>
            {/* Header card */}
            <div className="card-clinical">
              <div className="flex items-start gap-3 mb-4">
                <div className="flex-1">
                  <h1 className="font-display text-xl text-navy-800">{job.patient_name}</h1>
                  <div className="text-xs text-navy-800/50 mt-0.5 capitalize">
                    {job.trigger.replace(/_/g, ' ')} synthesis · {fmtDate(job.completed_at)}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-display text-2xl text-navy-800">{job.data_completeness}%</div>
                  <div className="data-label">data coverage</div>
                </div>
              </div>

              {/* Data sources strip */}
              <div className="flex gap-1.5 flex-wrap">
                {job.agent_traces.map(t => (
                  <div key={t.tool_name}
                    className={`text-2xs px-2 py-0.5 rounded-full font-medium
                      ${t.tool_status === 'success'
                        ? 'bg-forest-50 text-forest-700'
                        : 'bg-gray-100 text-gray-400'}`}>
                    {TOOL_LABELS[t.tool_name] || t.tool_name}
                  </div>
                ))}
              </div>
            </div>

            {/* Critical flags — always at top */}
            {criticalFindings.length > 0 && (
              <div className="bg-red-50 border border-red-300 rounded-2xl p-4">
                <div className="data-label text-red-700/70 mb-3">🔴 Critical findings — review before consultation</div>
                <div className="space-y-2">
                  {criticalFindings.map(f => (
                    <div key={f.id} className="flex gap-2.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-medium text-navy-800">{f.finding}</div>
                        <div className="text-xs text-red-600/70">{SOURCE_LABELS[f.source] || f.source}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clinical brief — AI generated */}
            {job.clinical_brief && (
              <div className="bg-purple-50 border border-purple-200/60 rounded-2xl p-4">
                <div className="data-label text-purple-700/70 mb-2">AI clinical synthesis</div>
                <p className="text-sm text-purple-900 leading-relaxed">{job.clinical_brief}</p>
                <p className="text-2xs text-purple-600/40 mt-2">
                  Generated from {job.agent_traces.filter(t => t.tool_status === 'success').length} data sources ·
                  Advisory only — specialist makes all clinical decisions
                </p>
              </div>
            )}

            {/* Recommended focus areas */}
            {output?.recommended_focus_areas?.length > 0 && (
              <div className="card-clinical">
                <div className="data-label mb-3">Recommended consultation focus areas</div>
                <div className="space-y-2">
                  {output.recommended_focus_areas.map((area: string, i: number) => (
                    <div key={i} className="flex gap-2.5 items-start">
                      <div className="w-5 h-5 bg-navy-800/8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-2xs font-medium text-navy-800/60">{i + 1}</span>
                      </div>
                      <span className="text-sm text-navy-800/80 leading-relaxed">{area}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Key findings grouped by category */}
            {Object.keys(byCategory).length > 0 && (
              <div className="card-clinical p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-navy-800/8">
                  <div className="data-label">
                    Key findings ({job.synthesis_findings.length})
                  </div>
                </div>
                {Object.entries(byCategory).map(([category, findings]) => (
                  <div key={category}>
                    <div className="px-4 py-2 bg-navy-800/3">
                      <div className="text-2xs font-medium text-navy-800/50 uppercase tracking-wider">
                        {category}
                      </div>
                    </div>
                    {findings.map(f => {
                      const sig = SIG_CONFIG[f.significance as keyof typeof SIG_CONFIG] || SIG_CONFIG.routine
                      return (
                        <div key={f.id} className="flex items-start gap-3 px-4 py-3 border-b border-navy-800/5 last:border-0">
                          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${sig.dot}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm leading-relaxed ${sig.color}`}>{f.finding}</p>
                            <p className="text-2xs text-navy-800/30 mt-0.5">
                              {SOURCE_LABELS[f.source] || f.source}
                            </p>
                          </div>
                          <span className={`text-2xs flex-shrink-0 font-medium ${sig.color}`}>
                            {sig.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}

            {/* Agent trace — collapsible */}
            <details>
              <summary
                className="text-xs text-navy-800/40 cursor-pointer hover:text-navy-800/60 transition-colors flex items-center gap-1.5"
                onClick={() => setShowTrace(!showTrace)}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`transition-transform ${showTrace ? 'rotate-90' : ''}`}>
                  <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Data sources used in this synthesis
              </summary>
              <div className="mt-3 card-clinical p-0 overflow-hidden">
                {job.agent_traces.map(t => (
                  <div key={t.tool_name} className="flex items-center gap-3 px-4 py-3 border-b border-navy-800/5 last:border-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      t.tool_status === 'success' ? 'bg-forest-700' :
                      t.tool_status === 'failed'  ? 'bg-red-400' : 'bg-gray-300'
                    }`} />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-navy-800">{TOOL_LABELS[t.tool_name] || t.tool_name}</div>
                      {t.output_summary && (
                        <div className="text-2xs text-navy-800/40">{t.output_summary}</div>
                      )}
                    </div>
                    {t.duration_ms && (
                      <span className="text-2xs text-navy-800/25 flex-shrink-0">{t.duration_ms}ms</span>
                    )}
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </main>
    </div>
  )
}
