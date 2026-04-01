'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  editSectionAction,
  approvePatientEducationAction,
  generateFileAction,
} from '@/app/actions/content'

type Section = {
  id: string; section_title: string; section_type: string; content_text: string
  speaker_notes: string; evidence_level: string; evidence_tier: string
  evidence_summary: string; is_tier2_section: boolean; sort_order: number
  is_edited: boolean; edited_text: string | null
}
type Source  = { id: string; url: string; title: string; credibility_score: number; evidence_tier: string; source_type: string; institution: string | null; used_in_output: boolean; excluded_reason: string | null; vancouver_citation: string | null; citation_number: number | null }
type Trace   = { step_number: number; step_name: string; step_label: string; step_status: string; detail: string | null; duration_ms: number | null }
type Output  = { id: string; format: string; file_url: string | null; file_size_kb: number | null; include_tier2: boolean; generated_at: string }

const EVIDENCE_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  strong:   { label: '● Strong Evidence',         dot: 'bg-forest-600',   bg: 'bg-forest-50/60', text: 'text-forest-700' },
  moderate: { label: '● Moderate Evidence',        dot: 'bg-amber-500',    bg: 'bg-amber-50/60',  text: 'text-amber-700' },
  guideline:{ label: '■ Guideline Recommendation', dot: 'bg-navy-700',     bg: 'bg-navy-50',      text: 'text-navy-800' },
  emerging: { label: '◆ Emerging Evidence',        dot: 'bg-blue-600',     bg: 'bg-blue-50',      text: 'text-blue-700' },
}

const STEP_ICONS: Record<string, string> = {
  topic_decomposition: '🧠', tier1_search: '🔍', tier2_search: '🔬',
  credibility_scoring: '⚖️', content_extraction: '📖', content_structuring: '✍️',
  file_generation: '📄', completed: '✓',
}

function isProcessing(status: string) {
  return !['completed', 'failed'].includes(status)
}

export default function ContentDetailClient({ request, traces: initialTraces, specialist }: {
  request: any; traces: Trace[]; specialist: any
}) {
  const router   = useRouter()
  const [isPending, startTransition] = useTransition()

  const [traces,     setTraces]     = useState<Trace[]>(initialTraces)
  const [reqStatus,  setReqStatus]  = useState(request.status)
  const [summary,    setSummary]    = useState<any>(null)
  const [activeTab,  setActiveTab]  = useState<'progress'|'content'|'sources'|'references'>('progress')
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [editText,   setEditText]   = useState('')
  const [showTier2,  setShowTier2]  = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)

  const sections = ((request.content_sections || []) as Section[])
    .sort((a, b) => a.sort_order - b.sort_order)
  const sources  = (request.content_sources  || []) as Source[]
  const outputs  = (request.content_outputs  || []) as Output[]

  const tier1Sections = sections.filter(s => !s.is_tier2_section)
  const tier2Sections = sections.filter(s => s.is_tier2_section)
  const usedSources   = sources.filter(s => s.used_in_output && s.evidence_tier === 'tier1')
  const excldSources  = sources.filter(s => !s.used_in_output)

  // Poll for progress while processing
  const pollProgress = useCallback(async () => {
    if (!isProcessing(reqStatus)) return
    try {
      const lastStep = traces.length > 0 ? Math.max(...traces.map(t => t.step_number)) : 0
      const res  = await fetch(`/api/content?requestId=${request.id}&after=${lastStep}`)
      const data = await res.json()
      if (data.traces?.length > 0) setTraces(prev => [...prev, ...data.traces])
      if (data.status) setReqStatus(data.status)
      if (data.summary) setSummary(data.summary)
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

  // Auto-switch to content tab when done
  useEffect(() => {
    if (reqStatus === 'completed' && activeTab === 'progress' && sections.length > 0) {
      setActiveTab('content')
    }
  }, [reqStatus, sections.length, activeTab])

  async function handleEdit(section: Section) {
    setEditingId(section.id)
    setEditText(section.edited_text || section.content_text)
  }

  async function saveEdit() {
    if (!editingId) return
    startTransition(async () => {
      const r = await editSectionAction(editingId, editText)
      if (!r.ok) toast.error(r.error)
      else { toast.success('Section updated'); setEditingId(null); router.refresh() }
    })
  }

  async function handleDownload(format: 'pptx' | 'docx') {
    // Check if already generated
    const existing = outputs.find(o => o.format === format && o.include_tier2 === showTier2)
    if (existing?.file_url) {
      window.open(existing.file_url, '_blank')
      return
    }

    setGenerating(format)
    startTransition(async () => {
      const r = await generateFileAction(request.id, format, showTier2)
      setGenerating(null)
      if (!r.ok) { toast.error(r.error || 'File generation failed'); return }
      toast.success(`${format.toUpperCase()} ready — downloading`)
      window.open(r.value.fileUrl, '_blank')
      router.refresh()
    })
  }

  const isPptxType = ['cme_presentation', 'grand_rounds'].includes(request.content_type)

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/content')} className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-navy-800 truncate">{request.topic}</div>
            <div className="text-2xs text-navy-800/50">{request.content_type.replace(/_/g, ' ')}</div>
          </div>
          {reqStatus === 'completed' && (
            <div className="flex items-center gap-1.5 text-2xs text-forest-700">
              <div className="w-1.5 h-1.5 rounded-full bg-forest-600"/>
              Ready
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* Tab nav */}
        <div className="bg-white rounded-xl border border-navy-800/8 overflow-x-auto">
          <div className="flex">
            {[
              { key: 'progress', label: 'Research progress' },
              { key: 'content',  label: `Content (${tier1Sections.length})` },
              { key: 'sources',  label: `Sources (${usedSources.length})` },
              { key: 'references', label: 'References' },
            ].map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key as any)}
                className={`flex-shrink-0 px-3 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors
                  ${activeTab === t.key ? 'text-navy-800 border-navy-800' : 'text-navy-800/40 border-transparent hover:text-navy-800/70'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* PROGRESS TAB */}
        {activeTab === 'progress' && (
          <div className="card-clinical space-y-1">
            {traces.length === 0 && isProcessing(reqStatus) && (
              <div className="text-center py-6">
                <div className="w-6 h-6 border border-navy-800/20 border-t-navy-800 rounded-full animate-spin mx-auto mb-3"/>
                <div className="text-sm text-navy-800/50">Starting research agent...</div>
              </div>
            )}
            {traces.map((trace, idx) => (
              <div key={`${trace.step_number}-${idx}`}
                className={`flex items-start gap-3 py-2.5 ${idx < traces.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs
                  ${trace.step_status === 'completed' ? 'bg-forest-700 text-white' :
                    trace.step_status === 'running'   ? 'bg-blue-100 border border-blue-300' :
                    trace.step_status === 'failed'    ? 'bg-red-100 border border-red-300' :
                    'bg-gray-100'}`}>
                  {trace.step_status === 'completed' ? '✓' :
                   trace.step_status === 'running'   ? <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"/> :
                   trace.step_status === 'failed'    ? '✗' : '·'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${trace.step_status === 'completed' ? 'text-navy-800' : trace.step_status === 'running' ? 'text-blue-700 font-medium' : 'text-navy-800/50'}`}>
                    {trace.step_label}
                  </div>
                  {trace.detail && (
                    <div className="text-xs text-navy-800/40 mt-0.5 truncate">{trace.detail}</div>
                  )}
                </div>
                {trace.duration_ms && (
                  <span className="text-2xs text-navy-800/30 flex-shrink-0">{(trace.duration_ms / 1000).toFixed(1)}s</span>
                )}
              </div>
            ))}

            {reqStatus === 'failed' && (
              <div className="mt-3 bg-red-50 rounded-xl p-4 text-center">
                <div className="text-sm font-medium text-red-700 mb-2">Research failed</div>
                <div className="text-xs text-red-600/80 mb-3">{request.error_message || 'An error occurred'}</div>
                <button onClick={() => router.push('/content')} className="text-sm text-navy-800 hover:underline">
                  Try a different topic
                </button>
              </div>
            )}

            {reqStatus === 'completed' && (
              <div className="mt-3 bg-forest-50 border border-forest-200/60 rounded-xl p-4">
                <div className="text-sm font-medium text-forest-700 mb-1">✓ Research complete</div>
                <div className="text-xs text-navy-800/60">
                  {summary?.tier1SourcesUsed || request.tier1_sources_used || 0} Tier 1 sources used
                  {(summary?.tier2SourcesFound || request.tier2_sources_found || 0) > 0 &&
                    ` · ${summary?.tier2SourcesFound || request.tier2_sources_found} emerging sources found`}
                  {(summary?.sectionsDeleted || request.sections_deleted || 0) > 0 &&
                    ` · ${summary?.sectionsDeleted || request.sections_deleted} sections deleted (no evidence)`}
                </div>
                <button onClick={() => setActiveTab('content')}
                  className="mt-2 text-xs font-medium text-navy-800 hover:underline">
                  Review content →
                </button>
              </div>
            )}
          </div>
        )}

        {/* CONTENT TAB */}
        {activeTab === 'content' && (
          <div className="space-y-3">

            {/* Patient education review gate */}
            {request.content_type === 'patient_education' && request.requires_specialist_review && !request.specialist_reviewed && (
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5">
                <div className="data-label text-amber-700/70 mb-2">Mandatory review required</div>
                <p className="text-sm text-amber-900 leading-relaxed mb-3">
                  Patient education content must be reviewed by you before it can be downloaded or shared with patients. Please review all sections below.
                </p>
                <button onClick={() => startTransition(async () => {
                  const r = await approvePatientEducationAction(request.id)
                  if (!r.ok) toast.error(r.error)
                  else { toast.success('Reviewed — content is now downloadable'); router.refresh() }
                })} disabled={isPending}
                  className="btn-primary text-sm py-2.5">
                  {isPending ? 'Confirming...' : 'I have reviewed this content — approve for download'}
                </button>
              </div>
            )}

            {/* Download bar */}
            {reqStatus === 'completed' && (
              (!request.requires_specialist_review || request.specialist_reviewed) && (
                <div className="bg-white border border-navy-800/8 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="data-label">Download</div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" checked={showTier2} onChange={e => setShowTier2(e.target.checked)} className="w-3.5 h-3.5"/>
                      <span className="text-navy-800/60">Include emerging evidence</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {isPptxType && (
                      <button onClick={() => handleDownload('pptx')} disabled={generating === 'pptx' || isPending}
                        className="flex items-center justify-center gap-2 bg-navy-800 text-white text-sm font-medium py-3 rounded-xl hover:bg-navy-900 active:scale-95 transition-all disabled:opacity-50">
                        {generating === 'pptx' ? <span className="w-4 h-4 border border-white/30 border-t-white rounded-full animate-spin"/> : '📊'}
                        <span>{generating === 'pptx' ? 'Generating...' : 'Download PPTX'}</span>
                      </button>
                    )}
                    <button onClick={() => handleDownload('docx')} disabled={generating === 'docx' || isPending}
                      className={`flex items-center justify-center gap-2 bg-forest-700 text-white text-sm font-medium py-3 rounded-xl hover:bg-forest-800 active:scale-95 transition-all disabled:opacity-50 ${!isPptxType ? 'col-span-2' : ''}`}>
                      {generating === 'docx' ? <span className="w-4 h-4 border border-white/30 border-t-white rounded-full animate-spin"/> : '📄'}
                      <span>{generating === 'docx' ? 'Generating...' : 'Download DOCX'}</span>
                    </button>
                  </div>
                  {outputs.length > 0 && (
                    <div className="text-xs text-navy-800/40 text-center">
                      Previously generated: {outputs.map(o => `${o.format.toUpperCase()} (${o.file_size_kb}KB)`).join(' · ')}
                    </div>
                  )}
                </div>
              )
            )}

            {/* Sections */}
            {tier1Sections.length === 0 && reqStatus === 'completed' && (
              <div className="card-clinical text-center py-8">
                <p className="text-sm text-navy-800/50 mb-2">No sections generated</p>
                <p className="text-xs text-navy-800/40 leading-relaxed">
                  Insufficient peer-reviewed evidence was found for this topic. Try a more specific topic or check the Sources tab.
                </p>
              </div>
            )}

            {tier1Sections.map(section => {
              const ecfg   = EVIDENCE_CONFIG[section.evidence_level] || EVIDENCE_CONFIG.moderate
              const display = editingId === section.id ? editText : (section.edited_text || section.content_text)
              const isEdit  = editingId === section.id

              return (
                <div key={section.id} className={`card-clinical ${ecfg.bg}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="text-sm font-medium text-navy-800">{section.section_title}</div>
                      <div className={`text-2xs font-medium mt-0.5 ${ecfg.text}`}>{ecfg.label}</div>
                    </div>
                    {!isEdit && reqStatus === 'completed' && (
                      <button onClick={() => handleEdit(section)}
                        className="text-2xs text-navy-800/40 hover:text-navy-800/70 transition-colors flex-shrink-0 border border-navy-800/15 px-2 py-0.5 rounded-lg">
                        Edit
                      </button>
                    )}
                  </div>

                  {isEdit ? (
                    <div className="space-y-2">
                      <textarea value={editText} onChange={e => setEditText(e.target.value)}
                        rows={Math.max(5, editText.split('\n').length + 2)}
                        className="input-clinical resize-none text-sm w-full"/>
                      <div className="flex gap-2">
                        <button onClick={saveEdit} disabled={isPending} className="btn-primary text-xs py-2 px-4">
                          {isPending ? 'Saving...' : 'Save'}
                        </button>
                        <button onClick={() => setEditingId(null)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-navy-800/80 leading-relaxed whitespace-pre-wrap">{display}</p>
                  )}

                  {section.evidence_summary && (
                    <div className="mt-2 text-2xs text-navy-800/40 italic">{section.evidence_summary}</div>
                  )}
                  {section.is_edited && (
                    <div className="mt-1 text-2xs text-amber-600">● Edited</div>
                  )}
                </div>
              )
            })}

            {/* Tier 2 section */}
            {tier2Sections.length > 0 && (
              <div className="border-2 border-blue-200 rounded-2xl overflow-hidden">
                <div className="bg-blue-900 px-4 py-3">
                  <div className="text-sm font-medium text-white">◆ Emerging Evidence</div>
                  <div className="text-xs text-blue-300 mt-0.5">Pre-publication data — not yet peer-reviewed. Interpret with caution.</div>
                </div>
                {tier2Sections.map(section => (
                  <div key={section.id} className="px-4 py-4 bg-blue-50/40 border-t border-blue-200">
                    <div className="text-sm font-medium text-blue-900 mb-1">{section.section_title}</div>
                    <p className="text-sm text-navy-800/70 leading-relaxed whitespace-pre-wrap">{section.content_text}</p>
                    {section.evidence_summary && (
                      <div className="mt-2 text-2xs text-navy-800/40 italic">{section.evidence_summary}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SOURCES TAB */}
        {activeTab === 'sources' && (
          <div className="space-y-2">
            <div className="bg-navy-50 rounded-xl px-4 py-2.5">
              <p className="text-xs text-navy-800/70">
                {usedSources.length} Tier 1 sources used in content
                {excldSources.length > 0 && ` · ${excldSources.length} reviewed but excluded (score below threshold)`}
              </p>
            </div>
            {usedSources.length > 0 && (
              <div className="card-clinical p-0 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-navy-800/5">
                  <div className="data-label">Sources used in this content</div>
                </div>
                {usedSources.map((src, idx) => (
                  <a key={src.id} href={src.url} target="_blank" rel="noopener noreferrer"
                    className={`flex items-start gap-3 px-4 py-3 hover:bg-navy-50/60 transition-colors
                      ${idx < usedSources.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold text-white
                      ${src.credibility_score >= 5 ? 'bg-forest-700' : src.credibility_score >= 4 ? 'bg-forest-600' : 'bg-amber-500'}`}>
                      {src.credibility_score}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-navy-800 leading-tight">{src.title || src.url}</div>
                      <div className="text-2xs text-navy-800/40 mt-0.5">
                        {src.source_type?.replace(/_/g, ' ')}
                        {src.institution && ` · ${src.institution}`}
                      </div>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-navy-800/20 flex-shrink-0 mt-1">
                      <path d="M2 2h10M7 2v10M2 12l10-10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </a>
                ))}
              </div>
            )}
            {excldSources.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-navy-800/40 cursor-pointer px-2 hover:text-navy-800/60 transition-colors">
                  {excldSources.length} sources reviewed but not included (score below threshold)
                </summary>
                <div className="mt-2 card-clinical p-0 overflow-hidden opacity-60">
                  {excldSources.slice(0, 10).map((src, idx) => (
                    <div key={src.id}
                      className={`flex items-start gap-3 px-4 py-3 ${idx < excldSources.slice(0,10).length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                      <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs text-gray-500">
                        {src.credibility_score || '—'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-navy-800/60 truncate">{src.title || src.url}</div>
                        <div className="text-2xs text-navy-800/30">{src.excluded_reason?.replace(/_/g, ' ')}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* REFERENCES TAB */}
        {activeTab === 'references' && (
          <div className="space-y-2">
            <div className="bg-navy-50 rounded-xl px-4 py-2.5">
              <p className="text-xs text-navy-800/70">Vancouver format references. Copy or use in your presentation.</p>
            </div>
            {usedSources.filter(s => s.vancouver_citation).map((src, idx) => (
              <div key={src.id} className="card-clinical">
                <div className="flex gap-3">
                  <span className="text-xs font-medium text-navy-800/40 flex-shrink-0 w-6 text-right">{src.citation_number || idx + 1}.</span>
                  <p className="text-xs text-navy-800/70 leading-relaxed">{src.vancouver_citation}</p>
                </div>
              </div>
            ))}
            {usedSources.filter(s => s.vancouver_citation).length === 0 && (
              <div className="card-clinical text-center py-6">
                <p className="text-sm text-navy-800/50">References will appear here once content is generated.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
