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

const CONTENT_TYPES = [
  { value: 'cme_presentation',  label: 'CME Presentation',          icon: '📊', output: 'PPTX + DOCX', desc: 'Slides for a CME talk with speaker notes' },
  { value: 'grand_rounds',      label: 'Grand Rounds',              icon: '🎓', output: 'PPTX + DOCX', desc: 'Teaching slides for departmental presentation' },
  { value: 'referral_guide',    label: 'Referring Doctor Guide',     icon: '📋', output: 'DOCX',       desc: 'When and how to refer — for GPs and physicians' },
  { value: 'clinical_protocol', label: 'Clinical Protocol',         icon: '📁', output: 'DOCX',       desc: 'Department protocol with graded recommendations' },
  { value: 'conference_abstract',label: 'Conference Abstract',      icon: '📝', output: 'DOCX',       desc: 'Structured abstract within word limit' },
  { value: 'roundtable_points', label: 'Roundtable Talking Points', icon: '💬', output: 'DOCX',       desc: 'Evidence landscape for advisory board meetings' },
  { value: 'case_discussion',   label: 'Case Discussion',           icon: '🔬', output: 'DOCX',       desc: 'MDT document with literature evidence' },
  { value: 'patient_education', label: 'Patient Education',         icon: '👤', output: 'DOCX',       desc: 'Plain-English material for patients and families' },
]

const AUDIENCES = [
  { value: 'specialist_peers',    label: 'Specialist peers' },
  { value: 'junior_doctors',      label: 'Junior doctors and residents' },
  { value: 'referring_physicians',label: 'GPs and referring physicians' },
  { value: 'patients_families',   label: 'Patients and families' },
  { value: 'administrators',      label: 'Hospital administrators' },
]

const STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  queued:      { label: 'Queued',         dot: 'bg-gray-400',            bg: 'bg-gray-100',  text: 'text-gray-500' },
  decomposing: { label: 'Researching...', dot: 'bg-navy-500 animate-pulse', bg: 'bg-blue-50', text: 'text-blue-700' },
  searching:   { label: 'Searching...',   dot: 'bg-blue-500 animate-pulse', bg: 'bg-blue-50', text: 'text-blue-700' },
  scoring:     { label: 'Scoring...',     dot: 'bg-blue-400 animate-pulse', bg: 'bg-blue-50', text: 'text-blue-700' },
  extracting:  { label: 'Extracting...',  dot: 'bg-teal-500 animate-pulse', bg: 'bg-teal-50', text: 'text-teal-700' },
  structuring: { label: 'Writing...',     dot: 'bg-forest-500 animate-pulse', bg: 'bg-forest-50', text: 'text-forest-700' },
  generating:  { label: 'Generating...',  dot: 'bg-forest-400 animate-pulse', bg: 'bg-forest-50', text: 'text-forest-700' },
  completed:   { label: 'Ready',          dot: 'bg-forest-700',           bg: 'bg-forest-50', text: 'text-forest-700' },
  failed:      { label: 'Failed',         dot: 'bg-red-500',              bg: 'bg-red-50',    text: 'text-red-600' },
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
  analytics: { total: number; completed: number; inProgress: number; awaiting: number }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [showNew,      setShowNew]      = useState(false)
  const [step,         setStep]         = useState(1)   // 1=type, 2=topic, 3=options
  const [selectedType, setSelectedType] = useState('')
  const [topic,        setTopic]        = useState('')
  const [audience,     setAudience]     = useState('specialist_peers')
  const [depth,        setDepth]        = useState('standard')
  const [instructions, setInstructions] = useState('')

  const [typeFilter, setTypeFilter] = useState('all')

  const displayed = typeFilter === 'all' ? requests
    : typeFilter === 'active' ? requests.filter(r => !['completed','failed'].includes(r.status))
    : requests.filter(r => r.content_type === typeFilter)

  function resetForm() {
    setStep(1); setSelectedType(''); setTopic('')
    setAudience('specialist_peers'); setDepth('standard'); setInstructions('')
  }

  function handleTypeSelect(type: string) {
    setSelectedType(type)
    setStep(2)
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
      toast.success('Research started — you\'ll see progress in a moment')
      setShowNew(false)
      resetForm()
      router.push(`/content/${r.value.requestId}`)
    })
  }

  const selectedTypeMeta = CONTENT_TYPES.find(t => t.value === selectedType)

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1">Clinical Content</span>
          <button onClick={() => setShowNew(true)}
            className="bg-navy-800 text-white text-xs font-medium px-4 py-2 rounded-xl hover:bg-navy-900 active:scale-95 transition-all">
            Generate
          </button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Analytics */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Total',      value: analytics.total,      color: 'text-navy-800' },
            { label: 'Ready',      value: analytics.completed,  color: 'text-forest-700' },
            { label: 'In progress',value: analytics.inProgress, color: 'text-blue-600' },
            { label: 'Review needed',value:analytics.awaiting,  color: analytics.awaiting > 0 ? 'text-amber-600' : 'text-navy-800/30' },
          ].map(s => (
            <div key={s.label} className="card-clinical text-center p-2">
              <div className={`font-display text-xl font-medium ${s.color}`}>{s.value}</div>
              <div className="data-label text-2xs leading-tight mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Patient education review banner */}
        {analytics.awaiting > 0 && (
          <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4 cursor-pointer"
            onClick={() => setTypeFilter('patient_education')}>
            <div className="flex items-center justify-between">
              <div>
                <div className="data-label text-amber-700/70 mb-1">Review required</div>
                <p className="text-sm font-medium text-amber-900">
                  {analytics.awaiting} patient education document{analytics.awaiting > 1 ? 's' : ''} awaiting your review before download
                </p>
              </div>
              <div className="w-8 h-8 bg-amber-500 rounded-xl flex items-center justify-center text-white font-medium text-sm">{analytics.awaiting}</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button onClick={() => setTypeFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap border flex-shrink-0 transition-all
              ${typeFilter === 'all' ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-800/60 border-navy-800/15'}`}>
            All ({requests.length})
          </button>
          {CONTENT_TYPES.slice(0, 4).map(ct => (
            <button key={ct.value} onClick={() => setTypeFilter(ct.value)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap border flex-shrink-0 transition-all
                ${typeFilter === ct.value ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-800/60 border-navy-800/15'}`}>
              {ct.label}
            </button>
          ))}
        </div>

        {/* Content list */}
        {displayed.length > 0 ? (
          <div className="card-clinical p-0 overflow-hidden">
            {displayed.map((req, idx) => {
              const cfg   = STATUS_CONFIG[req.status] || STATUS_CONFIG.queued
              const ct    = CONTENT_TYPES.find(t => t.value === req.content_type)
              const isActive = !['completed','failed'].includes(req.status)

              return (
                <button key={req.id}
                  onClick={() => router.push(`/content/${req.id}`)}
                  className={`w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-navy-50/60 transition-colors
                    ${idx < displayed.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${cfg.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-medium text-navy-800 truncate">{req.topic}</span>
                      {req.requires_specialist_review && !req.specialist_reviewed && (
                        <span className="text-2xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full flex-shrink-0">Review needed</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-navy-800/50">{ct?.icon} {ct?.label}</span>
                      <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                      {req.status === 'completed' && (
                        <span className="text-2xs text-navy-800/40">
                          {req.tier1_sources_used} sources · {req.sections_generated} sections
                          {(req.tier2_sources_found || 0) > 0 && ` · ${req.tier2_sources_found} emerging`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {isActive ? (
                      <div className="w-4 h-4 border border-navy-800/20 border-t-navy-800 rounded-full animate-spin"/>
                    ) : (
                      <span className="text-xs text-navy-800/35">{timeAgo(req.created_at)}</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="card-clinical text-center py-12">
            <div className="w-12 h-12 bg-navy-800/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-navy-800/40">
                <path d="M12 2a10 10 0 110 20A10 10 0 0112 2z" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h3 className="font-display text-xl text-navy-800 mb-2">No content yet</h3>
            <p className="text-sm text-navy-800/50 mb-5 leading-relaxed max-w-xs mx-auto">
              Generate your first CME presentation, grand rounds, or referral guide — powered by live medical literature search.
            </p>
            <button onClick={() => setShowNew(true)} className="btn-primary">Generate content</button>
          </div>
        )}
      </main>

      {/* New content modal — 3-step flow */}
      {showNew && (
        <div className="fixed inset-0 bg-navy-900/60 flex items-end sm:items-center justify-center z-50 animate-fade-in">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-clinical-lg max-h-[90vh] overflow-y-auto">

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-navy-800/8">
              <div>
                <div className="font-medium text-navy-800 text-sm">
                  {step === 1 ? 'Select content type' : step === 2 ? 'Your topic' : 'Options'}
                </div>
                <div className="flex gap-1 mt-1.5">
                  {[1,2,3].map(n => (
                    <div key={n} className={`h-1 rounded-full transition-all ${n <= step ? 'bg-navy-800 w-8' : 'bg-navy-800/15 w-4'}`}/>
                  ))}
                </div>
              </div>
              <button onClick={() => { setShowNew(false); resetForm() }} className="text-navy-800/40 hover:text-navy-800 transition-colors text-lg px-1">✕</button>
            </div>

            {/* Step 1: Content type selection */}
            {step === 1 && (
              <div className="p-5 space-y-2">
                {CONTENT_TYPES.map(ct => (
                  <button key={ct.value} onClick={() => handleTypeSelect(ct.value)}
                    className="w-full flex items-start gap-3 p-3.5 rounded-xl border border-navy-800/12 hover:border-navy-800/30 hover:bg-navy-50/50 transition-all text-left group">
                    <span className="text-xl flex-shrink-0 mt-0.5">{ct.icon}</span>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-navy-800">{ct.label}</div>
                      <div className="text-xs text-navy-800/50 mt-0.5">{ct.desc}</div>
                      <div className="text-2xs text-forest-700 mt-1 font-medium">Output: {ct.output}</div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-navy-800/20 group-hover:text-navy-800/50 transition-colors flex-shrink-0 mt-1">
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                ))}
                {selectedType === 'patient_education' && (
                  <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-800/80 leading-relaxed">
                    Patient education content requires your review before download. A confirmation step is added.
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Topic input */}
            {step === 2 && (
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-2 bg-navy-50 rounded-xl px-3 py-2.5">
                  <span>{selectedTypeMeta?.icon}</span>
                  <span className="text-xs font-medium text-navy-800">{selectedTypeMeta?.label}</span>
                  <button onClick={() => setStep(1)} className="ml-auto text-xs text-navy-800/50 hover:text-navy-800 transition-colors">Change</button>
                </div>
                <div>
                  <label className="data-label block mb-1.5">Topic</label>
                  <textarea
                    value={topic} onChange={e => setTopic(e.target.value)}
                    placeholder={
                      selectedType === 'cme_presentation'  ? 'e.g. PCI outcomes in diabetic patients 2024' :
                      selectedType === 'referral_guide'    ? 'e.g. When to refer for TAVI — GP guide' :
                      selectedType === 'clinical_protocol' ? 'e.g. STEMI management protocol' :
                      selectedType === 'patient_education' ? 'e.g. What to expect after coronary angioplasty' :
                      selectedType === 'roundtable_points' ? 'e.g. PCI vs CABG in multivessel disease 2024' :
                      'Describe the clinical topic you want to create content on...'
                    }
                    rows={3}
                    className="input-clinical resize-none text-sm"
                    autoFocus
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-2xs text-navy-800/40">Be specific — include procedure names, trial names, or guideline year if relevant</span>
                    <span className={`text-2xs ${topic.length > 450 ? 'text-red-500' : 'text-navy-800/30'}`}>{topic.length}/500</span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep(3)} disabled={!topic.trim() || topic.length < 5} className="btn-primary flex-1">
                    Next — set options
                  </button>
                  <button onClick={() => setStep(1)} className="btn-secondary px-4">Back</button>
                </div>
              </div>
            )}

            {/* Step 3: Options + generate */}
            {step === 3 && (
              <div className="p-5 space-y-4">
                <div className="bg-navy-50 rounded-xl px-3 py-2.5">
                  <div className="text-xs text-navy-800/50 mb-0.5">{selectedTypeMeta?.label}</div>
                  <div className="text-sm font-medium text-navy-800 truncate">{topic}</div>
                </div>
                <div>
                  <label className="data-label block mb-2">Target audience</label>
                  <div className="grid grid-cols-1 gap-1.5">
                    {AUDIENCES.map(a => (
                      <button key={a.value} onClick={() => setAudience(a.value)}
                        className={`text-left px-3 py-2.5 rounded-xl border text-sm transition-all
                          ${audience === a.value ? 'bg-navy-800 text-white border-navy-800' : 'border-navy-800/15 text-navy-800/70 hover:border-navy-800/30'}`}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="data-label block mb-2">Depth</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'overview',  label: 'Overview',  sub: '~5–8 sources' },
                      { value: 'standard',  label: 'Standard',  sub: '~10–15 sources' },
                      { value: 'deep_dive', label: 'Deep dive', sub: '~20+ sources' },
                    ].map(d => (
                      <button key={d.value} onClick={() => setDepth(d.value)}
                        className={`text-left px-3 py-2.5 rounded-xl border transition-all
                          ${depth === d.value ? 'bg-navy-800 text-white border-navy-800' : 'border-navy-800/15 hover:border-navy-800/30'}`}>
                        <div className={`text-sm font-medium ${depth === d.value ? 'text-white' : 'text-navy-800'}`}>{d.label}</div>
                        <div className={`text-2xs mt-0.5 ${depth === d.value ? 'text-white/70' : 'text-navy-800/40'}`}>{d.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="data-label block mb-1.5">Focus instructions (optional)</label>
                  <input type="text" value={instructions} onChange={e => setInstructions(e.target.value)}
                    placeholder="e.g. Focus on Indian population data. Include SYNTAX score discussion."
                    className="input-clinical text-sm" maxLength={200} />
                  <div className="text-2xs text-navy-800/40 mt-1">{instructions.length}/200</div>
                </div>
                <div className="bg-clinical-light rounded-xl px-4 py-3">
                  <div className="text-xs text-navy-800/60 leading-relaxed">
                    The research agent will search PubMed, ACC, ESC, AHA, CSI, ICMR and other credible sources.
                    All claims will be cited. Sections without peer-reviewed evidence are not included.
                    Generation takes 1–3 minutes.
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={handleSubmit} disabled={isPending}
                    className="btn-primary flex-1 py-3">
                    {isPending ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin"/>
                        Starting...
                      </span>
                    ) : 'Generate content'}
                  </button>
                  <button onClick={() => setStep(2)} className="btn-secondary px-4">Back</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
