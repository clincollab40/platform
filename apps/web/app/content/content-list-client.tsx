'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  createContentRequestAction,
  analyzeTopicAction,
  buildRefinedTopicAction,
  type RefinementQuestion,
} from '@/app/actions/content'

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
  // Topic refinement framework
  const [topicScore,       setTopicScore]       = useState(0)
  const [refineOpen,       setRefineOpen]       = useState(false)
  const [refineLoading,    setRefineLoading]    = useState(false)
  const [refineQuestions,  setRefineQuestions]  = useState<RefinementQuestion[]>([])
  const [refineAnswers,    setRefineAnswers]    = useState<Record<string, string>>({})
  const [buildingTopic,    setBuildingTopic]    = useState(false)
  const [typeFilter,   setTypeFilter]   = useState('all')
  const [timePeriod,   setTimePeriod]   = useState<'month'|'ytd'|'all'>('month')

  const displayed = typeFilter === 'all' ? requests
    : typeFilter === 'active' ? requests.filter(r => !['completed','failed'].includes(r.status))
    : typeFilter === 'review' ? requests.filter(r => r.requires_specialist_review && !r.specialist_reviewed)
    : requests.filter(r => r.content_type === typeFilter)

  function resetForm() {
    setStep(1); setSelectedType(''); setTopic('')
    setAudience('specialist_peers'); setDepth('standard'); setInstructions('')
    setTopicScore(0); setRefineOpen(false); setRefineLoading(false)
    setRefineQuestions([]); setRefineAnswers({}); setBuildingTopic(false)
  }

  // ── Deterministic local specificity scorer (instant, no LLM) ──
  function scoreTopicLocally(t: string): number {
    if (!t || t.trim().length < 5) return 0
    let score = 0
    const words = t.trim().split(/\s+/)
    if (words.length >= 6)  score += 15  // reasonable length
    if (words.length >= 10) score += 10  // detailed
    if (/\b(20\d\d)\b/.test(t)) score += 20                                          // has year
    if (/\b(ACC|ESC|AHA|NICE|WHO|CSI|ICMR|AIIMS|NABH|NMC|JNC|CHEST|ISCCM)\b/i.test(t)) score += 20  // guideline org
    if (/\b(trial|study|rct|data|outcomes|registry|meta-analysis|guideline|protocol|consensus)\b/i.test(t)) score += 15  // evidence type
    if (/\b(diabetic|elderly|paediatric|post[-\s]?(MI|STEMI|CABG|PCI)|high.risk|indian|rural|urban)\b/i.test(t)) score += 10  // patient population
    if (/\b(vs|versus|compared|over|after|before|following|in patients|with)\b/i.test(t)) score += 10  // comparator
    return Math.min(score, 100)
  }

  // Auto-score when topic changes (debounced 600ms)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleTopicChange(val: string) {
    setTopic(val)
    setRefineAnswers({})       // clear answers on edit
    setRefineOpen(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const s = scoreTopicLocally(val)
      setTopicScore(s)
    }, 600)
  }

  // ── AI-powered topic analysis ──
  async function handleAnalyseTopic() {
    if (!topic.trim() || topic.length < 8 || refineLoading) return
    setRefineLoading(true)
    setRefineOpen(true)
    setRefineQuestions([])
    setRefineAnswers({})
    try {
      const r = await analyzeTopicAction(topic.trim(), selectedType, 'clinical specialist')
      if (r.ok) {
        setTopicScore(r.value.score)
        setRefineQuestions(r.value.questions)
      } else {
        toast.error('Could not analyse topic — please try again')
        setRefineOpen(false)
      }
    } catch {
      toast.error('AI service unavailable — please try again')
      setRefineOpen(false)
    } finally {
      setRefineLoading(false)
    }
  }

  // ── Build refined topic from answers ──
  async function handleBuildRefinedTopic() {
    const selectedAnswers = Object.values(refineAnswers)
    if (selectedAnswers.length === 0) return
    setBuildingTopic(true)
    try {
      const r = await buildRefinedTopicAction(topic.trim(), selectedType, selectedAnswers)
      if (r.ok && r.value) {
        setTopic(r.value)
        setTopicScore(scoreTopicLocally(r.value))
        setRefineOpen(false)
        setRefineQuestions([])
        setRefineAnswers({})
        toast.success('Topic refined ✓')
      } else {
        toast.error('Could not compose refined topic — please edit manually')
      }
    } catch {
      toast.error('AI service unavailable')
    } finally {
      setBuildingTopic(false)
    }
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
      try {
        const r = await createContentRequestAction(fd)
        if (!r.ok) { toast.error(r.error || 'Could not start research'); return }
        toast.success('Research started — tracking progress now')
        setShowNew(false)
        resetForm()
        if (r.value?.requestId) {
          router.push(`/content/${r.value.requestId}`)
        } else {
          toast.error('Unexpected error: no request ID returned')
        }
      } catch (err: any) {
        console.error('[Content] handleSubmit error:', err)
        toast.error(err?.message || 'Something went wrong — please try again')
      }
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

              {/* ── STEP 2: Topic input + intelligent refinement ── */}
              {step === 2 && selectedTypeMeta && (
                <div className="p-4 space-y-3">

                  {/* Selected type recap */}
                  <div className="flex items-center gap-2.5 bg-navy-50 rounded-xl px-3.5 py-2.5">
                    <span className="text-lg">{selectedTypeMeta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-navy-800">{selectedTypeMeta.label}</div>
                      <div className="text-2xs text-navy-800/45 truncate">{selectedTypeMeta.credibility}</div>
                    </div>
                    <button onClick={() => setStep(1)} className="text-2xs text-navy-800/50 hover:text-navy-800 transition-colors border border-navy-800/15 px-2 py-0.5 rounded-lg flex-shrink-0">Change</button>
                  </div>

                  {/* Topic textarea */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-2xs font-semibold text-navy-800/50 uppercase tracking-wider">Your topic</label>
                      {/* Specificity gauge */}
                      {topic.length >= 5 && (
                        <div className="flex items-center gap-1.5">
                          <div className="flex gap-0.5">
                            {[20,40,60,80].map(threshold => (
                              <div key={threshold}
                                className={`h-1.5 w-4 rounded-full transition-colors ${topicScore >= threshold
                                  ? topicScore >= 70 ? 'bg-forest-600' : topicScore >= 40 ? 'bg-amber-500' : 'bg-red-400'
                                  : 'bg-navy-800/10'}`}/>
                            ))}
                          </div>
                          <span className={`text-2xs font-medium ${topicScore >= 70 ? 'text-forest-700' : topicScore >= 40 ? 'text-amber-600' : 'text-red-500'}`}>
                            {topicScore >= 70 ? 'Specific ✓' : topicScore >= 40 ? 'Moderate' : 'Too broad'}
                          </span>
                        </div>
                      )}
                    </div>
                    <textarea
                      value={topic}
                      onChange={e => handleTopicChange(e.target.value)}
                      placeholder={
                        selectedType === 'cme_presentation'   ? 'e.g. PCI outcomes in diabetic patients — ACC/ESC 2023 guidelines' :
                        selectedType === 'grand_rounds'        ? 'e.g. FFR-guided PCI in multivessel disease — FAME 2 trial data' :
                        selectedType === 'referral_guide'      ? 'e.g. When to refer for TAVI — practical guide for GPs (ESC 2021)' :
                        selectedType === 'clinical_protocol'   ? 'e.g. STEMI reperfusion protocol — door-to-balloon time targets' :
                        selectedType === 'conference_abstract' ? 'e.g. Real-world outcomes of drug-coated balloon in ISR — Indian registry' :
                        selectedType === 'roundtable_points'   ? 'e.g. PCI vs CABG in multivessel CAD — 2023 trial evidence update' :
                        selectedType === 'case_discussion'     ? 'e.g. Complex bifurcation PCI in high-risk patient — MDT approach' :
                        selectedType === 'patient_education'   ? 'e.g. What to expect before and after coronary angioplasty' :
                        'Describe your clinical topic...'
                      }
                      rows={3}
                      className="w-full border border-navy-800/15 rounded-xl px-3.5 py-3 text-sm text-navy-800 placeholder:text-navy-800/30 focus:outline-none focus:border-navy-800/40 resize-none bg-white"
                      autoFocus
                    />
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-2xs text-navy-800/35">Include: patient group · procedure · trial name · guideline year</span>
                      <span className={`text-2xs ${topic.length > 450 ? 'text-red-500' : 'text-navy-800/25'}`}>{topic.length}/500</span>
                    </div>
                  </div>

                  {/* ── AI Refinement Panel ── */}
                  {topic.length >= 8 && topicScore < 70 && (
                    <div className="border border-amber-200/80 rounded-xl overflow-hidden">
                      {/* Panel header */}
                      <div className="bg-amber-50 px-3.5 py-2.5 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-amber-800">
                            {topicScore < 40 ? '⚠️ Topic is too broad for quality output' : '💡 Topic could be more specific'}
                          </div>
                          <div className="text-2xs text-amber-700/70 mt-0.5">
                            {topicScore < 40
                              ? 'Broad topics produce scattered evidence and thin content. Answer 3 quick questions to focus it.'
                              : 'A few more details will produce stronger, better-cited content.'}
                          </div>
                        </div>
                        {!refineOpen && (
                          <button
                            onClick={handleAnalyseTopic}
                            disabled={refineLoading}
                            className="flex-shrink-0 flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-2xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                            {refineLoading
                              ? <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin"/>
                              : '🎯'}
                            {refineLoading ? 'Analysing…' : 'Refine topic'}
                          </button>
                        )}
                      </div>

                      {/* Questions */}
                      {refineOpen && refineQuestions.length > 0 && (
                        <div className="bg-white px-3.5 py-3 space-y-3.5">
                          {refineQuestions.map((q, qi) => (
                            <div key={q.id}>
                              <div className="text-2xs font-semibold text-navy-800/60 mb-1.5">
                                {qi + 1}. {q.text}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {q.options.map(opt => {
                                  const selected = refineAnswers[q.id] === opt
                                  return (
                                    <button
                                      key={opt}
                                      onClick={() => setRefineAnswers(prev => ({ ...prev, [q.id]: opt }))}
                                      className={`text-2xs px-2.5 py-1.5 rounded-lg border transition-all ${
                                        selected
                                          ? 'bg-navy-800 text-white border-navy-800 font-medium'
                                          : 'bg-white text-navy-800/70 border-navy-800/15 hover:border-navy-800/35 hover:text-navy-800'
                                      }`}>
                                      {opt}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}

                          {/* Compose button */}
                          <div className="pt-1 flex gap-2">
                            <button
                              onClick={handleBuildRefinedTopic}
                              disabled={Object.keys(refineAnswers).length === 0 || buildingTopic}
                              className="flex items-center gap-1.5 bg-navy-800 hover:bg-navy-900 text-white text-2xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed active:scale-99">
                              {buildingTopic
                                ? <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin"/>
                                : '✨'}
                              {buildingTopic ? 'Building…' : `Build refined topic (${Object.keys(refineAnswers).length}/${refineQuestions.length} answered)`}
                            </button>
                            <button
                              onClick={() => { setRefineOpen(false); setRefineQuestions([]); setRefineAnswers({}) }}
                              className="text-2xs text-navy-800/40 hover:text-navy-800/70 px-3 py-2 transition-colors">
                              Skip
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Loading skeleton */}
                      {refineLoading && (
                        <div className="bg-white px-3.5 py-3 space-y-2.5">
                          {[1,2,3].map(i => (
                            <div key={i} className="space-y-1.5 animate-pulse">
                              <div className="h-2.5 bg-navy-800/8 rounded w-2/3"/>
                              <div className="flex gap-1.5">
                                {[1,2,3].map(j => <div key={j} className="h-6 bg-navy-800/6 rounded-lg w-20"/>)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Success state when specific enough */}
                  {topic.length >= 8 && topicScore >= 70 && (
                    <div className="bg-forest-50 border border-forest-200/60 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
                      <div className="w-6 h-6 bg-forest-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-forest-800">Topic is well-defined</div>
                        <div className="text-2xs text-forest-700/70">Specific enough for focused evidence search and quality output</div>
                      </div>
                    </div>
                  )}

                  {/* What the pipeline does */}
                  <div className="bg-navy-50/60 rounded-xl px-3.5 py-2.5">
                    <div className="text-2xs font-medium text-navy-800/60 mb-1">What happens next</div>
                    <div className="text-2xs text-navy-800/45 leading-relaxed space-y-0.5">
                      <div>① Topic broken into {depth === 'overview' ? '3' : depth === 'deep_dive' ? '6' : '4'} focused research areas</div>
                      <div>② Each area searched across PubMed, ACC, ESC, AHA, NEJM, Lancet</div>
                      <div>③ Sources scored for credibility — only peer-reviewed evidence used</div>
                      <div>④ Content structured and cited using Vancouver format</div>
                    </div>
                  </div>

                  <div className="flex gap-2.5 pt-1">
                    <button onClick={() => setStep(1)} className="px-4 py-3 border border-navy-800/15 text-sm text-navy-800/60 rounded-xl hover:border-navy-800/30 transition-colors">Back</button>
                    <button
                      onClick={() => setStep(3)}
                      disabled={!topic.trim() || topic.length < 8}
                      className={`flex-1 text-white text-sm font-semibold py-3 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-99 ${
                        topicScore >= 70 ? 'bg-forest-700 hover:bg-forest-800' : 'bg-navy-800 hover:bg-navy-900'
                      }`}>
                      {topicScore >= 70 ? '✓ Continue to settings →' : 'Continue anyway →'}
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
