'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  createProtocolAction,
  updateProtocolAction,
  deleteProtocolAction,
  saveQuestionsAction,
  createTriageSessionAction,
} from '@/app/actions/triage'
import { resolveVisibleQuestions, type TriageQuestion } from '@/lib/ai/triage-engine'

const Q_TYPES = [
  { value: 'yes_no',       label: 'Yes / No' },
  { value: 'single_choice',label: 'Single choice' },
  { value: 'multi_choice', label: 'Multiple choice' },
  { value: 'text',         label: 'Free text' },
  { value: 'number',       label: 'Number' },
  { value: 'scale',        label: 'Scale (1–10)' },
  { value: 'vitals_bp',    label: 'Blood pressure' },
  { value: 'vitals_single',label: 'Single vital' },
  { value: 'date',         label: 'Date' },
  { value: 'section_header',label: 'Section heading' },
]

const PROTOCOL_TYPES = [
  { value: 'new_patient',    label: 'New OPD patient' },
  { value: 'pre_procedure',  label: 'Pre-procedure' },
  { value: 'follow_up',      label: 'Follow-up visit' },
  { value: 'emergency_walkIn',label: 'Emergency walk-in' },
  { value: 'post_procedure', label: 'Post-procedure' },
  { value: 'general',        label: 'General' },
]

const FLAG_LEVELS = [
  { value: 'needs_review', label: 'Needs review (amber)' },
  { value: 'urgent',       label: 'Urgent (red)' },
]

const OPERATORS = [
  { value: 'eq',       label: 'equals' },
  { value: 'not_eq',   label: 'does not equal' },
  { value: 'gt',       label: 'greater than' },
  { value: 'gte',      label: 'greater than or equal' },
  { value: 'lt',       label: 'less than' },
  { value: 'lte',      label: 'less than or equal' },
  { value: 'contains', label: 'contains' },
]

type Protocol = { id: string; name: string; protocol_type: string; is_active: boolean; is_default: boolean; version: number; created_at: string }
type Template = { id: string; specialty: string; name: string; description: string; protocol_type: string }

function blankQuestion(sortOrder: number): TriageQuestion {
  return {
    id: `new-${Date.now()}-${sortOrder}`,
    question_text: '',
    question_type: 'yes_no',
    options: [],
    is_required: false,
    sort_order: sortOrder,
    section: null,
    help_text: null,
    unit: null,
    min_value: null,
    max_value: null,
    branch_logic: [],
    red_flag_rules: [],
  }
}

export default function ProtocolBuilderClient({
  specialist, protocols, selectedProtocol, questions: initialQuestions, templates,
}: {
  specialist: { id: string; name: string; specialty: string; role: string }
  protocols: Protocol[]
  selectedProtocol: any | null
  questions: any[]
  templates: Template[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [questions, setQuestions] = useState<TriageQuestion[]>(
    initialQuestions.map(q => ({
      ...q,
      options: q.options || [],
      branch_logic: q.branch_logic || [],
      red_flag_rules: q.red_flag_rules || [],
    }))
  )

  const [expandedQ, setExpandedQ] = useState<string | null>(null)
  const [showNewProtocol, setShowNewProtocol] = useState(false)
  const [showSendTriage, setShowSendTriage] = useState(false)
  const [newProtocol, setNewProtocol] = useState({ name: '', protocol_type: 'new_patient', template_id: '' })
  const [triageForm, setTriageForm] = useState({ patient_name: '', patient_mobile: '' })
  const [previewMode, setPreviewMode] = useState(false)
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, string>>({})

  const protocolId = selectedProtocol?.id ?? null

  // ── Question CRUD ──────────────────────────────
  function addQuestion() {
    const newQ = blankQuestion(questions.length + 1)
    setQuestions(prev => [...prev, newQ])
    setExpandedQ(newQ.id)
  }

  function updateQ(id: string, updates: Partial<TriageQuestion>) {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, ...updates } : q))
  }

  function removeQ(id: string) {
    setQuestions(prev => prev.filter(q => q.id !== id).map((q, i) => ({ ...q, sort_order: i + 1 })))
  }

  function moveQ(id: string, dir: 'up' | 'down') {
    setQuestions(prev => {
      const idx = prev.findIndex(q => q.id === id)
      if (dir === 'up' && idx === 0) return prev
      if (dir === 'down' && idx === prev.length - 1) return prev
      const arr = [...prev]
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1
      ;[arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]]
      return arr.map((q, i) => ({ ...q, sort_order: i + 1 }))
    })
  }

  function addOption(qId: string) {
    updateQ(qId, {
      options: [...(questions.find(q => q.id === qId)?.options || []),
        { value: `option${Date.now()}`, label: '' }]
    })
  }

  function updateOption(qId: string, idx: number, label: string) {
    const q = questions.find(q => q.id === qId)
    if (!q) return
    const opts = [...q.options]
    opts[idx] = { ...opts[idx], label, value: label.toLowerCase().replace(/\s+/g, '_') }
    updateQ(qId, { options: opts })
  }

  function removeOption(qId: string, idx: number) {
    const q = questions.find(q => q.id === qId)
    if (!q) return
    updateQ(qId, { options: q.options.filter((_, i) => i !== idx) })
  }

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

  // ── Save questions ─────────────────────────────
  async function handleSave() {
    if (!protocolId) return
    const validQs = questions.filter(q => q.question_text.trim() || q.question_type === 'section_header')
    startTransition(async () => {
      const result = await saveQuestionsAction(protocolId, validQs)
      if (result?.error) toast.error(result.error)
      else toast.success(`Protocol saved — ${result.count} questions`)
    })
  }

  // ── Create new protocol ────────────────────────
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
      setNewProtocol({ name: '', protocol_type: 'new_patient', template_id: '' })
      router.push(`/triage/builder?protocol=${result.id}`)
    })
  }

  // ── Send triage session ────────────────────────
  async function handleSendTriage(e: React.FormEvent) {
    e.preventDefault()
    if (!protocolId || !triageForm.patient_name.trim()) return
    startTransition(async () => {
      const result = await createTriageSessionAction(
        protocolId, triageForm.patient_name, triageForm.patient_mobile
      )
      if (result?.error) { toast.error(result.error); return }
      toast.success('Triage link created')
      setShowSendTriage(false)
      // Copy link to clipboard
      if (result.url) {
        navigator.clipboard.writeText(result.url)
        toast.success('Link copied to clipboard')
      }
    })
  }

  // ── Preview visible questions ──────────────────
  const previewVisible = previewMode
    ? resolveVisibleQuestions(questions, previewAnswers).filter(q => q.question_type !== 'section_header')
    : []

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1">Triage protocol builder</span>
          {protocolId && (
            <div className="flex gap-2">
              <button
                onClick={() => setPreviewMode(!previewMode)}
                className={`text-xs font-medium px-3 py-1.5 rounded-xl border transition-all
                  ${previewMode ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}
              >
                {previewMode ? 'Exit preview' : 'Preview'}
              </button>
              <button
                onClick={() => setShowSendTriage(true)}
                className="text-xs font-medium px-3 py-1.5 rounded-xl bg-forest-700 text-white hover:bg-forest-800 transition-all"
              >
                Send triage
              </button>
              <button
                onClick={handleSave}
                disabled={isPending}
                className="btn-primary text-xs py-1.5 px-4"
              >
                {isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

          {/* Left: Protocol list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="data-label">My protocols</div>
              <button
                onClick={() => setShowNewProtocol(true)}
                className="text-xs font-medium text-forest-700 hover:text-forest-800 transition-colors"
              >
                + New
              </button>
            </div>

            {protocols.map(p => (
              <button
                key={p.id}
                onClick={() => router.push(`/triage/builder?protocol=${p.id}`)}
                className={`w-full text-left card-clinical p-3 transition-all hover:shadow-clinical-md
                  ${p.id === protocolId ? 'border-navy-800/40 bg-navy-50' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-navy-800 truncate">{p.name}</div>
                    <div className="text-xs text-navy-800/50 mt-0.5 capitalize">
                      {p.protocol_type.replace(/_/g, ' ')}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 items-end flex-shrink-0">
                    {p.is_active && (
                      <span className="text-2xs bg-forest-50 text-forest-700 px-1.5 py-0.5 rounded-full font-medium">Active</span>
                    )}
                    {p.is_default && (
                      <span className="text-2xs bg-navy-50 text-navy-800/60 px-1.5 py-0.5 rounded-full">Default</span>
                    )}
                  </div>
                </div>
              </button>
            ))}

            {protocols.length === 0 && (
              <div className="card-clinical text-center py-6">
                <p className="text-xs text-navy-800/40 mb-3">No protocols yet</p>
                <button onClick={() => setShowNewProtocol(true)} className="text-xs text-navy-800 font-medium hover:underline">
                  Create your first protocol
                </button>
              </div>
            )}

            {/* Sessions link */}
            <button
              onClick={() => router.push('/triage/sessions')}
              className="w-full text-xs text-navy-800/50 hover:text-navy-800/70 transition-colors text-center py-2"
            >
              View triage sessions →
            </button>
          </div>

          {/* Right: Question editor or preview */}
          <div className="md:col-span-2 space-y-3">
            {!protocolId ? (
              <div className="card-clinical text-center py-10">
                <div className="w-10 h-10 bg-navy-800/5 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-navy-800/40">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <p className="text-sm text-navy-800/50 mb-3">Select a protocol to edit its questions</p>
                <button onClick={() => setShowNewProtocol(true)} className="btn-primary text-sm py-2 px-5">
                  Create protocol
                </button>
              </div>
            ) : previewMode ? (
              // Preview mode
              <div className="space-y-3">
                <div className="bg-amber-50 border border-amber-200/60 rounded-xl px-4 py-2.5 text-xs text-amber-700">
                  Preview mode — answering questions to test branching logic
                </div>
                {previewVisible.map((q, idx) => (
                  <div key={q.id} className="card-clinical space-y-2">
                    <div className="text-sm font-medium text-navy-800">{idx + 1}. {q.question_text}</div>
                    {q.question_type === 'yes_no' && (
                      <div className="flex gap-2">
                        {['yes','no'].map(v => (
                          <button key={v} onClick={() => setPreviewAnswers(p => ({ ...p, [q.id]: v }))}
                            className={`px-4 py-2 rounded-xl border text-xs transition-all
                              ${previewAnswers[q.id] === v ? 'bg-navy-800 text-white border-navy-800' : 'border-navy-800/20 text-navy-800/60'}`}>
                            {v === 'yes' ? 'Yes' : 'No'}
                          </button>
                        ))}
                      </div>
                    )}
                    {q.question_type === 'single_choice' && (
                      <div className="flex flex-wrap gap-1.5">
                        {q.options.map(o => (
                          <button key={o.value} onClick={() => setPreviewAnswers(p => ({ ...p, [q.id]: o.value }))}
                            className={`px-3 py-1.5 rounded-xl border text-xs transition-all
                              ${previewAnswers[q.id] === o.value ? 'bg-navy-800 text-white border-navy-800' : 'border-navy-800/20 text-navy-800/60'}`}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {q.red_flag_rules.length > 0 && previewAnswers[q.id] && (
                      <div className="text-xs text-red-500">
                        {q.red_flag_rules
                          .filter(r => {
                            const a = previewAnswers[q.id]?.toLowerCase()
                            return r.operator === 'eq' && a === r.value.toLowerCase()
                          })
                          .map((r, i) => <div key={i}>🚩 {r.message}</div>)
                        }
                      </div>
                    )}
                  </div>
                ))}
                <button onClick={() => { setPreviewMode(false); setPreviewAnswers({}) }}
                  className="btn-secondary w-full text-sm py-2.5">
                  Exit preview
                </button>
              </div>
            ) : (
              // Edit mode
              <>
                {questions.map((q, idx) => (
                  <div key={q.id} className="card-clinical">
                    {/* Question header */}
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => moveQ(q.id, 'up')} disabled={idx === 0}
                          className="text-navy-800/30 hover:text-navy-800/60 disabled:opacity-20 text-xs leading-none">▲</button>
                        <button onClick={() => moveQ(q.id, 'down')} disabled={idx === questions.length - 1}
                          className="text-navy-800/30 hover:text-navy-800/60 disabled:opacity-20 text-xs leading-none">▼</button>
                      </div>
                      <span className="data-label w-5 flex-shrink-0">{idx + 1}</span>
                      <input
                        type="text"
                        value={q.question_text}
                        onChange={e => updateQ(q.id, { question_text: e.target.value })}
                        placeholder={q.question_type === 'section_header' ? 'Section name...' : 'Question text...'}
                        className="flex-1 input-clinical text-sm py-2"
                      />
                      <button
                        onClick={() => setExpandedQ(expandedQ === q.id ? null : q.id)}
                        className="text-navy-800/40 hover:text-navy-800 transition-colors text-lg px-1"
                      >
                        {expandedQ === q.id ? '−' : '+'}
                      </button>
                      <button onClick={() => removeQ(q.id)}
                        className="text-red-400 hover:text-red-600 transition-colors text-sm px-1">✕</button>
                    </div>

                    {/* Expanded settings */}
                    {expandedQ === q.id && (
                      <div className="space-y-3 pt-3 border-t border-navy-800/8 animate-fade-in">

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="data-label block mb-1">Question type</label>
                            <select value={q.question_type}
                              onChange={e => updateQ(q.id, { question_type: e.target.value as any })}
                              className="input-clinical text-sm py-2">
                              {Q_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="data-label block mb-1">Section</label>
                            <input type="text" value={q.section || ''}
                              onChange={e => updateQ(q.id, { section: e.target.value || null })}
                              placeholder="e.g. Cardiac History"
                              className="input-clinical text-sm py-2" />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="data-label block mb-1">Unit (optional)</label>
                            <input type="text" value={q.unit || ''}
                              onChange={e => updateQ(q.id, { unit: e.target.value || null })}
                              placeholder="mmHg, kg, bpm..."
                              className="input-clinical text-sm py-2" />
                          </div>
                          <div className="flex items-center gap-2 pt-5">
                            <input type="checkbox" id={`req-${q.id}`} checked={q.is_required}
                              onChange={e => updateQ(q.id, { is_required: e.target.checked })}
                              className="w-4 h-4" />
                            <label htmlFor={`req-${q.id}`} className="text-sm text-navy-800">Required</label>
                          </div>
                        </div>

                        <div>
                          <label className="data-label block mb-1">Help text (shown to patient)</label>
                          <input type="text" value={q.help_text || ''}
                            onChange={e => updateQ(q.id, { help_text: e.target.value || null })}
                            placeholder="Additional guidance for the patient..."
                            className="input-clinical text-sm py-2" />
                        </div>

                        {/* Options for choice types */}
                        {(q.question_type === 'single_choice' || q.question_type === 'multi_choice') && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="data-label">Answer options</label>
                              <button onClick={() => addOption(q.id)}
                                className="text-xs text-forest-700 hover:text-forest-800 font-medium">+ Add option</button>
                            </div>
                            <div className="space-y-1.5">
                              {q.options.map((opt, oi) => (
                                <div key={oi} className="flex gap-2">
                                  <input type="text" value={opt.label}
                                    onChange={e => updateOption(q.id, oi, e.target.value)}
                                    placeholder={`Option ${oi + 1}`}
                                    className="input-clinical text-sm py-2 flex-1" />
                                  <button onClick={() => removeOption(q.id, oi)}
                                    className="text-red-400 hover:text-red-600 text-sm px-2">✕</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Red flag rules */}
                        {q.question_type !== 'section_header' && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="data-label">Red flag rules</label>
                              <button onClick={() => addRedFlagRule(q.id)}
                                className="text-xs text-red-500 hover:text-red-600 font-medium">+ Add rule</button>
                            </div>
                            {q.red_flag_rules.map((rule, ri) => (
                              <div key={ri} className="grid grid-cols-4 gap-1.5 mb-2">
                                <select value={rule.operator}
                                  onChange={e => updateRedFlag(q.id, ri, 'operator', e.target.value)}
                                  className="input-clinical text-xs py-1.5 col-span-1">
                                  {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                                <input type="text" value={rule.value}
                                  onChange={e => updateRedFlag(q.id, ri, 'value', e.target.value)}
                                  placeholder="value"
                                  className="input-clinical text-xs py-1.5 col-span-1" />
                                <select value={rule.level}
                                  onChange={e => updateRedFlag(q.id, ri, 'level', e.target.value)}
                                  className="input-clinical text-xs py-1.5 col-span-1">
                                  {FLAG_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                </select>
                                <div className="flex gap-1">
                                  <input type="text" value={rule.message}
                                    onChange={e => updateRedFlag(q.id, ri, 'message', e.target.value)}
                                    placeholder="Alert message"
                                    className="input-clinical text-xs py-1.5 flex-1" />
                                  <button onClick={() => removeRedFlag(q.id, ri)}
                                    className="text-red-400 text-xs px-1">✕</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                ))}

                {/* Add question */}
                <button onClick={addQuestion}
                  className="w-full border-2 border-dashed border-navy-800/15 rounded-xl
                             py-4 text-sm text-navy-800/50 hover:border-navy-800/30
                             hover:text-navy-800/70 transition-colors">
                  + Add question
                </button>

                {questions.length > 0 && (
                  <button onClick={handleSave} disabled={isPending}
                    className="btn-primary w-full">
                    {isPending ? 'Saving...' : `Save protocol (${questions.length} questions)`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* New protocol modal */}
      {showNewProtocol && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-4">Create protocol</h2>
            <form onSubmit={handleCreateProtocol} className="space-y-4">
              <div>
                <label className="data-label block mb-1.5">Protocol name</label>
                <input type="text" value={newProtocol.name}
                  onChange={e => setNewProtocol(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Pre-angioplasty Assessment"
                  className="input-clinical" autoFocus required />
              </div>
              <div>
                <label className="data-label block mb-1.5">Type</label>
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
                <p className="text-xs text-navy-800/40 mt-1">
                  Templates are pre-loaded with clinically appropriate questions for your specialty.
                  You can add, remove, or modify any question after creation.
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

      {/* Send triage modal */}
      {showSendTriage && protocolId && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-2">Send triage to patient</h2>
            <p className="text-sm text-navy-800/60 mb-4">A triage link will be created. If you add a mobile number, the link is sent via WhatsApp automatically.</p>
            <form onSubmit={handleSendTriage} className="space-y-4">
              <div>
                <label className="data-label block mb-1.5">Patient name</label>
                <input type="text" value={triageForm.patient_name}
                  onChange={e => setTriageForm(p => ({ ...p, patient_name: e.target.value }))}
                  placeholder="Full name" className="input-clinical" autoFocus required />
              </div>
              <div>
                <label className="data-label block mb-1.5">Patient mobile (for WhatsApp)</label>
                <input type="tel" value={triageForm.patient_mobile}
                  onChange={e => setTriageForm(p => ({ ...p, patient_mobile: e.target.value }))}
                  placeholder="9876543210" className="input-clinical" />
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={isPending || !triageForm.patient_name.trim()}
                  className="btn-primary flex-1">
                  {isPending ? 'Creating link...' : triageForm.patient_mobile ? 'Send via WhatsApp' : 'Create link (copy)'}
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
