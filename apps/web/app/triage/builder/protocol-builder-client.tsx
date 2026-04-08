'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  createProtocolAction,
  saveQuestionsAction,
  createTriageSessionAction,
  updateProtocolPocAction,
} from '@/app/actions/triage'
// ⚠️  Import ONLY from triage-logic (client-safe) — NOT from triage-engine (Node.js only)
import { resolveVisibleQuestions, type TriageQuestion } from '@/lib/ai/triage-logic'

// ── Constants ────────────────────────────────────────────────────────────────
const Q_TYPES = [
  { value: 'yes_no',        label: 'Yes / No',         icon: '☑' },
  { value: 'single_choice', label: 'Single choice',     icon: '◉' },
  { value: 'multi_choice',  label: 'Multi-select',      icon: '☰' },
  { value: 'text',          label: 'Free text',         icon: '✏' },
  { value: 'number',        label: 'Number',            icon: '#' },
  { value: 'scale',         label: 'Scale 1–10',        icon: '↔' },
  { value: 'vitals_bp',     label: 'Blood pressure',    icon: '♥' },
  { value: 'vitals_single', label: 'Single vital',      icon: '📊' },
  { value: 'date',          label: 'Date',              icon: '📅' },
  { value: 'section_header',label: 'Section heading',   icon: '—' },
]

const PROTOCOL_TYPES = [
  { value: 'new_patient',       label: 'New OPD patient' },
  { value: 'pre_procedure',     label: 'Pre-procedure' },
  { value: 'follow_up',         label: 'Follow-up visit' },
  { value: 'emergency_walkIn',  label: 'Emergency walk-in' },
  { value: 'post_procedure',    label: 'Post-procedure' },
  { value: 'general',           label: 'General' },
]

const FLAG_LEVELS = [
  { value: 'needs_review', label: 'Needs review 🟡' },
  { value: 'urgent',       label: 'Urgent 🔴' },
]

const OPERATORS = [
  { value: 'eq',       label: '=' },
  { value: 'not_eq',   label: '≠' },
  { value: 'gt',       label: '>' },
  { value: 'gte',      label: '≥' },
  { value: 'lt',       label: '<' },
  { value: 'lte',      label: '≤' },
  { value: 'contains', label: 'contains' },
]

type Protocol = {
  id: string; name: string; protocol_type: string
  is_active: boolean; is_default: boolean; version: number
  poc_mobile?: string | null; poc_name?: string | null
  review_required?: boolean; poc_alert_on?: string | null
}
type Template = { id: string; specialty: string; name: string; description: string; protocol_type: string }

// ── Blank question factory ───────────────────────────────────────────────────
function blankQuestion(sortOrder: number): TriageQuestion {
  return {
    id:             `new-${Date.now()}-${sortOrder}`,
    question_text:  '',
    question_type:  'yes_no',
    options:        [],
    is_required:    false,
    sort_order:     sortOrder,
    section:        null,
    help_text:      null,
    unit:           null,
    min_value:      null,
    max_value:      null,
    branch_logic:   [],
    red_flag_rules: [],
  }
}

// ── Question type palette (drag source) ─────────────────────────────────────
function QTypePalette({ onAdd }: { onAdd: (type: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {Q_TYPES.map(t => (
        <button
          key={t.value}
          onClick={() => onAdd(t.value)}
          draggable
          onDragStart={e => e.dataTransfer.setData('qtype', t.value)}
          className="flex items-center gap-2 px-2.5 py-2 rounded-xl border border-navy-800/12
                     bg-white text-xs font-medium text-navy-800/70 hover:border-navy-800/30
                     hover:text-navy-800 hover:bg-navy-50 transition-all cursor-grab active:cursor-grabbing"
        >
          <span className="text-base leading-none w-5 text-center flex-shrink-0">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ProtocolBuilderClient({
  specialist, protocols, selectedProtocol, questions: initialQuestions, templates,
}: {
  specialist: { id: string; name: string; specialty: string; role: string }
  protocols: Protocol[]
  selectedProtocol: Protocol | null
  questions: any[]
  templates: Template[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [questions, setQuestions] = useState<TriageQuestion[]>(
    initialQuestions.map(q => ({
      ...q,
      options:        q.options        || [],
      branch_logic:   q.branch_logic   || [],
      red_flag_rules: q.red_flag_rules || [],
    }))
  )

  // Tabs: build | poc | preview
  const [tab, setTab]                       = useState<'build' | 'poc' | 'preview'>('build')
  const [expandedQ, setExpandedQ]           = useState<string | null>(null)
  const [showNewProtocol, setShowNewProtocol] = useState(false)
  const [showSendTriage, setShowSendTriage] = useState(false)
  const [newProtocol, setNewProtocol]       = useState({ name: '', protocol_type: 'pre_procedure', template_id: '' })
  const [triageForm, setTriageForm]         = useState({ patient_name: '', patient_mobile: '' })
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, string>>({})

  // POC (Point of Contact) settings
  const [poc, setPoc] = useState({
    poc_name:        selectedProtocol?.poc_name        || '',
    poc_mobile:      selectedProtocol?.poc_mobile      || '',
    review_required: selectedProtocol?.review_required ?? true,
    poc_alert_on:    selectedProtocol?.poc_alert_on    || 'urgent,needs_review',
  })

  // Drag-and-drop state
  const dragIndex = useRef<number | null>(null)

  const protocolId = selectedProtocol?.id ?? null

  // ── Question CRUD ──────────────────────────────────────────────────────────
  function addQuestion(type = 'yes_no') {
    const newQ: TriageQuestion = {
      ...blankQuestion(questions.length + 1),
      question_type: type as any,
    }
    setQuestions(prev => [...prev, newQ])
    setExpandedQ(newQ.id)
    setTab('build')
  }

  function updateQ(id: string, updates: Partial<TriageQuestion>) {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, ...updates } : q))
  }

  function removeQ(id: string) {
    setQuestions(prev =>
      prev.filter(q => q.id !== id).map((q, i) => ({ ...q, sort_order: i + 1 }))
    )
  }

  // HTML5 drag-and-drop reordering
  function handleDragStart(e: React.DragEvent, idx: number) {
    dragIndex.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDrop(e: React.DragEvent, dropIdx: number) {
    e.preventDefault()
    const fromIdx = dragIndex.current
    if (fromIdx === null || fromIdx === dropIdx) return
    setQuestions(prev => {
      const arr = [...prev]
      const [moved] = arr.splice(fromIdx, 1)
      arr.splice(dropIdx, 0, moved)
      return arr.map((q, i) => ({ ...q, sort_order: i + 1 }))
    })
    dragIndex.current = null
  }

  function handleDropFromPalette(e: React.DragEvent) {
    e.preventDefault()
    const qtype = e.dataTransfer.getData('qtype')
    if (qtype) addQuestion(qtype)
  }

  // ── Options ────────────────────────────────────────────────────────────────
  function addOption(qId: string) {
    const q = questions.find(q => q.id === qId)
    updateQ(qId, {
      options: [...(q?.options || []), { value: `opt${Date.now()}`, label: '' }]
    })
  }

  function updateOption(qId: string, idx: number, label: string) {
    const q = questions.find(q => q.id === qId)
    if (!q) return
    const opts = [...q.options]
    opts[idx] = { ...opts[idx], label, value: label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || `opt${idx}` }
    updateQ(qId, { options: opts })
  }

  function removeOption(qId: string, idx: number) {
    const q = questions.find(q => q.id === qId)
    if (!q) return
    updateQ(qId, { options: q.options.filter((_, i) => i !== idx) })
  }

  // ── Red flag rules ─────────────────────────────────────────────────────────
  function addRedFlagRule(qId: string) {
    const q = questions.find(q => q.id === qId)
    if (!q) return
    updateQ(qId, {
      red_flag_rules: [...q.red_flag_rules,
        { operator: 'eq', value: 'yes', level: 'needs_review', message: '' }]
    })
  }

  function updateRedFlag(qId: string, idx: number, field: string, val: string) {
    const q = questions.find(q => q.id === qId)
    if (!q) return
    const rules = [...q.red_flag_rules]
    rules[idx] = { ...rules[idx], [field]: val }
    updateQ(qId, { red_flag_rules: rules })
  }

  function removeRedFlag(qId: string, idx: number) {
    const q = questions.find(q => q.id === qId)
    if (!q) return
    updateQ(qId, { red_flag_rules: q.red_flag_rules.filter((_, i) => i !== idx) })
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!protocolId) return
    const validQs = questions.filter(
      q => q.question_text.trim() || q.question_type === 'section_header'
    )
    startTransition(async () => {
      const result = await saveQuestionsAction(protocolId, validQs)
      if (result?.error) toast.error(result.error)
      else toast.success(`Protocol saved — ${result.count} questions`)
    })
  }

  // ── Save POC settings ──────────────────────────────────────────────────────
  async function handleSavePoc(e: React.FormEvent) {
    e.preventDefault()
    if (!protocolId) return
    startTransition(async () => {
      const result = await updateProtocolPocAction(protocolId, poc)
      if (result?.error) toast.error(result.error)
      else toast.success('POC settings saved')
    })
  }

  // ── Create protocol ────────────────────────────────────────────────────────
  async function handleCreateProtocol(e: React.FormEvent) {
    e.preventDefault()
    if (!newProtocol.name.trim()) return
    const fd = new FormData()
    fd.set('name', newProtocol.name)
    fd.set('protocol_type', newProtocol.protocol_type)
    if (newProtocol.template_id) fd.set('template_id', newProtocol.template_id)

    startTransition(async () => {
      const result = await createProtocolAction(fd)
      if (result?.error) { toast.error(result.error); return }
      toast.success('Protocol created')
      setShowNewProtocol(false)
      setNewProtocol({ name: '', protocol_type: 'pre_procedure', template_id: '' })
      router.push(`/triage/builder?protocol=${result.id}`)
    })
  }

  // ── Send triage ────────────────────────────────────────────────────────────
  async function handleSendTriage(e: React.FormEvent) {
    e.preventDefault()
    if (!protocolId || !triageForm.patient_name.trim()) return
    startTransition(async () => {
      const result = await createTriageSessionAction(
        protocolId, triageForm.patient_name, triageForm.patient_mobile
      )
      if (result?.error) { toast.error(result.error); return }
      toast.success(triageForm.patient_mobile ? 'Triage sent via WhatsApp' : 'Triage link created')
      if (result.url) {
        navigator.clipboard.writeText(result.url).catch(() => {})
        toast.success('Link copied to clipboard')
      }
      setShowSendTriage(false)
      setTriageForm({ patient_name: '', patient_mobile: '' })
    })
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  const previewVisible = tab === 'preview'
    ? resolveVisibleQuestions(questions, previewAnswers).filter(
        q => q.question_type !== 'section_header'
      )
    : []

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-clinical-light">

      {/* Non-sticky inner nav */}
      <div className="bg-white border-b border-navy-800/8">
        <div className="px-5 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/triage/sessions')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span className="font-sans font-medium text-navy-800 flex-1">Protocol builder</span>
          {protocolId && (
            <div className="flex gap-2">
              <button onClick={() => setShowSendTriage(true)}
                className="text-xs font-medium px-3 py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-all">
                Send triage
              </button>
              <button onClick={handleSave} disabled={isPending}
                className="btn-primary text-xs py-1.5 px-4">
                {isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>
      </div>

      <main className="px-4 py-5">
        <div className="flex gap-5">

          {/* ── Left column: protocol list + type palette ── */}
          <div className="w-56 flex-shrink-0 space-y-4">

            {/* Protocol list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="data-label">My protocols</span>
                <button onClick={() => setShowNewProtocol(true)}
                  className="text-xs font-semibold text-navy-800 hover:underline">+ New</button>
              </div>
              <div className="space-y-1.5">
                {protocols.map(p => (
                  <button key={p.id}
                    onClick={() => router.push(`/triage/builder?protocol=${p.id}`)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all text-xs
                      ${p.id === protocolId
                        ? 'border-navy-800/40 bg-navy-800/5 text-navy-800 font-medium'
                        : 'border-navy-800/10 bg-white text-navy-800/60 hover:border-navy-800/25 hover:text-navy-800'}`}
                  >
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-navy-800/40 mt-0.5 capitalize">
                      {p.protocol_type.replace(/_/g, ' ')}
                    </div>
                  </button>
                ))}
                {protocols.length === 0 && (
                  <button onClick={() => setShowNewProtocol(true)}
                    className="w-full text-center text-xs text-navy-800/40 py-4 border-2 border-dashed border-navy-800/15 rounded-xl hover:border-navy-800/30 transition-all">
                    Create first protocol
                  </button>
                )}
              </div>
              <button onClick={() => router.push('/triage/sessions')}
                className="w-full text-2xs text-navy-800/40 hover:text-navy-800/60 transition-colors text-center py-2 mt-1">
                View sessions →
              </button>
            </div>

            {/* Field type palette — drag to canvas or click to add */}
            {protocolId && (
              <div>
                <div className="data-label mb-2">Add fields</div>
                <div className="text-2xs text-navy-800/40 mb-2 leading-relaxed">
                  Click or drag a field type onto the canvas →
                </div>
                <QTypePalette onAdd={addQuestion} />
              </div>
            )}
          </div>

          {/* ── Right column: tabs + canvas ── */}
          <div className="flex-1 min-w-0 space-y-3">

            {!protocolId ? (
              <div className="card-clinical text-center py-16">
                <div className="w-14 h-14 bg-navy-800/5 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">
                  📋
                </div>
                <p className="text-sm text-navy-800/50 mb-4">
                  Select or create a protocol to begin building your triage template
                </p>
                <button onClick={() => setShowNewProtocol(true)} className="btn-primary px-6">
                  Create protocol
                </button>
              </div>
            ) : (
              <>
                {/* Tabs */}
                <div className="flex gap-1.5">
                  {([
                    { id: 'build',   label: `Build (${questions.length})` },
                    { id: 'poc',     label: '🛡 POC Gate' },
                    { id: 'preview', label: '👁 Preview' },
                  ] as const).map(t => (
                    <button key={t.id} onClick={() => setTab(t.id as any)}
                      className={`px-4 py-2 rounded-xl text-xs font-medium border transition-all
                        ${tab === t.id
                          ? 'bg-navy-800 text-white border-navy-800'
                          : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* ── BUILD TAB ── */}
                {tab === 'build' && (
                  <div
                    className="space-y-2 min-h-32"
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleDropFromPalette}
                  >
                    {questions.length === 0 && (
                      <div className="border-2 border-dashed border-navy-800/15 rounded-2xl py-16
                                      flex flex-col items-center justify-center text-center">
                        <div className="text-4xl mb-3">📋</div>
                        <p className="text-sm text-navy-800/40 mb-1">No fields yet</p>
                        <p className="text-xs text-navy-800/30">
                          Click a field type on the left, or drag it here
                        </p>
                      </div>
                    )}

                    {questions.map((q, idx) => (
                      <div
                        key={q.id}
                        draggable
                        onDragStart={e => handleDragStart(e, idx)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => handleDrop(e, idx)}
                        className={`card-clinical cursor-grab active:cursor-grabbing
                          ${q.question_type === 'section_header'
                            ? 'bg-navy-800/4 border-navy-800/10'
                            : 'bg-white'}`}
                      >
                        {/* Question header row */}
                        <div className="flex items-center gap-2">
                          {/* Drag handle */}
                          <div className="text-navy-800/20 hover:text-navy-800/40 flex-shrink-0 cursor-grab">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                              <rect x="2" y="2" width="3" height="3" rx="1"/>
                              <rect x="9" y="2" width="3" height="3" rx="1"/>
                              <rect x="2" y="9" width="3" height="3" rx="1"/>
                              <rect x="9" y="9" width="3" height="3" rx="1"/>
                            </svg>
                          </div>

                          <span className="data-label w-5 flex-shrink-0 text-center">{idx + 1}</span>

                          {q.question_type === 'section_header' ? (
                            <input
                              type="text"
                              value={q.question_text}
                              onChange={e => updateQ(q.id, { question_text: e.target.value })}
                              placeholder="Section heading..."
                              className="flex-1 font-semibold text-sm text-navy-800 bg-transparent border-0 outline-none placeholder:text-navy-800/30"
                            />
                          ) : (
                            <input
                              type="text"
                              value={q.question_text}
                              onChange={e => updateQ(q.id, { question_text: e.target.value })}
                              placeholder="Question text..."
                              className="flex-1 input-clinical text-sm py-2"
                            />
                          )}

                          {/* Type badge */}
                          <span className="text-2xs text-navy-800/40 flex-shrink-0 hidden sm:block">
                            {Q_TYPES.find(t => t.value === q.question_type)?.icon}
                            {' '}
                            {Q_TYPES.find(t => t.value === q.question_type)?.label}
                          </span>

                          <button onClick={() => setExpandedQ(expandedQ === q.id ? null : q.id)}
                            className="text-navy-800/40 hover:text-navy-800 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-navy-800/5 transition-all text-lg">
                            {expandedQ === q.id ? '−' : '+'}
                          </button>
                          <button onClick={() => removeQ(q.id)}
                            className="text-red-300 hover:text-red-500 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 transition-all">
                            ✕
                          </button>
                        </div>

                        {/* Expanded settings */}
                        {expandedQ === q.id && q.question_type !== 'section_header' && (
                          <div className="space-y-3 pt-3 mt-3 border-t border-navy-800/8">

                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="data-label block mb-1">Type</label>
                                <select value={q.question_type}
                                  onChange={e => updateQ(q.id, { question_type: e.target.value as any })}
                                  className="input-clinical text-sm py-1.5">
                                  {Q_TYPES.filter(t => t.value !== 'section_header').map(t => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="data-label block mb-1">Section</label>
                                <input type="text" value={q.section || ''}
                                  onChange={e => updateQ(q.id, { section: e.target.value || null })}
                                  placeholder="e.g. Cardiac Hx"
                                  className="input-clinical text-sm py-1.5" />
                              </div>
                              <div>
                                <label className="data-label block mb-1">Unit</label>
                                <input type="text" value={q.unit || ''}
                                  onChange={e => updateQ(q.id, { unit: e.target.value || null })}
                                  placeholder="mmHg / kg / bpm"
                                  className="input-clinical text-sm py-1.5" />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="data-label block mb-1">Help text (shown to patient)</label>
                                <input type="text" value={q.help_text || ''}
                                  onChange={e => updateQ(q.id, { help_text: e.target.value || null })}
                                  placeholder="Additional guidance..."
                                  className="input-clinical text-sm py-1.5" />
                              </div>
                              <div className="flex items-center gap-2 pt-5">
                                <input type="checkbox" id={`req-${q.id}`} checked={q.is_required}
                                  onChange={e => updateQ(q.id, { is_required: e.target.checked })}
                                  className="w-4 h-4 accent-navy-800" />
                                <label htmlFor={`req-${q.id}`} className="text-sm text-navy-800">Required</label>
                              </div>
                            </div>

                            {/* Options for choice types */}
                            {(q.question_type === 'single_choice' || q.question_type === 'multi_choice') && (
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <label className="data-label">Answer options</label>
                                  <button onClick={() => addOption(q.id)}
                                    className="text-xs text-navy-800 font-semibold hover:underline">
                                    + Add option
                                  </button>
                                </div>
                                <div className="space-y-1.5">
                                  {q.options.map((opt, oi) => (
                                    <div key={oi} className="flex gap-2">
                                      <input type="text" value={opt.label}
                                        onChange={e => updateOption(q.id, oi, e.target.value)}
                                        placeholder={`Option ${oi + 1}`}
                                        className="input-clinical text-sm py-1.5 flex-1" />
                                      <button onClick={() => removeOption(q.id, oi)}
                                        className="text-red-300 hover:text-red-500 px-2">✕</button>
                                    </div>
                                  ))}
                                  {q.options.length === 0 && (
                                    <p className="text-xs text-navy-800/40 italic">No options yet — add at least 2</p>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Scale range */}
                            {q.question_type === 'scale' && (
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="data-label block mb-1">Min value</label>
                                  <input type="number" value={q.min_value ?? 1}
                                    onChange={e => updateQ(q.id, { min_value: parseInt(e.target.value) })}
                                    className="input-clinical text-sm py-1.5" />
                                </div>
                                <div>
                                  <label className="data-label block mb-1">Max value</label>
                                  <input type="number" value={q.max_value ?? 10}
                                    onChange={e => updateQ(q.id, { max_value: parseInt(e.target.value) })}
                                    className="input-clinical text-sm py-1.5" />
                                </div>
                              </div>
                            )}

                            {/* Red flag rules */}
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <label className="data-label flex items-center gap-1.5">
                                  <span className="text-red-400">🚩</span> Red flag rules
                                </label>
                                <button onClick={() => addRedFlagRule(q.id)}
                                  className="text-xs text-red-500 hover:text-red-600 font-semibold">
                                  + Add rule
                                </button>
                              </div>
                              {q.red_flag_rules.length === 0 && (
                                <p className="text-xs text-navy-800/35 italic">
                                  No rules — this question won't trigger alerts
                                </p>
                              )}
                              {q.red_flag_rules.map((rule, ri) => (
                                <div key={ri} className="grid grid-cols-12 gap-1.5 mb-2 items-center">
                                  <select value={rule.operator}
                                    onChange={e => updateRedFlag(q.id, ri, 'operator', e.target.value)}
                                    className="input-clinical text-xs py-1.5 col-span-2">
                                    {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </select>
                                  <input type="text" value={rule.value}
                                    onChange={e => updateRedFlag(q.id, ri, 'value', e.target.value)}
                                    placeholder="value"
                                    className="input-clinical text-xs py-1.5 col-span-2" />
                                  <select value={rule.level}
                                    onChange={e => updateRedFlag(q.id, ri, 'level', e.target.value)}
                                    className="input-clinical text-xs py-1.5 col-span-3">
                                    {FLAG_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                  </select>
                                  <input type="text" value={rule.message}
                                    onChange={e => updateRedFlag(q.id, ri, 'message', e.target.value)}
                                    placeholder="Alert message for POC / doctor"
                                    className="input-clinical text-xs py-1.5 col-span-4" />
                                  <button onClick={() => removeRedFlag(q.id, ri)}
                                    className="text-red-300 hover:text-red-500 text-xs col-span-1 text-center">✕</button>
                                </div>
                              ))}
                            </div>

                          </div>
                        )}
                      </div>
                    ))}

                    {/* Drop zone hint at bottom */}
                    {questions.length > 0 && (
                      <div
                        className="border-2 border-dashed border-navy-800/10 rounded-xl py-4
                                   text-xs text-navy-800/30 text-center hover:border-navy-800/25 transition-all"
                        onDragOver={e => e.preventDefault()}
                        onDrop={handleDropFromPalette}
                      >
                        Drop a field here to add at end
                      </div>
                    )}

                    {questions.length > 0 && (
                      <button onClick={handleSave} disabled={isPending}
                        className="btn-primary w-full mt-1">
                        {isPending ? 'Saving...' : `Save protocol (${questions.length} fields)`}
                      </button>
                    )}
                  </div>
                )}

                {/* ── POC GATE TAB ── */}
                {tab === 'poc' && (
                  <form onSubmit={handleSavePoc} className="space-y-4">

                    <div className="rounded-2xl bg-navy-800/4 border border-navy-800/8 p-4">
                      <div className="font-bold text-navy-800 text-sm mb-1">
                        🛡 Point of Contact (POC) Gate
                      </div>
                      <p className="text-xs text-navy-800/60 leading-relaxed">
                        The Virtual Triage Nurse never makes final decisions.
                        Every completed triage goes to a designated POC for human review
                        before the case reaches the doctor. Critical and time-sensitive
                        answers alert the POC in real time via WhatsApp.
                      </p>
                    </div>

                    <div className="card-clinical space-y-4">
                      <div className="data-label">POC contact details</div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="data-label block mb-1.5">POC name / role</label>
                          <input type="text" value={poc.poc_name}
                            onChange={e => setPoc(p => ({ ...p, poc_name: e.target.value }))}
                            placeholder="e.g. Clinic Coordinator"
                            className="input-clinical" />
                        </div>
                        <div>
                          <label className="data-label block mb-1.5">POC WhatsApp mobile</label>
                          <input type="tel" value={poc.poc_mobile}
                            onChange={e => setPoc(p => ({ ...p, poc_mobile: e.target.value }))}
                            placeholder="9876543210"
                            className="input-clinical" />
                          <p className="text-2xs text-navy-800/40 mt-1">
                            Receives real-time flag alerts + every completed triage summary
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="card-clinical space-y-4">
                      <div className="data-label">Alert settings</div>

                      <div>
                        <label className="data-label block mb-2">Alert POC when triage has</label>
                        <div className="space-y-2">
                          {[
                            { value: 'urgent',               label: '🔴 Urgent flags only (minimum)' },
                            { value: 'urgent,needs_review',  label: '🔴🟡 Urgent + needs review (recommended)' },
                            { value: 'all',                  label: '📋 Every completed triage' },
                          ].map(opt => (
                            <label key={opt.value}
                              className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border transition-all
                                         hover:border-navy-800/30 hover:bg-navy-50
                                         border-navy-800/10 bg-white">
                              <input type="radio" name="poc_alert_on" value={opt.value}
                                checked={poc.poc_alert_on === opt.value}
                                onChange={e => setPoc(p => ({ ...p, poc_alert_on: e.target.value }))}
                                className="mt-0.5 accent-navy-800" />
                              <span className="text-sm text-navy-800">{opt.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-navy-800/8">
                        <div>
                          <div className="text-sm font-medium text-navy-800">Require POC review before doctor sees triage</div>
                          <div className="text-xs text-navy-800/50 mt-0.5 leading-relaxed">
                            When ON: triage stays in "Pending review" state until POC marks it reviewed. Doctor sees it after that.
                          </div>
                        </div>
                        <button type="button"
                          onClick={() => setPoc(p => ({ ...p, review_required: !p.review_required }))}
                          className={`w-11 h-6 rounded-full transition-all relative flex-shrink-0 ml-4
                            ${poc.review_required ? 'bg-navy-800' : 'bg-gray-300'}`}>
                          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow
                                           transition-all duration-200
                                           ${poc.review_required ? 'left-5' : 'left-0.5'}`} />
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl bg-amber-50 border border-amber-200/60 p-3">
                      <p className="text-xs text-amber-800 leading-relaxed">
                        <strong>Clinical safety note:</strong> The triage agent handles administrative screening only.
                        Critical, urgent, or clinically complex answers always route to the POC immediately.
                        The POC must review before cases reach the doctor — the AI never owns the final clinical decision.
                      </p>
                    </div>

                    <button type="submit" disabled={isPending || !poc.poc_mobile.trim()}
                      className="btn-primary w-full">
                      {isPending ? 'Saving...' : 'Save POC settings'}
                    </button>
                  </form>
                )}

                {/* ── PREVIEW TAB ── */}
                {tab === 'preview' && (
                  <div className="space-y-3">
                    <div className="bg-amber-50 border border-amber-200/60 rounded-xl px-4 py-2.5 text-xs text-amber-700">
                      Preview mode — test your branching logic. Answers here are not saved.
                    </div>
                    {previewVisible.length === 0 && (
                      <div className="card-clinical text-center py-8 text-sm text-navy-800/40">
                        Add questions in the Build tab to preview them here
                      </div>
                    )}
                    {previewVisible.map((q, idx) => (
                      <div key={q.id} className="card-clinical space-y-3">
                        <div className="text-sm font-medium text-navy-800">
                          {idx + 1}. {q.question_text}
                          {q.is_required && <span className="text-red-400 ml-1">*</span>}
                        </div>
                        {q.question_type === 'yes_no' && (
                          <div className="flex gap-2">
                            {['yes', 'no'].map(v => (
                              <button key={v}
                                onClick={() => setPreviewAnswers(p => ({ ...p, [q.id]: v }))}
                                className={`px-5 py-2.5 rounded-xl border text-sm transition-all
                                  ${previewAnswers[q.id] === v
                                    ? 'bg-navy-800 text-white border-navy-800'
                                    : 'border-navy-800/20 text-navy-800/60 hover:border-navy-800/40'}`}>
                                {v === 'yes' ? 'Yes' : 'No'}
                              </button>
                            ))}
                          </div>
                        )}
                        {q.question_type === 'single_choice' && (
                          <div className="flex flex-wrap gap-2">
                            {q.options.map(o => (
                              <button key={o.value}
                                onClick={() => setPreviewAnswers(p => ({ ...p, [q.id]: o.value }))}
                                className={`px-3 py-2 rounded-xl border text-xs transition-all
                                  ${previewAnswers[q.id] === o.value
                                    ? 'bg-navy-800 text-white border-navy-800'
                                    : 'border-navy-800/20 text-navy-800/60 hover:border-navy-800/40'}`}>
                                {o.label}
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Red flag preview */}
                        {q.red_flag_rules.length > 0 && previewAnswers[q.id] && (
                          <div className="text-xs space-y-1">
                            {q.red_flag_rules
                              .filter(r => r.operator === 'eq' && previewAnswers[q.id]?.toLowerCase() === r.value.toLowerCase())
                              .map((r, i) => (
                                <div key={i} className={`px-3 py-1.5 rounded-lg font-medium
                                  ${r.level === 'urgent' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                                  {r.level === 'urgent' ? '🔴' : '🟡'} {r.message}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {previewVisible.length > 0 && (
                      <button onClick={() => setPreviewAnswers({})}
                        className="btn-secondary w-full text-sm">Reset preview</button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* ── New protocol modal ── */}
      {showNewProtocol && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center px-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-4">Create triage protocol</h2>
            <form onSubmit={handleCreateProtocol} className="space-y-4">
              <div>
                <label className="data-label block mb-1.5">Protocol name</label>
                <input type="text" value={newProtocol.name}
                  onChange={e => setNewProtocol(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Pre-angioplasty Assessment"
                  className="input-clinical" autoFocus required />
                <p className="text-2xs text-navy-800/40 mt-1">
                  Name it specifically — different procedures need different protocols.
                </p>
              </div>
              <div>
                <label className="data-label block mb-1.5">Protocol type</label>
                <select value={newProtocol.protocol_type}
                  onChange={e => setNewProtocol(p => ({ ...p, protocol_type: e.target.value }))}
                  className="input-clinical">
                  {PROTOCOL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="data-label block mb-1.5">Start from template (optional)</label>
                <select value={newProtocol.template_id}
                  onChange={e => setNewProtocol(p => ({ ...p, template_id: e.target.value }))}
                  className="input-clinical">
                  <option value="">Blank protocol</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <p className="text-2xs text-navy-800/40 mt-1">
                  Templates are pre-loaded with specialty-appropriate questions.
                  You can add, remove, or reorder any field after creation.
                </p>
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={isPending || !newProtocol.name.trim()}
                  className="btn-primary flex-1">
                  {isPending ? 'Creating...' : 'Create protocol'}
                </button>
                <button type="button" onClick={() => setShowNewProtocol(false)}
                  className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Send triage modal ── */}
      {showSendTriage && protocolId && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center px-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-1">Send triage to patient</h2>
            <p className="text-sm text-navy-800/55 mb-4 leading-relaxed">
              Creates a secure 24-hour triage link.
              If you add a WhatsApp number, the link is sent to the patient automatically.
            </p>
            <form onSubmit={handleSendTriage} className="space-y-4">
              <div>
                <label className="data-label block mb-1.5">Patient name</label>
                <input type="text" value={triageForm.patient_name}
                  onChange={e => setTriageForm(p => ({ ...p, patient_name: e.target.value }))}
                  placeholder="Full name" className="input-clinical" autoFocus required />
              </div>
              <div>
                <label className="data-label block mb-1.5">Patient WhatsApp (optional)</label>
                <input type="tel" value={triageForm.patient_mobile}
                  onChange={e => setTriageForm(p => ({ ...p, patient_mobile: e.target.value }))}
                  placeholder="9876543210" className="input-clinical" />
              </div>
              <div className="rounded-xl bg-navy-50 px-3 py-2.5 text-xs text-navy-800/60 leading-relaxed">
                Patient will fill the triage questionnaire in their preferred language (English, Hindi, Telugu, Kannada, Marathi, or Bengali). Completed responses go to your POC for review before reaching you.
              </div>
              <div className="flex gap-3">
                <button type="submit"
                  disabled={isPending || !triageForm.patient_name.trim()}
                  className="btn-primary flex-1">
                  {isPending ? 'Creating...' : triageForm.patient_mobile ? 'Send via WhatsApp' : 'Create & copy link'}
                </button>
                <button type="button" onClick={() => setShowSendTriage(false)}
                  className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
