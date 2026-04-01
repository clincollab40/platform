'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  createTemplateAction,
  saveTemplateSectionsAction,
} from '@/app/actions/transcription'

const CONSULT_TYPES = [
  { value: 'new_opd',       label: 'New OPD Consultation' },
  { value: 'follow_up',     label: 'Follow-up Visit' },
  { value: 'pre_procedure', label: 'Pre-procedure Assessment' },
  { value: 'procedure_note',label: 'Procedure Note' },
  { value: 'discharge',     label: 'Discharge Summary' },
  { value: 'emergency',     label: 'Emergency Consultation' },
  { value: 'teleconsult',   label: 'Teleconsultation' },
]

const SECTION_TYPES = [
  { value: 'history',              label: 'History' },
  { value: 'examination',          label: 'Examination' },
  { value: 'investigations',       label: 'Investigations' },
  { value: 'assessment',           label: 'Assessment / Diagnosis' },
  { value: 'plan',                 label: 'Management Plan' },
  { value: 'medications',          label: 'Medications' },
  { value: 'patient_instructions', label: 'Patient Instructions' },
  { value: 'follow_up',            label: 'Follow-up' },
  { value: 'procedure_details',    label: 'Procedure Details' },
  { value: 'risk_discussion',      label: 'Risk Discussion & Consent' },
  { value: 'custom',               label: 'Custom Section' },
]

type Template = {
  id: string; name: string; consultation_type: string; is_active: boolean
  is_default: boolean; specialty_context: string | null; sections: any[]
  patient_summary_preamble: string | null; patient_summary_closing: string | null
}
type Default = { id: string; specialty: string; consultation_type: string; name: string; description: string }

function blankSection(order: number): any {
  return {
    id: `sec_${Date.now()}_${order}`,
    type: 'history', label: '', sort_order: order,
    required: false, extraction_prompt: '',
    include_in_patient_summary: false, ai_hint: '',
  }
}

export default function TemplatesClient({
  specialist, templates, defaults,
}: {
  specialist: { id: string; name: string; specialty: string }
  templates: Template[]
  defaults: Default[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id || null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', consultation_type: 'new_opd', default_id: '' })
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  const selected = templates.find(t => t.id === selectedId)
  const [sections, setSections] = useState<any[]>(selected?.sections || [])
  const [preamble, setPreamble] = useState(selected?.patient_summary_preamble || '')
  const [closing, setClosing] = useState(selected?.patient_summary_closing || '')

  // When selection changes, update local state
  function selectTemplate(id: string) {
    const t = templates.find(x => x.id === id)
    setSelectedId(id)
    setSections(t?.sections || [])
    setPreamble(t?.patient_summary_preamble || '')
    setClosing(t?.patient_summary_closing || '')
    setExpandedSection(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.set('name', newForm.name)
    fd.set('consultation_type', newForm.consultation_type)
    if (newForm.default_id) fd.set('default_id', newForm.default_id)

    startTransition(async () => {
      const result = await createTemplateAction(fd)
      if (!result.ok) { toast.error(result.error); return }
      toast.success('Template created')
      setShowNew(false)
      setNewForm({ name: '', consultation_type: 'new_opd', default_id: '' })
      router.refresh()
      setSelectedId(result.value.id)
    })
  }

  async function handleSave() {
    if (!selectedId) return
    startTransition(async () => {
      const result = await saveTemplateSectionsAction(selectedId, sections)
      if (!result.ok) toast.error(result.error)
      else toast.success(`Template saved — ${sections.length} sections`)
    })
  }

  function addSection() {
    const s = blankSection(sections.length + 1)
    setSections(prev => [...prev, s])
    setExpandedSection(s.id)
  }

  function updateSection(id: string, field: string, val: any) {
    setSections(prev => prev.map(s => s.id === id ? { ...s, [field]: val } : s))
  }

  function removeSection(id: string) {
    setSections(prev => prev.filter(s => s.id !== id).map((s, i) => ({ ...s, sort_order: i + 1 })))
  }

  function moveSection(id: string, dir: 'up' | 'down') {
    setSections(prev => {
      const idx = prev.findIndex(s => s.id === id)
      if (dir === 'up' && idx === 0) return prev
      if (dir === 'down' && idx === prev.length - 1) return prev
      const arr = [...prev]
      const swap = dir === 'up' ? idx - 1 : idx + 1
      ;[arr[idx], arr[swap]] = [arr[swap], arr[idx]]
      return arr.map((s, i) => ({ ...s, sort_order: i + 1 }))
    })
  }

  const patientSections = sections.filter(s => s.include_in_patient_summary)

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/transcription')} className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1">Note templates</span>
          {selectedId && (
            <button onClick={handleSave} disabled={isPending}
              className="btn-primary text-xs py-1.5 px-4">
              {isPending ? 'Saving...' : 'Save template'}
            </button>
          )}
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

          {/* Left: Template list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="data-label">My templates</div>
              <button onClick={() => setShowNew(true)}
                className="text-xs font-medium text-forest-700 hover:text-forest-800 transition-colors">
                + New
              </button>
            </div>

            {templates.map(t => (
              <button key={t.id} onClick={() => selectTemplate(t.id)}
                className={`w-full text-left card-clinical p-3 transition-all hover:shadow-clinical-md
                  ${t.id === selectedId ? 'border-navy-800/40 bg-navy-50' : ''}`}>
                <div className="text-sm font-medium text-navy-800 truncate">{t.name}</div>
                <div className="text-xs text-navy-800/50 mt-0.5">
                  {CONSULT_TYPES.find(c => c.value === t.consultation_type)?.label || t.consultation_type}
                  {' · '}{(t.sections || []).length} sections
                </div>
                <div className="flex gap-1 mt-1.5">
                  {t.is_default && <span className="text-2xs bg-navy-50 text-navy-800/50 px-1.5 py-0.5 rounded">Default</span>}
                  {!t.is_active && <span className="text-2xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">Inactive</span>}
                </div>
              </button>
            ))}

            {templates.length === 0 && (
              <div className="card-clinical text-center py-6">
                <p className="text-xs text-navy-800/40 mb-3">No templates yet</p>
                <button onClick={() => setShowNew(true)}
                  className="text-xs text-navy-800 font-medium hover:underline">
                  Create your first template
                </button>
              </div>
            )}
          </div>

          {/* Right: Section editor */}
          <div className="md:col-span-2 space-y-3">
            {!selectedId ? (
              <div className="card-clinical text-center py-10">
                <p className="text-sm text-navy-800/50 mb-4">Select a template to edit its sections</p>
                <button onClick={() => setShowNew(true)} className="btn-primary">Create template</button>
              </div>
            ) : (
              <>
                {/* Section count info */}
                <div className="bg-purple-50 border border-purple-200/60 rounded-xl px-4 py-2.5">
                  <p className="text-xs text-purple-800/80 leading-relaxed">
                    Each section defines what the AI extracts from the consultation audio.
                    Sections marked <strong>"Include in patient summary"</strong> appear in the WhatsApp message sent to the patient.
                    <strong> {patientSections.length}</strong> of {sections.length} sections currently included.
                  </p>
                </div>

                {/* Sections */}
                {sections.map((sec, idx) => (
                  <div key={sec.id} className="card-clinical">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => moveSection(sec.id, 'up')} disabled={idx === 0}
                          className="text-navy-800/30 hover:text-navy-800/60 disabled:opacity-20 text-xs leading-none">▲</button>
                        <button onClick={() => moveSection(sec.id, 'down')} disabled={idx === sections.length - 1}
                          className="text-navy-800/30 hover:text-navy-800/60 disabled:opacity-20 text-xs leading-none">▼</button>
                      </div>
                      <span className="data-label w-5 flex-shrink-0">{idx + 1}</span>
                      <input type="text" value={sec.label}
                        onChange={e => updateSection(sec.id, 'label', e.target.value)}
                        placeholder="Section name..."
                        className="flex-1 input-clinical text-sm py-1.5" />
                      <div className="flex items-center gap-1.5">
                        {sec.include_in_patient_summary && (
                          <span className="text-2xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded">Patient</span>
                        )}
                        {sec.required && (
                          <span className="text-2xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">Required</span>
                        )}
                      </div>
                      <button onClick={() => setExpandedSection(expandedSection === sec.id ? null : sec.id)}
                        className="text-navy-800/40 hover:text-navy-800 transition-colors text-lg px-1">
                        {expandedSection === sec.id ? '−' : '+'}
                      </button>
                      <button onClick={() => removeSection(sec.id)}
                        className="text-red-400 hover:text-red-600 transition-colors text-sm px-1">✕</button>
                    </div>

                    {expandedSection === sec.id && (
                      <div className="space-y-3 pt-3 border-t border-navy-800/8">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="data-label block mb-1">Section type</label>
                            <select value={sec.type}
                              onChange={e => updateSection(sec.id, 'type', e.target.value)}
                              className="input-clinical text-sm py-1.5">
                              {SECTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                          </div>
                          <div className="flex flex-col gap-2 pt-4">
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="checkbox" checked={sec.required}
                                onChange={e => updateSection(sec.id, 'required', e.target.checked)}
                                className="w-4 h-4" />
                              <span className="text-navy-800">Required</span>
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="checkbox" checked={sec.include_in_patient_summary}
                                onChange={e => updateSection(sec.id, 'include_in_patient_summary', e.target.checked)}
                                className="w-4 h-4" />
                              <span className="text-navy-800">Include in patient summary</span>
                            </label>
                          </div>
                        </div>

                        <div>
                          <label className="data-label block mb-1">
                            AI extraction instruction
                            <span className="font-normal text-navy-800/40 ml-1">— tells the AI exactly what to extract</span>
                          </label>
                          <textarea value={sec.extraction_prompt}
                            onChange={e => updateSection(sec.id, 'extraction_prompt', e.target.value)}
                            placeholder="e.g. Extract the chief complaint, duration, character of symptoms, and any precipitating or relieving factors mentioned."
                            rows={3}
                            className="input-clinical text-sm resize-none" />
                        </div>

                        <div>
                          <label className="data-label block mb-1">AI hint (optional)</label>
                          <input type="text" value={sec.ai_hint || ''}
                            onChange={e => updateSection(sec.id, 'ai_hint', e.target.value)}
                            placeholder="e.g. This section is medico-legal — extract verbatim statements"
                            className="input-clinical text-sm py-1.5" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                <button onClick={addSection}
                  className="w-full border-2 border-dashed border-navy-800/15 rounded-xl py-4
                             text-sm text-navy-800/50 hover:border-navy-800/30 hover:text-navy-800/70 transition-colors">
                  + Add section
                </button>

                {/* Patient summary settings */}
                <div className="card-clinical space-y-3">
                  <div className="data-label">Patient summary message</div>
                  <div>
                    <label className="data-label block mb-1.5">Opening message</label>
                    <textarea value={preamble}
                      onChange={e => setPreamble(e.target.value)}
                      placeholder="Dear [PATIENT_NAME],&#10;&#10;Thank you for your consultation with Dr. [SPECIALIST_NAME] today ([DATE])."
                      rows={3} className="input-clinical text-sm resize-none" />
                    <p className="text-2xs text-navy-800/40 mt-1">
                      Use [PATIENT_NAME], [SPECIALIST_NAME], [DATE], [CLINIC_NAME] as placeholders.
                    </p>
                  </div>
                  <div>
                    <label className="data-label block mb-1.5">Closing message</label>
                    <textarea value={closing}
                      onChange={e => setClosing(e.target.value)}
                      placeholder="If you have any questions, please contact our clinic.&#10;&#10;Dr. [SPECIALIST_NAME]"
                      rows={3} className="input-clinical text-sm resize-none" />
                  </div>
                </div>

                <button onClick={handleSave} disabled={isPending}
                  className="btn-primary w-full">
                  {isPending ? 'Saving...' : `Save template (${sections.length} sections)`}
                </button>
              </>
            )}
          </div>
        </div>
      </main>

      {/* New template modal */}
      {showNew && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-4">Create note template</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="data-label block mb-1.5">Template name</label>
                <input type="text" value={newForm.name}
                  onChange={e => setNewForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Pre-angioplasty Assessment"
                  className="input-clinical" autoFocus required />
              </div>
              <div>
                <label className="data-label block mb-1.5">Consultation type</label>
                <select value={newForm.consultation_type}
                  onChange={e => setNewForm(p => ({ ...p, consultation_type: e.target.value }))}
                  className="input-clinical">
                  {CONSULT_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="data-label block mb-1.5">Start from specialty default (recommended)</label>
                <select value={newForm.default_id}
                  onChange={e => setNewForm(p => ({ ...p, default_id: e.target.value }))}
                  className="input-clinical">
                  <option value="">Blank template</option>
                  {defaults.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <p className="text-xs text-navy-800/40 mt-1">
                  Defaults are pre-loaded with specialty-appropriate extraction prompts.
                  You can customise every section after creation.
                </p>
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={isPending || !newForm.name.trim()}
                  className="btn-primary flex-1">
                  {isPending ? 'Creating...' : 'Create template'}
                </button>
                <button type="button" onClick={() => setShowNew(false)}
                  className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
