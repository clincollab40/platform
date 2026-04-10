'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  editSectionAction,
  approvePatientEducationAction,
  retryContentRequestAction,
} from '@/app/actions/content'
import { CONTENT_TYPES } from '../content-list-client'

type Section = {
  id: string; section_title: string; section_type: string; content_text: string
  speaker_notes: string | null; evidence_level: string; evidence_tier: string
  evidence_summary: string | null; is_tier2_section: boolean; sort_order: number
  is_edited: boolean; edited_text: string | null
}
type Source = {
  id: string; url: string | null; title: string | null; credibility_score: number | null
  evidence_tier: string | null; source_type: string | null; institution: string | null
  used_in_output: boolean; excluded_reason: string | null
  vancouver_citation: string | null; citation_number: number | null
}
type Trace = {
  step_number: number; step_name: string; step_label: string
  step_status: string; detail: string | null; duration_ms: number | null
}
type Output = {
  id: string; format: string; file_url: string | null
  file_size_kb: number | null; include_tier2: boolean; generated_at: string
}

const EVIDENCE_CONFIG: Record<string, { label: string; short: string; bg: string; text: string; border: string }> = {
  strong:    { label: 'Strong Evidence',         short: 'Strong',    bg: 'bg-forest-50',   text: 'text-forest-700',  border: 'border-forest-200/60' },
  moderate:  { label: 'Moderate Evidence',        short: 'Moderate',  bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200/60' },
  guideline: { label: 'Guideline Recommendation', short: 'Guideline', bg: 'bg-navy-50',     text: 'text-navy-700',    border: 'border-navy-200/60' },
  emerging:  { label: 'Emerging Evidence',        short: 'Emerging',  bg: 'bg-blue-50',     text: 'text-blue-700',    border: 'border-blue-200/60' },
}

const TIER1_LABEL: Record<string, string> = {
  pubmed_rct: 'PubMed RCT', systematic_review: 'Systematic Review', meta_analysis: 'Meta-Analysis',
  guideline: 'Clinical Guideline', textbook: 'Textbook', journal_article: 'Journal Article',
  registry_data: 'Registry', consensus: 'Expert Consensus',
}

function isProcessing(status: string) { return !['completed','failed'].includes(status) }

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// Parse plain text content into structured blocks
function parseContent(text: string): { type: 'paragraph' | 'bullet' | 'heading'; text: string }[] {
  if (!text) return []
  return text.split('\n').filter(line => line.trim()).map(line => {
    const t = line.trim()
    if (t.startsWith('## ') || t.startsWith('# ')) return { type: 'heading' as const, text: t.replace(/^#{1,2}\s/, '') }
    if (t.startsWith('- ') || t.startsWith('• ') || t.startsWith('* ')) return { type: 'bullet' as const, text: t.replace(/^[-•*]\s/, '') }
    if (t.match(/^\d+\.\s/)) return { type: 'bullet' as const, text: t.replace(/^\d+\.\s/, '') }
    return { type: 'paragraph' as const, text: t }
  })
}

// Credibility badge color by score
function credScore(score: number | null) {
  if (!score) return { bg: 'bg-gray-100', text: 'text-gray-500' }
  if (score >= 5) return { bg: 'bg-forest-700', text: 'text-white' }
  if (score >= 4) return { bg: 'bg-forest-600', text: 'text-white' }
  if (score >= 3) return { bg: 'bg-amber-500', text: 'text-white' }
  return { bg: 'bg-red-400', text: 'text-white' }
}

export default function ContentDetailClient({ request, traces: initialTraces, specialist }: {
  request: any; traces: Trace[]; specialist: any
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [traces,      setTraces]      = useState<Trace[]>(initialTraces)
  const [reqStatus,   setReqStatus]   = useState(request.status)
  const [errorMsg,    setErrorMsg]    = useState<string>(request.error_message || '')
  const [retrying,    setRetrying]    = useState(false)
  const [activeTab,   setActiveTab]   = useState<'progress'|'content'|'sources'|'references'|'download'>('progress')
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editText,    setEditText]    = useState('')
  const [showTier2,   setShowTier2]   = useState(true)
  const [generating,  setGenerating]  = useState<'pptx'|'docx'|null>(null)
  const [showNotes,   setShowNotes]   = useState<string | null>(null)
  const [copiedRef,   setCopiedRef]   = useState(false)
  const [startedAt]                   = useState<number>(() => Date.now())
  const [elapsedSec,  setElapsedSec]  = useState(0)

  // Track elapsed time while processing so user knows what's happening
  useEffect(() => {
    if (!isProcessing(reqStatus)) return
    const timer = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [reqStatus, startedAt])

  const sections = ((request.content_sections || []) as Section[])
    .sort((a, b) => a.sort_order - b.sort_order)
  const sources  = (request.content_sources  || []) as Source[]
  const outputs  = (request.content_outputs  || []) as Output[]

  const tier1Sections  = sections.filter(s => !s.is_tier2_section)
  const tier2Sections  = sections.filter(s => s.is_tier2_section)
  // Show ALL used sources (not filtered by tier — fixes blank sources bug)
  const usedSources    = sources.filter(s => s.used_in_output)
  const tier1Used      = usedSources.filter(s => s.evidence_tier === 'tier1' || !s.evidence_tier)
  const excldSources   = sources.filter(s => !s.used_in_output)
  // All sources with any citation info
  const refSources     = usedSources.filter(s => s.vancouver_citation || s.title || s.url)

  const ct = CONTENT_TYPES.find(t => t.value === request.content_type)
  const isPptxType = ['cme_presentation', 'grand_rounds'].includes(request.content_type)
  const canDownload = reqStatus === 'completed' && (!request.requires_specialist_review || request.specialist_reviewed)

  // Poll for progress
  const pollProgress = useCallback(async () => {
    if (!isProcessing(reqStatus)) return
    try {
      const lastStep = traces.length > 0 ? Math.max(...traces.map(t => t.step_number)) : 0
      const res  = await fetch(`/api/content?requestId=${request.id}&after=${lastStep}`)
      if (!res.ok) return
      const data = await res.json()
      if (data.traces?.length > 0) setTraces(prev => [...prev, ...data.traces])
      if (data.status) setReqStatus(data.status)
      if (data.summary?.errorMessage) setErrorMsg(data.summary.errorMessage)
      if (data.status === 'completed') {
        setActiveTab('content')
        router.refresh()
      }
    } catch {}
  }, [reqStatus, traces, request.id, router])

  useEffect(() => {
    if (!isProcessing(reqStatus)) return
    const interval = setInterval(pollProgress, 2500)
    return () => clearInterval(interval)
  }, [reqStatus, pollProgress])

  useEffect(() => {
    if (reqStatus === 'completed' && activeTab === 'progress' && sections.length > 0) {
      setActiveTab('content')
    }
  }, [reqStatus, sections.length, activeTab])

  async function saveEdit() {
    if (!editingId) return
    startTransition(async () => {
      const r = await editSectionAction(editingId, editText)
      if (!r.ok) toast.error(r.error)
      else { toast.success('Section updated'); setEditingId(null); router.refresh() }
    })
  }

  async function handleDownload(format: 'pptx' | 'docx') {
    setGenerating(format)
    try {
      const res = await fetch('/api/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.id, format, includeTier2: showTier2, specialistId: specialist.id }),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        toast.error(errText || 'File generation failed — please try again')
        setGenerating(null)
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? `ClinCollab_${format}_${Date.now()}.${format}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`${format.toUpperCase()} downloaded successfully`)
      router.refresh()
    } catch (err: any) {
      toast.error(err?.message || 'Download failed — please try again')
    } finally {
      setGenerating(null)
    }
  }

  async function copyAllReferences() {
    const text = refSources
      .map((s, i) => `${s.citation_number || i + 1}. ${s.vancouver_citation || (s.title ? `${s.title}. ${s.url || ''}` : s.url || '')}`)
      .join('\n')
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopiedRef(true)
    setTimeout(() => setCopiedRef(false), 2000)
    toast.success('References copied to clipboard')
  }

  // Progress percentage for the live bar
  const TOTAL_STEPS = 7
  const completedSteps = traces.filter(t => t.step_status === 'completed').length
  const progressPct = reqStatus === 'completed' ? 100 : Math.min(90, Math.round((completedSteps / TOTAL_STEPS) * 100))

  return (
    <div className="min-h-screen bg-clinical-light pb-24">

      {/* ── Nav ── */}
      <div className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/content')} className="text-navy-800/40 hover:text-navy-800 transition-colors p-1 -ml-1">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={22} height={22} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-navy-800 truncate">{request.topic}</div>
            <div className="text-2xs text-navy-800/40">{ct?.icon} {ct?.label}</div>
          </div>
          {/* Status badge */}
          {reqStatus === 'completed' && (
            <div className="flex items-center gap-1.5 text-2xs text-forest-700 bg-forest-50 border border-forest-200/60 px-2 py-1 rounded-full flex-shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-forest-600"/>
              Ready
            </div>
          )}
          {isProcessing(reqStatus) && (
            <div className="flex items-center gap-1.5 text-2xs text-blue-700 bg-blue-50 border border-blue-200/60 px-2 py-1 rounded-full flex-shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"/>
              Processing
            </div>
          )}
        </div>

        {/* Progress bar (during processing) */}
        {isProcessing(reqStatus) && (
          <div className="h-0.5 bg-navy-800/8">
            <div className="h-full bg-navy-800 transition-all duration-1000 ease-out" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </div>

      <main className="px-4 py-4 space-y-3 max-w-2xl mx-auto">

        {/* ── Evidence quality banner (when completed) ── */}
        {reqStatus === 'completed' && tier1Used.length > 0 && (
          <div className="bg-white border border-navy-800/8 rounded-2xl px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-forest-700 bg-forest-50 border border-forest-200/60 px-2.5 py-1 rounded-full">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {tier1Used.length} peer-reviewed sources
              </div>
              {tier2Sections.length > 0 && (
                <div className="flex items-center gap-1 text-2xs text-blue-600 bg-blue-50 border border-blue-200/60 px-2 py-1 rounded-full">
                  ◆ {tier2Sections.length} emerging
                </div>
              )}
              <div className="flex items-center gap-1 text-2xs text-navy-800/50 bg-navy-50 px-2 py-1 rounded-full">
                {tier1Sections.length} sections
              </div>
              {canDownload && (
                <button onClick={() => setActiveTab('download')}
                  className="ml-auto flex items-center gap-1 text-2xs font-medium text-navy-800 bg-navy-100 hover:bg-navy-200 px-2.5 py-1 rounded-full transition-colors">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v7M2 6l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Download
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Tab nav ── */}
        <div className="bg-white border border-navy-800/8 rounded-xl overflow-x-auto">
          <div className="flex min-w-max">
            {([
              { key: 'progress',    label: 'Research',                 icon: '🔬' },
              { key: 'content',     label: `Content (${tier1Sections.length})`, icon: '📄' },
              { key: 'sources',     label: `Sources (${usedSources.length})`, icon: '📚' },
              { key: 'references',  label: `Refs (${refSources.length})`, icon: '🔗' },
              { key: 'download',    label: 'Download',                 icon: '⬇️' },
            ] as { key: typeof activeTab; label: string; icon: string }[]).map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`flex-shrink-0 px-3 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1
                  ${activeTab === t.key ? 'text-navy-800 border-navy-800' : 'text-navy-800/40 border-transparent hover:text-navy-800/65'}`}>
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════
            RESEARCH PROGRESS TAB
        ══════════════════════════════════════════ */}
        {activeTab === 'progress' && (
          <div className="bg-white border border-navy-800/8 rounded-2xl overflow-hidden">
            {traces.length === 0 && isProcessing(reqStatus) && (
              <div className="text-center py-10 px-6">
                {elapsedSec < 90 ? (
                  <>
                    <div className="w-8 h-8 border-2 border-navy-800/15 border-t-navy-800 rounded-full animate-spin mx-auto mb-3"/>
                    <div className="text-sm text-navy-800/60 font-medium">Starting research agent…</div>
                    <div className="text-xs text-navy-800/30 mt-1">Searching PubMed, ACC, ESC, NEJM</div>
                    <div className="text-2xs text-navy-800/25 mt-2">{elapsedSec}s elapsed · usually starts within 15s</div>
                  </>
                ) : (
                  <>
                    <div className="text-3xl mb-3">⚠️</div>
                    <div className="text-sm font-semibold text-navy-800 mb-1">Research is taking longer than expected</div>
                    <div className="text-xs text-navy-800/50 leading-relaxed mb-4 max-w-xs mx-auto">
                      The pipeline may have timed out. This can happen with complex topics on the first run. Please go back and try again — it often succeeds on the second attempt.
                    </div>
                    <button onClick={() => router.push('/content')}
                      className="bg-navy-800 text-white text-sm font-medium px-5 py-2.5 rounded-xl hover:bg-navy-900 transition-colors active:scale-95">
                      Go back and retry
                    </button>
                  </>
                )}
              </div>
            )}

            {traces.map((trace, idx) => (
              <div key={`${trace.step_number}-${idx}`}
                className={`flex items-start gap-3 px-4 py-3.5 ${idx < traces.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-medium
                  ${trace.step_status === 'completed' ? 'bg-forest-700 text-white' :
                    trace.step_status === 'running'   ? 'bg-blue-100 border-2 border-blue-400' :
                    trace.step_status === 'failed'    ? 'bg-red-100 border border-red-300 text-red-500' :
                    'bg-navy-800/8 text-navy-800/30'}`}>
                  {trace.step_status === 'completed' ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : trace.step_status === 'running' ? (
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"/>
                  ) : trace.step_status === 'failed' ? '✗' : (
                    <span className="text-2xs">{trace.step_number}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${
                    trace.step_status === 'completed' ? 'text-navy-800' :
                    trace.step_status === 'running'   ? 'text-blue-700' :
                    trace.step_status === 'failed'    ? 'text-red-600' : 'text-navy-800/35'}`}>
                    {trace.step_label}
                  </div>
                  {trace.detail && (
                    <div className="text-xs text-navy-800/40 mt-0.5 leading-snug">{trace.detail}</div>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  {trace.duration_ms ? (
                    <span className="text-2xs text-navy-800/30">{(trace.duration_ms / 1000).toFixed(1)}s</span>
                  ) : trace.step_status === 'running' ? (
                    <div className="w-3 h-3 border border-blue-400/50 border-t-blue-500 rounded-full animate-spin"/>
                  ) : null}
                </div>
              </div>
            ))}

            {reqStatus === 'failed' && (
              <div className="m-4 bg-red-50 border border-red-200/60 rounded-xl p-4 text-center">
                <div className="text-sm font-semibold text-red-700 mb-1">Research failed</div>
                <div className="text-xs text-red-600/70 mb-3 leading-relaxed">
                  {errorMsg || 'The research pipeline encountered an error. Please retry — it usually succeeds on the second attempt.'}
                </div>
                <div className="flex gap-2 justify-center">
                  <button onClick={() => router.push('/content')} className="text-sm text-navy-800 font-medium border border-navy-800/15 px-4 py-2 rounded-xl hover:bg-navy-50 transition-colors">
                    Try a different topic
                  </button>
                  <button
                    disabled={retrying}
                    onClick={async () => {
                      setRetrying(true)
                      setErrorMsg('')
                      setTraces([])
                      const r = await retryContentRequestAction(request.id)
                      if (!r.ok) {
                        toast.error(r.error || 'Could not retry — please try again')
                        setRetrying(false)
                      } else {
                        setReqStatus('queued')
                        setRetrying(false)
                      }
                    }}
                    className="text-sm bg-navy-800 text-white font-medium px-4 py-2 rounded-xl hover:bg-navy-900 transition-colors disabled:opacity-50"
                  >
                    {retrying ? 'Retrying…' : 'Retry this topic'}
                  </button>
                </div>
              </div>
            )}

            {reqStatus === 'completed' && (
              <div className="m-4 bg-forest-50 border border-forest-200/60 rounded-xl p-4">
                <div className="text-sm font-semibold text-forest-800 mb-1">✓ Research complete</div>
                <div className="text-xs text-navy-800/55 leading-relaxed">
                  {request.tier1_sources_used || 0} Tier 1 peer-reviewed sources used ·{' '}
                  {tier1Sections.length} sections generated
                  {(request.tier2_sources_found || 0) > 0 && ` · ${request.tier2_sources_found} emerging sources found`}
                  {(request.sections_deleted || 0) > 0 && ` · ${request.sections_deleted} sections removed (no evidence)`}
                </div>
                <button onClick={() => setActiveTab('content')}
                  className="mt-2.5 text-xs font-semibold text-navy-800 hover:underline">
                  View content →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════
            CONTENT TAB
        ══════════════════════════════════════════ */}
        {activeTab === 'content' && (
          <div className="space-y-3">

            {/* Patient education review gate */}
            {request.content_type === 'patient_education' && request.requires_specialist_review && !request.specialist_reviewed && (
              <div className="bg-amber-50 border border-amber-300/70 rounded-2xl p-5">
                <div className="text-2xs font-semibold text-amber-700/70 uppercase tracking-wider mb-2">Mandatory Clinical Review Required</div>
                <p className="text-sm text-amber-900 leading-relaxed mb-3">
                  Patient education content must be reviewed by you before it can be downloaded or shared with patients. Please read all sections below carefully.
                </p>
                <button onClick={() => startTransition(async () => {
                  const r = await approvePatientEducationAction(request.id)
                  if (!r.ok) toast.error(r.error)
                  else { toast.success('Approved — content is now downloadable'); router.refresh() }
                })} disabled={isPending}
                  className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 active:scale-99">
                  {isPending ? 'Confirming...' : 'I have reviewed — approve for download'}
                </button>
              </div>
            )}

            {/* Tier 2 toggle */}
            {tier2Sections.length > 0 && (
              <div className="flex items-center justify-between bg-white border border-navy-800/8 rounded-xl px-4 py-2.5">
                <div className="text-xs text-navy-800/60">Show emerging (pre-publication) sections</div>
                <button onClick={() => setShowTier2(!showTier2)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${showTier2 ? 'bg-navy-800' : 'bg-navy-800/15'}`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-transform ${showTier2 ? 'translate-x-5' : 'translate-x-0.5'}`}/>
                </button>
              </div>
            )}

            {/* No sections state */}
            {tier1Sections.length === 0 && reqStatus === 'completed' && (
              <div className="bg-white border border-navy-800/8 rounded-2xl text-center py-10 px-6">
                <div className="text-2xl mb-3">🔬</div>
                <p className="text-sm font-medium text-navy-800 mb-1">No sections generated</p>
                <p className="text-xs text-navy-800/45 leading-relaxed max-w-xs mx-auto">
                  Insufficient peer-reviewed evidence was found for this topic. Try a more specific clinical topic, or check the Sources tab for what was found.
                </p>
              </div>
            )}

            {/* Tier 1 sections */}
            {tier1Sections.map(section => {
              const ecfg    = EVIDENCE_CONFIG[section.evidence_level] || EVIDENCE_CONFIG.moderate
              const rawText = editingId === section.id ? editText : (section.edited_text || section.content_text)
              const blocks  = parseContent(rawText)
              const isEdit  = editingId === section.id

              return (
                <div key={section.id} className={`bg-white border rounded-2xl overflow-hidden ${ecfg.border}`}>
                  {/* Section header */}
                  <div className={`px-4 py-3 border-b ${ecfg.border} ${ecfg.bg} flex items-start justify-between gap-2`}>
                    <div>
                      <div className="text-sm font-semibold text-navy-800 leading-snug">{section.section_title}</div>
                      <div className={`text-2xs font-medium mt-0.5 ${ecfg.text}`}>{ecfg.label}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {section.speaker_notes && (
                        <button onClick={() => setShowNotes(showNotes === section.id ? null : section.id)}
                          className="text-2xs text-navy-800/40 hover:text-navy-800/70 border border-navy-800/12 px-2 py-0.5 rounded-lg transition-colors">
                          Notes
                        </button>
                      )}
                      {!isEdit && reqStatus === 'completed' && (
                        <button onClick={() => { setEditingId(section.id); setEditText(section.edited_text || section.content_text) }}
                          className="text-2xs text-navy-800/40 hover:text-navy-800/70 border border-navy-800/12 px-2 py-0.5 rounded-lg transition-colors">
                          Edit
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Section content */}
                  <div className="px-4 py-4">
                    {isEdit ? (
                      <div className="space-y-2">
                        <textarea value={editText} onChange={e => setEditText(e.target.value)}
                          rows={Math.max(5, editText.split('\n').length + 2)}
                          className="w-full border border-navy-800/15 rounded-xl px-3.5 py-3 text-sm text-navy-800 focus:outline-none focus:border-navy-800/35 resize-none bg-white"/>
                        <div className="flex gap-2">
                          <button onClick={saveEdit} disabled={isPending}
                            className="bg-navy-800 text-white text-xs font-medium py-2 px-4 rounded-xl hover:bg-navy-900 transition-colors disabled:opacity-40">
                            {isPending ? 'Saving...' : 'Save changes'}
                          </button>
                          <button onClick={() => setEditingId(null)}
                            className="text-xs text-navy-800/60 border border-navy-800/15 py-2 px-4 rounded-xl hover:border-navy-800/30 transition-colors">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {blocks.map((block, bi) => (
                          block.type === 'heading' ? (
                            <p key={bi} className="text-sm font-semibold text-navy-800 mt-1">{block.text}</p>
                          ) : block.type === 'bullet' ? (
                            <div key={bi} className="flex items-start gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-navy-800/40 flex-shrink-0 mt-1.5"/>
                              <p className="text-sm text-navy-800/80 leading-relaxed">{block.text}</p>
                            </div>
                          ) : (
                            <p key={bi} className="text-sm text-navy-800/80 leading-relaxed">{block.text}</p>
                          )
                        ))}
                      </div>
                    )}

                    {/* Evidence summary */}
                    {!isEdit && section.evidence_summary && (
                      <div className="mt-3 pt-3 border-t border-navy-800/6 flex items-start gap-1.5">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-navy-800/30 mt-0.5 flex-shrink-0">
                          <path d="M5 1a4 4 0 100 8A4 4 0 005 1zm0 2v3M5 7.5h.01" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                        </svg>
                        <p className="text-2xs text-navy-800/45 italic leading-relaxed">{section.evidence_summary}</p>
                      </div>
                    )}

                    {/* Speaker notes */}
                    {!isEdit && showNotes === section.id && section.speaker_notes && (
                      <div className="mt-3 bg-navy-50 rounded-xl px-3 py-2.5">
                        <div className="text-2xs font-semibold text-navy-800/50 uppercase tracking-wider mb-1">Speaker notes</div>
                        <p className="text-xs text-navy-800/65 leading-relaxed">{section.speaker_notes}</p>
                      </div>
                    )}

                    {/* Edited indicator */}
                    {!isEdit && section.is_edited && (
                      <div className="mt-2 flex items-center gap-1 text-2xs text-amber-600">
                        <div className="w-1 h-1 rounded-full bg-amber-500"/>
                        Edited by you
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Tier 2 sections */}
            {showTier2 && tier2Sections.length > 0 && (
              <div className="border-2 border-blue-200/70 rounded-2xl overflow-hidden">
                <div className="bg-blue-900 px-4 py-3">
                  <div className="text-sm font-semibold text-white">◆ Emerging Evidence</div>
                  <div className="text-xs text-blue-300/80 mt-0.5">Pre-publication data — not yet peer-reviewed. Interpret with caution.</div>
                </div>
                {tier2Sections.map((section, idx) => (
                  <div key={section.id} className={`px-4 py-4 bg-blue-50/40 ${idx < tier2Sections.length - 1 ? 'border-b border-blue-200/60' : ''}`}>
                    <div className="text-sm font-semibold text-blue-900 mb-2">{section.section_title}</div>
                    <div className="space-y-1.5">
                      {parseContent(section.content_text).map((block, bi) => (
                        block.type === 'bullet' ? (
                          <div key={bi} className="flex items-start gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0 mt-1.5"/>
                            <p className="text-sm text-navy-800/70 leading-relaxed">{block.text}</p>
                          </div>
                        ) : (
                          <p key={bi} className="text-sm text-navy-800/70 leading-relaxed">{block.text}</p>
                        )
                      ))}
                    </div>
                    {section.evidence_summary && (
                      <p className="mt-2 text-2xs text-navy-800/40 italic">{section.evidence_summary}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════
            SOURCES TAB
        ══════════════════════════════════════════ */}
        {activeTab === 'sources' && (
          <div className="space-y-3">
            {/* Summary */}
            <div className="bg-white border border-navy-800/8 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-xs text-navy-800/60">
                  <span className="font-semibold text-forest-700">{usedSources.length}</span> sources used in content
                </div>
                {excldSources.length > 0 && (
                  <div className="text-xs text-navy-800/40">
                    <span className="font-medium">{excldSources.length}</span> reviewed but excluded (below credibility threshold)
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className="text-2xs text-navy-800/35">Credibility score:</span>
                {[5,4,3].map(score => {
                  const c = usedSources.filter(s => Math.round(s.credibility_score || 0) === score).length
                  if (!c) return null
                  const cs = credScore(score)
                  return (
                    <span key={score} className={`text-2xs px-1.5 py-0.5 rounded font-medium ${cs.bg} ${cs.text}`}>
                      {score}/5 → {c}
                    </span>
                  )
                })}
              </div>
            </div>

            {/* Used sources */}
            {usedSources.length > 0 ? (
              <div className="bg-white border border-navy-800/8 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-navy-800/6 bg-navy-50/40">
                  <div className="text-2xs font-semibold text-navy-800/50 uppercase tracking-wider">Used in content — all cited</div>
                </div>
                {usedSources.map((src, idx) => {
                  const cs = credScore(src.credibility_score)
                  const hasLink = src.url && src.url.startsWith('http')
                  const Wrapper = hasLink ? 'a' : 'div'
                  return (
                    <Wrapper key={src.id}
                      {...(hasLink ? { href: src.url!, target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className={`flex items-start gap-3 px-4 py-3.5 transition-colors
                        ${hasLink ? 'hover:bg-navy-50/60 cursor-pointer' : ''}
                        ${idx < usedSources.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                      {/* Credibility score badge */}
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold ${cs.bg} ${cs.text}`}>
                        {src.credibility_score ?? '—'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-navy-800 leading-snug">{src.title || src.url || 'Untitled source'}</div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          {src.source_type && (
                            <span className="text-2xs text-navy-800/40 bg-navy-50 px-1.5 py-0.5 rounded-full">
                              {TIER1_LABEL[src.source_type] || src.source_type.replace(/_/g, ' ')}
                            </span>
                          )}
                          {src.institution && (
                            <span className="text-2xs text-navy-800/35">{src.institution}</span>
                          )}
                          {src.evidence_tier === 'tier2' && (
                            <span className="text-2xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">Emerging</span>
                          )}
                          {src.citation_number && (
                            <span className="text-2xs text-navy-800/30">Ref [{src.citation_number}]</span>
                          )}
                        </div>
                      </div>
                      {hasLink && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-navy-800/20 flex-shrink-0 mt-1">
                          <path d="M2 2h8M6 2v8M2 10l8-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                        </svg>
                      )}
                    </Wrapper>
                  )
                })}
              </div>
            ) : reqStatus === 'completed' ? (
              <div className="bg-white border border-navy-800/8 rounded-2xl text-center py-8">
                <div className="text-sm text-navy-800/45">No source data available for this content.</div>
              </div>
            ) : (
              <div className="bg-white border border-navy-800/8 rounded-2xl text-center py-8">
                <div className="text-sm text-navy-800/45">Sources will appear after research completes.</div>
              </div>
            )}

            {/* Excluded sources */}
            {excldSources.length > 0 && (
              <details className="bg-white border border-navy-800/8 rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 text-xs text-navy-800/45 cursor-pointer hover:text-navy-800/65 transition-colors flex items-center gap-2">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  {excldSources.length} sources reviewed but excluded
                </summary>
                <div className="border-t border-navy-800/6">
                  {excldSources.slice(0, 10).map((src, idx) => (
                    <div key={src.id}
                      className={`flex items-start gap-3 px-4 py-3 opacity-55 ${idx < Math.min(excldSources.length, 10) - 1 ? 'border-b border-navy-800/5' : ''}`}>
                      <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 text-2xs text-gray-400 font-medium">
                        {src.credibility_score ?? '—'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-navy-800/60 leading-snug truncate">{src.title || src.url || 'Unknown'}</div>
                        <div className="text-2xs text-navy-800/35 mt-0.5">{src.excluded_reason?.replace(/_/g, ' ')}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════
            REFERENCES TAB
        ══════════════════════════════════════════ */}
        {activeTab === 'references' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="bg-navy-50 rounded-xl px-4 py-2.5 flex-1 mr-2">
                <p className="text-xs text-navy-800/60">
                  {refSources.length > 0
                    ? `${refSources.length} references in Vancouver format — cite these when sharing content`
                    : 'References will appear after content generation'}
                </p>
              </div>
              {refSources.length > 0 && (
                <button onClick={copyAllReferences}
                  className="flex items-center gap-1.5 text-xs font-medium text-navy-800 border border-navy-800/15 px-3 py-2.5 rounded-xl hover:bg-navy-50 transition-colors flex-shrink-0">
                  {copiedRef ? (
                    <><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg> Copied</>
                  ) : (
                    <><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/><path d="M2 9V2h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> Copy all</>
                  )}
                </button>
              )}
            </div>

            {refSources.length > 0 ? (
              <div className="space-y-2">
                {refSources.map((src, idx) => (
                  <div key={src.id} className="bg-white border border-navy-800/8 rounded-xl px-4 py-3">
                    <div className="flex gap-2.5">
                      <span className="text-xs font-semibold text-navy-800/40 flex-shrink-0 w-5 text-right mt-0.5">
                        {src.citation_number || idx + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        {src.vancouver_citation ? (
                          <p className="text-xs text-navy-800/70 leading-relaxed">{src.vancouver_citation}</p>
                        ) : (
                          <p className="text-xs text-navy-800/70 leading-relaxed">
                            {src.title && <span className="font-medium">{src.title}. </span>}
                            {src.institution && <span className="italic">{src.institution}. </span>}
                            {src.url && (
                              <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-navy-800/50 underline break-all hover:text-navy-800 transition-colors">
                                {src.url}
                              </a>
                            )}
                          </p>
                        )}
                        {src.url && src.url.startsWith('http') && (
                          <a href={src.url} target="_blank" rel="noopener noreferrer"
                            className="text-2xs text-forest-700 hover:underline mt-1 inline-flex items-center gap-1">
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1h6M4 1v6M1 7l6-6" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
                            Open source
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white border border-navy-800/8 rounded-2xl text-center py-10">
                <div className="text-2xl mb-2">📚</div>
                <p className="text-sm text-navy-800/45">References appear here once content is generated.</p>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════
            DOWNLOAD TAB
        ══════════════════════════════════════════ */}
        {activeTab === 'download' && (
          <div className="space-y-3">

            {/* Patient review gate */}
            {request.requires_specialist_review && !request.specialist_reviewed && (
              <div className="bg-amber-50 border border-amber-200/70 rounded-2xl p-4">
                <div className="text-sm font-semibold text-amber-900 mb-1">⚠️ Review required before download</div>
                <p className="text-xs text-amber-700/70 leading-relaxed mb-3">
                  You must review and approve this patient education content before it can be downloaded.
                </p>
                <button onClick={() => setActiveTab('content')}
                  className="text-xs font-medium text-amber-800 border border-amber-400/50 px-4 py-2 rounded-xl hover:bg-amber-100 transition-colors">
                  Go to content → review & approve
                </button>
              </div>
            )}

            {/* Not ready yet */}
            {!canDownload && !request.requires_specialist_review && (
              <div className="bg-white border border-navy-800/8 rounded-2xl text-center py-10">
                <div className="text-2xl mb-2">{isProcessing(reqStatus) ? '⏳' : '❌'}</div>
                <p className="text-sm text-navy-800/50">
                  {isProcessing(reqStatus) ? 'Content is still generating — check back in a moment.' : 'Content generation failed. Cannot download.'}
                </p>
              </div>
            )}

            {/* Download options */}
            {canDownload && (
              <>
                {/* Tier 2 toggle */}
                {tier2Sections.length > 0 && (
                  <div className="bg-white border border-navy-800/8 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-navy-800">Include emerging evidence sections</div>
                      <div className="text-2xs text-navy-800/40 mt-0.5">Pre-publication data. Shown as clearly labelled "emerging".</div>
                    </div>
                    <button onClick={() => setShowTier2(!showTier2)}
                      className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ml-3 ${showTier2 ? 'bg-navy-800' : 'bg-navy-800/15'}`}>
                      <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-transform ${showTier2 ? 'translate-x-5' : 'translate-x-0.5'}`}/>
                    </button>
                  </div>
                )}

                {/* Download buttons */}
                <div className="bg-white border border-navy-800/8 rounded-2xl p-4 space-y-3">
                  <div className="text-2xs font-semibold text-navy-800/40 uppercase tracking-wider">Choose format</div>

                  {isPptxType && (
                    <button onClick={() => handleDownload('pptx')} disabled={!!generating || isPending}
                      className="w-full flex items-center gap-3 bg-navy-800 hover:bg-navy-900 text-white px-4 py-3.5 rounded-xl transition-all disabled:opacity-50 active:scale-99">
                      <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center flex-shrink-0 text-lg">
                        {generating === 'pptx' ? (
                          <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                        ) : '📊'}
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-semibold">{generating === 'pptx' ? 'Generating...' : 'Download PPTX'}</div>
                        <div className="text-xs text-white/60">PowerPoint presentation with speaker notes</div>
                      </div>
                      {outputs.find(o => o.format === 'pptx') && (
                        <div className="text-2xs text-white/50 flex-shrink-0">
                          {outputs.find(o => o.format === 'pptx')?.file_size_kb}KB
                        </div>
                      )}
                    </button>
                  )}

                  <button onClick={() => handleDownload('docx')} disabled={!!generating || isPending}
                    className="w-full flex items-center gap-3 bg-forest-700 hover:bg-forest-800 text-white px-4 py-3.5 rounded-xl transition-all disabled:opacity-50 active:scale-99">
                    <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center flex-shrink-0 text-lg">
                      {generating === 'docx' ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                      ) : '📄'}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="text-sm font-semibold">{generating === 'docx' ? 'Generating...' : 'Download DOCX'}</div>
                      <div className="text-xs text-white/60">Word document with full references</div>
                    </div>
                    {outputs.find(o => o.format === 'docx') && (
                      <div className="text-2xs text-white/50 flex-shrink-0">
                        {outputs.find(o => o.format === 'docx')?.file_size_kb}KB
                      </div>
                    )}
                  </button>

                  <div className="text-2xs text-navy-800/35 text-center leading-relaxed pt-1">
                    Generated fresh from your content · Includes all citations and references
                  </div>
                </div>

                {/* Credibility summary for download */}
                <div className="bg-forest-50 border border-forest-200/60 rounded-xl px-4 py-3">
                  <div className="text-xs font-semibold text-forest-800 mb-2">What makes this content credible</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-forest-700/70">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      {tier1Used.length} peer-reviewed sources verified before inclusion
                    </div>
                    {excldSources.length > 0 && (
                      <div className="flex items-center gap-2 text-xs text-forest-700/70">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        {excldSources.length} low-credibility sources automatically excluded
                      </div>
                    )}
                    {(request.sections_deleted || 0) > 0 && (
                      <div className="flex items-center gap-2 text-xs text-forest-700/70">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        {request.sections_deleted} unsupported sections removed before output
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-forest-700/70">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      All references in Vancouver citation format
                    </div>
                  </div>
                </div>

                {/* Download history */}
                {outputs.length > 0 && (
                  <div className="bg-white border border-navy-800/8 rounded-xl px-4 py-3">
                    <div className="text-2xs font-semibold text-navy-800/40 uppercase tracking-wider mb-2">Download history</div>
                    <div className="space-y-1.5">
                      {outputs.map(o => (
                        <div key={o.id} className="flex items-center gap-2">
                          <span className={`text-2xs font-medium px-1.5 py-0.5 rounded ${o.format === 'pptx' ? 'bg-navy-100 text-navy-700' : 'bg-forest-100 text-forest-700'}`}>
                            {o.format.toUpperCase()}
                          </span>
                          <span className="text-2xs text-navy-800/45">{o.file_size_kb}KB</span>
                          <span className="text-2xs text-navy-800/30">{timeAgo(o.generated_at)}</span>
                          {o.file_url && (
                            <a href={o.file_url} target="_blank" rel="noopener noreferrer"
                              className="ml-auto text-2xs text-navy-800/50 hover:text-navy-800 underline transition-colors">
                              Re-download
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
