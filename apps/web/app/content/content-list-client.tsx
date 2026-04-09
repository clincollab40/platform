'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createContentRequestAction } from '@/app/actions/content'

type Request = {
  id: string; topic: string; content_type: string; status: string
  sections_generated: number | null; tier1_sources_used: number | null
  tier2_sources_found: number | null; sections_deleted: number | null
  requires_specialist_review: boolean; specialist_reviewed: boolean
  created_at: string; processing_ended_at: string | null
}

type Analytics = {
  total: number; completed: number; inProgress: number; awaiting: number
  thisMonth: number; ytd: number; lastYear: number
  byType: Record<string, number>
  totalTier1Sources: number
}

export const CONTENT_TYPES = [
  {
    value: 'cme_presentation',
    label: 'CME Presentation',
    icon: '📊',
    output: ['PPTX', 'DOCX'],
    desc: 'Slides for a CME talk with speaker notes',
    purpose: 'Conference talks · CME credits · Peer education',
    credibility: 'PubMed RCTs, ACC/ESC guidelines, meta-analyses',
    antiHallucination: 'Every slide cites a real paper. Unsupported claims are removed.',
  },
  {
    value: 'grand_rounds',
    label: 'Grand Rounds',
    icon: '🎓',
    output: ['PPTX', 'DOCX'],
    desc: 'Teaching slides for departmental presentations',
    purpose: 'Departmental teaching · Resident education · Case-based learning',
    credibility: 'NEJM, Lancet, specialty society guidelines',
    antiHallucination: 'Section only published if ≥2 peer-reviewed sources exist.',
  },
  {
    value: 'referral_guide',
    label: 'Referring Doctor Guide',
    icon: '📋',
    output: ['DOCX'],
    desc: 'When and how to refer — for GPs and physicians',
    purpose: 'Network education · Referral growth · GP engagement',
    credibility: 'ICMR, NMC, NABH, international society guidelines',
    antiHallucination: 'Criteria graded by evidence level (A/B/C). No opinion-based guidance.',
  },
  {
    value: 'clinical_protocol',
    label: 'Clinical Protocol',
    icon: '📁',
    output: ['DOCX'],
    desc: 'Department protocol with graded recommendations',
    purpose: 'Standardising care · Joint commission · Quality improvement',
    credibility: 'AHA, ESC, CHEST, ISCCM guidelines + Indian data',
    antiHallucination: 'GRADE evidence labels on every recommendation.',
  },
  {
    value: 'conference_abstract',
    label: 'Conference Abstract',
    icon: '📝',
    output: ['DOCX'],
    desc: 'Structured abstract within word limit for submission',
    purpose: 'CSIVM, CSI, IACTS, cardiology conference submissions',
    credibility: 'Your topic backed by similar published work',
    antiHallucination: 'Background data referenced, not fabricated.',
  },
  {
    value: 'roundtable_points',
    label: 'Roundtable Talking Points',
    icon: '💬',
    output: ['DOCX'],
    desc: 'Evidence landscape for advisory board meetings',
    purpose: 'Industry advisory boards · KOL discussions · Expert panels',
    credibility: 'Comparative study data, real-world evidence, Indian registries',
    antiHallucination: 'All statistics sourced from published datasets.',
  },
  {
    value: 'case_discussion',
    label: 'Case Discussion',
    icon: '🔬',
    output: ['DOCX'],
    desc: 'MDT document with literature evidence for complex cases',
    purpose: 'MDT meetings · Case conferences · Teaching files',
    credibility: 'Case reports, case series, similar published outcomes',
    antiHallucination: 'Literature cited, not generated. Management framed as evidence-based options.',
  },
  {
    value: 'patient_education',
    label: 'Patient Education',
    icon: '👤',
    output: ['DOCX'],
    desc: 'Plain-English material for patients and families',
    purpose: 'Pre-procedure counselling · Discharge education · Family support',
    credibility: 'Patient-facing guidelines, NHI recommendations',
    antiHallucination: 'Requires your review before download. Medical accuracy gatekept by you.',
  },
]

const AUDIENCES = [
  { value: 'specialist_peers',    label: 'Specialist peers',           icon: '🩺' },
  { value: 'junior_doctors',      label: 'Junior doctors & residents', icon: '📚' },
  { value: 'referring_physicians',label: 'GPs & referring physicians', icon: '🏥' },
  { value: 'patients_families',   label: 'Patients and families',      icon: '👨‍👩‍👧' },
  { value: 'administrators',      label: 'Hospital administrators',    icon: '🏛️' },
]

const STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  queued:      { label: 'Queued',        dot: 'bg-gray-400',                bg: 'bg-gray-50',    text: 'text-gray-500' },
  decomposing: { label: 'Researching',   dot: 'bg-navy-500 animate-pulse',  bg: 'bg-blue-50',    text: 'text-blue-700' },
  searching:   { label: 'Searching',     dot: 'bg-blue-500 animate-pulse',  bg: 'bg-blue-50',    text: 'text-blue-700' },
  scoring:     { label: 'Scoring',       dot: 'bg-blue-400 animate-pulse',  bg: 'bg-blue-50',    text: 'text-blue-700' },
  extracting:  { label: 'Extracting',    dot: 'bg-teal-500 animate-pulse',  bg: 'bg-teal-50',    text: 'text-teal-700' },
  structuring: { label: 'Writing',       dot: 'bg-forest-500 animate-pulse',bg: 'bg-forest-50',  text: 'text-forest-700' },
  generating:  { label: 'Finalising',    dot: 'bg-forest-400 animate-pulse',bg: 'bg-forest-50',  text: 'text-forest-700' },
  completed:   { label: 'Ready',         dot: 'bg-forest-700',              bg: 'bg-forest-50',  text: 'text-forest-700' },
  failed:      { label: 'Failed',        dot: 'bg-red-500',                 bg: 'bg-red-50',     text: 'text-red-600' },
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

export default function ContentListClient({ specialist, requests, analytics }: {
  specialist: { id: string; name: string; specialty: string }
  requests: Request[]
  analytics: Analytics
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [showNew,      setShowNew]      = useState(false)
  const [showCapPanel, setShowCapPanel] = useState(analytics.total === 0)
  const [step,         setStep]         = useState(1)
  const [selectedType, setSelectedType] = useState('')
  const [topic,        setTopic]        = useState('')
  const [audience,     setAudience]     = useState('specialist_peers')
  const [depth,        setDepth]        = useState('standard')
  const [instructions, setInstructions] = useState('')
  const [typeFilter,   setTypeFilter]   = useState('all')
  const [timePeriod,   setTimePeriod]   = useState<'month'|'ytd'|'all'>('month')

  const displayed = typeFilter === 'all' ? requests
    : typeFilter === 'active' ? requests.filter(r => !['completed','failed'].includes(r.status))
    : typeFilter === 'review' ? requests.filter(r => r.requires_specialist_review && !r.specialist_reviewed)
    : requests.filter(r => r.content_type === typeFilter)

  function resetForm() {
    setStep(1); setSelectedType(''); setTopic('')
    setAudience('specialist_peers'); setDepth('standard'); setInstructions('')
  }

  async function handleSubmit() {
    if (!topic.trim() || !selectedType) return
    const fd = new FormData()
    fd.set('topic', topic)
    fd.set('content_type', selectedType)
    fd.set('audience', audience)
    fd.set('depth', depth)
    if (instructions) fd.set('special_instructions', instructions)

    startTransition(async () => {
      const r = await createContentRequestAction(fd)
      if (!r.ok) { toast.error(r.error); return }
      toast.success('Research started — tracking progress now')
      setShowNew(false)
      resetForm()
      router.push(`/content/${r.value.requestId}`)
    })
  }

  const selectedTypeMeta = CONTENT_TYPES.find(t => t.value === selectedType)

  const topTypesByCount = Object.entries(analytics.byType)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  return (
    <div className="min-h-screen bg-clinical-light pb-20">

      {/* ── Non-sticky nav (AppLayout has sticky top nav) ── */}
      <div className="bg-white border-b border-navy-800/8">
        <div className="px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-navy-800/40 hover:text-navy-800 transition-colors p-1 -ml-1">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={22} height={22} />
          <span className="font-sans font-semibold text-navy-800 flex-1 text-sm">Clinical Content</span>
          <button onClick={() => { setShowCapPanel(!showCapPanel) }}
            className="text-navy-800/40 hover:text-navy-800 transition-colors p-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M8 7v5M8 5.5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <button onClick={() => { setShowNew(true); setStep(1) }}
            className="bg-navy-800 text-white text-xs font-semibold px-4 py-2 rounded-xl hover:bg-navy-900 active:scale-95 transition-all flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            Generate
          </button>
        </div>
      </div>

      <main className="px-4 py-4 space-y-4 max-w-2xl mx-auto">

        {/* ── Capability Panel ── */}
        {showCapPanel && (
          <div className="bg-white border border-navy-800/8 rounded-2xl overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-navy-800/6">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-navy-800">What can you generate?</div>
                  <div className="text-xs text-navy-800/50 mt-0.5">All content backed by live peer-reviewed sources</div>
                </div>
                <button onClick={() => setShowCapPanel(false)} className="text-navy-800/30 hover:text-navy-800/60 transition-colors mt-0.5">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
              </div>
            </div>

            {/* Anti-hallucination promise */}
            <div className="px-4 py-3 bg-forest-50/60 border-b border-forest-100">
              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-forest-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <div>
                  <div className="text-xs font-semibold text-forest-800">Evidence-only content — no hallucinations</div>
                  <div className="text-xs text-forest-700/70 mt-0.5 leading-relaxed">
                    Every section must have ≥1 peer-reviewed citation. Sections with no supporting evidence are automatically removed. Your name goes on it — only what's proven stays in.
                  </div>
                </div>
              </div>
            </div>

            {/* Sources searched */}
            <div className="px-4 py-3 border-b border-navy-800/6">
              <div className="text-2xs font-semibold text-navy-800/40 uppercase tracking-wider mb-2">Sources searched in real-time</div>
              <div className="flex flex-wrap gap-1.5">
                {['PubMed / MEDLINE','NEJM','Lancet','JAMA','ACC Guidelines','ESC Guidelines','AHA / ASC','ICMR / NMC','ClinicalTrials.gov','Cochrane Reviews'].map(s => (
                  <span key={s} className="text-2xs bg-navy-50 text-navy-800/60 px-2 py-0.5 rounded-full border border-navy-800/8">{s}</span>
                ))}
              </div>
            </div>

            {/* Content types grid */}
            <div className="px-4 py-3">
              <div className="text-2xs font-semibold text-navy-800/40 uppercase tracking-wider mb-2.5">8 content types · Download formats</div>
              <div className="space-y-2">
                {CONTENT_TYPES.map(ct => (
                  <div key={ct.value} className="flex items-start gap-2.5">
                    <span className="text-base flex-shrink-0 mt-0.5">{ct.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-medium text-navy-800">{ct.label}</span>
                        <div className="flex gap-1">
                          {ct.output.map(o => (
                            <span key={o} className={`text-2xs px-1.5 py-0.5 rounded font-medium ${o === 'PPTX' ? 'bg-navy-800 text-white' : 'bg-forest-700 text-white'}`}>{o}</span>
                          ))}
                        </div>
                      </div>
                      <div className="text-2xs text-navy-800/45 mt-0.5">{ct.purpose}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-4 pb-4">
              <button onClick={() => { setShowNew(true); setShowCapPanel(false) }}
                className="w-full bg-navy-800 text-white text-sm font-medium py-3 rounded-xl hover:bg-navy-900 transition-colors active:scale-95">
                Generate your first content →
              </button>
            </div>
          </div>
        )}

        {/* ── Analytics Section ── */}
        {analytics.total > 0 && (
          <div className="space-y-3">
            {/* Time period selector */}
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-navy-800/60">Content Activity</div>
              <div className="flex gap-1 bg-white border border-navy-800/10 rounded-lg p-0.5">
                {([['month','This month'],['ytd','Year to date'],['all','All time']] as const).map(([k,l]) => (
                  <button key={k} onClick={() => setTimePeriod(k)}
                    className={`text-2xs font-medium px-2 py-1 rounded-md transition-all ${timePeriod === k ? 'bg-navy-800 text-white' : 'text-navy-800/50 hover:text-navy-800'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Analytics counters */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: timePeriod === 'month' ? 'This month' : timePeriod === 'ytd' ? 'This year' : 'Total generated',
                  value: timePeriod === 'month' ? analytics.thisMonth : timePeriod === 'ytd' ? analytics.ytd : analytics.total,
                  color: 'text-navy-800' },
                { label: 'Ready',       value: analytics.completed,  color: 'text-forest-700' },
                { label: 'In progress', value: analytics.inProgress, color: 'text-blue-600' },
                { label: 'Need review', value: analytics.awaiting,   color: analytics.awaiting > 0 ? 'text-amber-600' : 'text-navy-800/25' },
              ].map(s => (
                <div key={s.label} className="bg-white border border-navy-800/8 rounded-xl text-center p-2.5">
                  <div className={`font-display text-xl font-semibold ${s.color}`}>{s.value}</div>
                  <div className="text-2xs text-navy-800/45 leading-tight mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Tier 1 sources used */}
            {analytics.totalTier1Sources > 0 && (
              <div className="bg-forest-50 border border-forest-200/60 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-forest-700 flex items-center justify-center flex-shrink-0">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <div>
                  <div className="text-xs font-semibold text-forest-800">{analytics.totalTier1Sources} peer-reviewed sources used across your content</div>
                  <div className="text-2xs text-forest-700/60 mt-0.5">PubMed RCTs, ACC/ESC guidelines, and NEJM studies</div>
                </div>
              </div>
            )}

            {/* By category counts */}
            {topTypesByCount.length > 1 && (
              <div className="bg-white border border-navy-800/8 rounded-xl px-4 py-3">
                <div className="text-2xs font-semibold text-navy-800/40 uppercase tracking-wider mb-2">By content type</div>
                <div className="space-y-1.5">
                  {topTypesByCount.map(([type, count]) => {
                    const ct = CONTENT_TYPES.find(t => t.value === type)
                    const pct = Math.round((count / analytics.total) * 100)
                    return (
                      <div key={type} className="flex items-center gap-2">
                        <span className="text-sm flex-shrink-0">{ct?.icon}</span>
                        <span className="text-xs text-navy-800/60 flex-1 truncate">{ct?.label}</span>
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1 rounded-full bg-navy-800/8 overflow-hidden">
                            <div className="h-full bg-navy-800/40 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-2xs text-navy-800/50 w-3 text-right">{count}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Review banner ── */}
        {analytics.awaiting > 0 && (
          <button onClick={() => setTypeFilter('review')}
            className="w-full bg-amber-50 border border-amber-200/70 rounded-2xl p-4 text-left hover:bg-amber-100/60 transition-colors">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-amber-500 rounded-xl flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                  {analytics.awaiting}
                </div>
                <div>
                  <div className="text-sm font-semibold text-amber-900">Review required before download</div>
                  <div className="text-xs text-amber-700/70 mt-0.5">Patient education content must be reviewed by you first</div>
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-amber-500 flex-shrink-0">
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </button>
        )}

        {/* ── Filter chips ── */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4">
          {([
            { key: 'all',    label: `All (${requests.length})` },
            { key: 'active', label: 'In progress' },
            { key: 'review', label: 'Need review' },
            ...CONTENT_TYPES.map(ct => ({ key: ct.value, label: ct.icon + ' ' + ct.label.split(' ')[0] }))
          ] as { key: string; label: string }[]).map(f => {
            const count = f.key === 'all' ? requests.length
              : f.key === 'active' ? analytics.inProgress
              : f.key === 'review' ? analytics.awaiting
              : analytics.byType[f.key] || 0
            if (count === 0 && f.key !== 'all') return null
            return (
              <button key={f.key} onClick={() => setTypeFilter(f.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap border flex-shrink-0 transition-all
                  ${typeFilter === f.key ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-800/55 border-navy-800/12 hover:border-navy-800/25'}`}>
                {f.label}
              </button>
            )
          })}
        </div>

        {/* ── Content list ── */}
        {displayed.length > 0 ? (
          <div className="bg-white border border-navy-800/8 rounded-2xl overflow-hidden">
            {displayed.map((req, idx) => {
              const cfg  = STATUS_CONFIG[req.status] || STATUS_CONFIG.queued
              const ct   = CONTENT_TYPES.find(t => t.value === req.content_type)
              const isActive = !['completed','failed'].includes(req.status)

              return (
                <button key={req.id}
                  onClick={() => router.push(`/content/${req.id}`)}
                  className={`w-full flex items-start gap-3 px-4 py-4 text-left active:bg-navy-50 transition-colors
                    ${idx < displayed.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                  {/* Status dot */}
                  <div className={`w-2 h-2 rounded-full mt-2.5 flex-shrink-0 ${cfg.dot}`} />

                  {/* Content icon */}
                  <span className="text-lg flex-shrink-0 mt-0.5">{ct?.icon}</span>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 mb-1">
                      <span className="text-sm font-medium text-navy-800 leading-snug flex-1">{req.topic}</span>
                      {req.requires_specialist_review && !req.specialist_reviewed && (
                        <span className="text-2xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5">Review</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-2xs text-navy-800/45">{ct?.label}</span>
                      <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                      {req.status === 'completed' && req.tier1_sources_used != null && (
                        <span className="text-2xs text-forest-700 bg-forest-50 px-1.5 py-0.5 rounded-full">
                          {req.tier1_sources_used} sources
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right side */}
                  <div className="flex-shrink-0 flex flex-col items-end gap-1">
                    {isActive ? (
                      <div className="w-4 h-4 border-2 border-navy-800/15 border-t-navy-800 rounded-full animate-spin"/>
                    ) : (
                      <>
                        <div className="flex gap-1">
                          {ct?.output.map(o => (
                            <span key={o} className={`text-2xs px-1 py-0.5 rounded font-medium ${o === 'PPTX' ? 'bg-navy-100 text-navy-700' : 'bg-forest-100 text-forest-700'}`}>{o}</span>
                          ))}
                        </div>
                        <span className="text-2xs text-navy-800/30">{timeAgo(req.created_at)}</span>
                      </>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="bg-white border border-navy-800/8 rounded-2xl text-center py-14 px-6">
            <div className="w-14 h-14 bg-navy-800/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-navy-800/30">
                <path d="M9 12h6M12 9v6M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h3 className="font-display text-lg text-navy-800 mb-2">
              {typeFilter === 'all' ? 'Generate your first content' : 'No content here yet'}
            </h3>
            <p className="text-sm text-navy-800/45 mb-5 leading-relaxed max-w-xs mx-auto">
              {typeFilter === 'all'
                ? 'CME presentations, grand rounds, referral guides — all backed by live peer-reviewed literature.'
                : `No ${CONTENT_TYPES.find(t => t.value === typeFilter)?.label || 'content'} yet. Tap Generate to start.`}
            </p>
            <button onClick={() => { setShowNew(true); setStep(typeFilter !== 'all' && typeFilter !== 'active' && typeFilter !== 'review' ? 2 : 1); if (typeFilter !== 'all' && typeFilter !== 'active' && typeFilter !== 'review') setSelectedType(typeFilter) }}
              className="bg-navy-800 text-white text-sm font-medium px-5 py-2.5 rounded-xl hover:bg-navy-900 transition-colors active:scale-95">
              Generate content
            </button>
          </div>
        )}
      </main>

      {/* ════════════════════════════════════════════════════
          GENERATE CONTENT MODAL — bottom sheet
      ════════════════════════════════════════════════════ */}
      {showNew && (
        <div className="fixed inset-0 bg-navy-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50"
          onClick={e => { if (e.target === e.currentTarget) { setShowNew(false); resetForm() } }}>
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[92vh] flex flex-col">

            {/* Drag handle (mobile) */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-navy-800/15" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-navy-800/8 flex-shrink-0">
              <div>
                <div className="text-sm font-semibold text-navy-800">
                  {step === 1 ? 'Choose content type' : step === 2 ? 'Your topic' : 'Research settings'}
                </div>
                <div className="flex gap-1 mt-2">
                  {[1,2,3].map(n => (
                    <div key={n} onClick={() => n < step && setStep(n)}
                      className={`h-1 rounded-full transition-all ${n <= step ? 'bg-navy-800 w-8 cursor-pointer' : 'bg-navy-800/12 w-4'}`}/>
                  ))}
                </div>
              </div>
              <button onClick={() => { setShowNew(false); resetForm() }}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-navy-50 text-navy-800/40 hover:text-navy-800 transition-all">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1">

              {/* ── STEP 1: Content type selection ── */}
              {step === 1 && (
                <div className="p-4 space-y-2">
                  {CONTENT_TYPES.map(ct => (
                    <button key={ct.value} onClick={() => { setSelectedType(ct.value); setStep(2) }}
                      className="w-full flex items-start gap-3 p-3.5 rounded-xl border border-navy-800/10 hover:border-navy-800/25 hover:bg-navy-50/40 transition-all text-left active:scale-99 group">
                      <span className="text-xl flex-shrink-0 mt-0.5">{ct.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-navy-800">{ct.label}</span>
                          {ct.output.map(o => (
                            <span key={o} className={`text-2xs px-1.5 py-0.5 rounded font-medium ${o === 'PPTX' ? 'bg-navy-800 text-white' : 'bg-forest-700 text-white'}`}>{o}</span>
                          ))}
                        </div>
                        <div className="text-xs text-navy-800/50 mt-0.5">{ct.desc}</div>
                        <div className="text-2xs text-navy-800/35 mt-0.5">{ct.purpose}</div>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-navy-800/20 group-hover:text-navy-800/50 transition-colors flex-shrink-0 mt-2">
                        <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  ))}
                </div>
              )}

              {/* ── STEP 2: Topic input ── */}
              {step === 2 && selectedTypeMeta && (
                <div className="p-4 space-y-4">
                  {/* Selected type recap */}
                  <div className="flex items-center gap-2.5 bg-navy-50 rounded-xl px-3.5 py-2.5">
                    <span className="text-lg">{selectedTypeMeta.icon}</span>
                    <div className="flex-1">
                      <div className="text-xs font-medium text-navy-800">{selectedTypeMeta.label}</div>
                      <div className="text-2xs text-navy-800/50">{selectedTypeMeta.credibility}</div>
                    </div>
                    <button onClick={() => setStep(1)} className="text-2xs text-navy-800/50 hover:text-navy-800 transition-colors border border-navy-800/15 px-2 py-0.5 rounded-lg">Change</button>
                  </div>

                  {/* Topic textarea */}
                  <div>
                    <label className="text-2xs font-semibold text-navy-800/50 uppercase tracking-wider block mb-1.5">Your topic</label>
                    <textarea
                      value={topic} onChange={e => setTopic(e.target.value)}
                      placeholder={
                        selectedType === 'cme_presentation'   ? 'e.g. PCI outcomes in diabetic patients — ACC 2024 trial data' :
                        selectedType === 'grand_rounds'        ? 'e.g. Evolving role of FFR-guided PCI in multivessel disease' :
                        selectedType === 'referral_guide'      ? 'e.g. When to refer for TAVI — a practical guide for GPs' :
                        selectedType === 'clinical_protocol'   ? 'e.g. STEMI reperfusion protocol — time-to-balloon targets' :
                        selectedType === 'conference_abstract' ? 'e.g. Real-world outcomes of drug-coated balloon in ISR' :
                        selectedType === 'roundtable_points'   ? 'e.g. PCI vs CABG in multivessel disease — 2024 evidence' :
                        selectedType === 'case_discussion'     ? 'e.g. Complex bifurcation PCI — literature and technique' :
                        selectedType === 'patient_education'   ? 'e.g. What to expect before and after coronary angioplasty' :
                        'Describe the clinical topic in detail...'
                      }
                      rows={4}
                      className="w-full border border-navy-800/15 rounded-xl px-3.5 py-3 text-sm text-navy-800 placeholder:text-navy-800/30 focus:outline-none focus:border-navy-800/40 resize-none bg-white"
                      autoFocus
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-2xs text-navy-800/35">Be specific — include procedure names, trial names, or guideline year</span>
                      <span className={`text-2xs ${topic.length > 450 ? 'text-red-500' : 'text-navy-800/30'}`}>{topic.length}/500</span>
                    </div>
                  </div>

                  {/* Anti-hallucination note */}
                  <div className="bg-forest-50 border border-forest-200/60 rounded-xl px-3.5 py-3">
                    <div className="text-xs font-medium text-forest-800 mb-1">🔬 What the research agent will do</div>
                    <div className="text-2xs text-forest-700/70 leading-relaxed space-y-0.5">
                      <div>• Search PubMed, ACC, ESC, NEJM, Lancet in real-time</div>
                      <div>• Score each source for credibility (1–5 scale)</div>
                      <div>• Extract key findings and statistics</div>
                      <div>• Write sections only where ≥1 Tier 1 citation exists</div>
                      <div>• Remove any section without peer-reviewed support</div>
                    </div>
                  </div>

                  <div className="flex gap-2.5 pt-1">
                    <button onClick={() => setStep(1)} className="px-4 py-3 border border-navy-800/15 text-sm text-navy-800/60 rounded-xl hover:border-navy-800/30 transition-colors">Back</button>
                    <button onClick={() => setStep(3)} disabled={!topic.trim() || topic.length < 5}
                      className="flex-1 bg-navy-800 text-white text-sm font-medium py-3 rounded-xl hover:bg-navy-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed active:scale-99">
                      Next — research settings →
                    </button>
                  </div>
                </div>
              )}

              {/* ── STEP 3: Options ── */}
              {step === 3 && selectedTypeMeta && (
                <div className="p-4 space-y-4">
                  {/* Recap */}
                  <div className="bg-navy-50 rounded-xl px-3.5 py-2.5">
                    <div className="text-2xs text-navy-800/45 mb-0.5">{selectedTypeMeta.label}</div>
                    <div className="text-sm font-medium text-navy-800 leading-snug">{topic}</div>
                  </div>

                  {/* Audience */}
                  <div>
                    <label className="text-2xs font-semibold text-navy-800/50 uppercase tracking-wider block mb-2">Primary audience</label>
                    <div className="space-y-1.5">
                      {AUDIENCES.map(a => (
                        <button key={a.value} onClick={() => setAudience(a.value)}
                          className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-sm transition-all text-left
                            ${audience === a.value ? 'bg-navy-800 text-white border-navy-800' : 'border-navy-800/12 text-navy-800/65 hover:border-navy-800/25 bg-white'}`}>
                          <span>{a.icon}</span>
                          <span>{a.label}</span>
                          {audience === a.value && (
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="ml-auto flex-shrink-0">
                              <path d="M2 7l4 4 6-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Depth */}
                  <div>
                    <label className="text-2xs font-semibold text-navy-800/50 uppercase tracking-wider block mb-2">Research depth</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { value: 'overview',  label: 'Overview',  sub: '~5–8 sources',  time: '~1 min' },
                        { value: 'standard',  label: 'Standard',  sub: '~10–15 sources', time: '~2 min' },
                        { value: 'deep_dive', label: 'Deep dive', sub: '~20+ sources',   time: '~4 min' },
                      ].map(d => (
                        <button key={d.value} onClick={() => setDepth(d.value)}
                          className={`text-left px-3 py-3 rounded-xl border transition-all
                            ${depth === d.value ? 'bg-navy-800 border-navy-800' : 'border-navy-800/12 hover:border-navy-800/25 bg-white'}`}>
                          <div className={`text-xs font-semibold ${depth === d.value ? 'text-white' : 'text-navy-800'}`}>{d.label}</div>
                          <div className={`text-2xs mt-0.5 ${depth === d.value ? 'text-white/60' : 'text-navy-800/40'}`}>{d.sub}</div>
                          <div className={`text-2xs mt-0.5 ${depth === d.value ? 'text-white/50' : 'text-navy-800/30'}`}>{d.time}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Focus instructions */}
                  <div>
                    <label className="text-2xs font-semibold text-navy-800/50 uppercase tracking-wider block mb-1.5">Focus instructions <span className="text-navy-800/30 normal-case font-normal">(optional)</span></label>
                    <input type="text" value={instructions} onChange={e => setInstructions(e.target.value)}
                      placeholder="e.g. Focus on Indian population data. Include SYNTAX score discussion."
                      className="w-full border border-navy-800/15 rounded-xl px-3.5 py-2.5 text-sm text-navy-800 placeholder:text-navy-800/30 focus:outline-none focus:border-navy-800/35 bg-white"
                      maxLength={200} />
                    <div className="text-2xs text-navy-800/30 mt-1">{instructions.length}/200</div>
                  </div>

                  {/* Patient education warning */}
                  {selectedType === 'patient_education' && (
                    <div className="bg-amber-50 border border-amber-200/60 rounded-xl px-3.5 py-3">
                      <div className="text-xs font-medium text-amber-800">⚠️ Mandatory review required</div>
                      <div className="text-2xs text-amber-700/70 mt-1 leading-relaxed">
                        Patient education content requires your clinical review and approval before it can be downloaded. A review step will be added.
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2.5 pt-1">
                    <button onClick={() => setStep(2)} className="px-4 py-3 border border-navy-800/15 text-sm text-navy-800/60 rounded-xl hover:border-navy-800/30 transition-colors">Back</button>
                    <button onClick={handleSubmit} disabled={isPending}
                      className="flex-1 bg-navy-800 text-white text-sm font-semibold py-3 rounded-xl hover:bg-navy-900 transition-colors disabled:opacity-40 active:scale-99">
                      {isPending ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                          Starting research...
                        </span>
                      ) : 'Start research & generate →'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
