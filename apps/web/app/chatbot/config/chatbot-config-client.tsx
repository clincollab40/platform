'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

type Config = {
  id?: string
  clinic_name: string
  address: string
  google_maps_url: string
  fee_consultation: number | null
  fee_followup: number | null
  procedures: string[]
  languages: string[]
  escalation_mobile: string
  escalation_hours: string
  booking_enabled: boolean
  is_live: boolean
  timings: Record<string, { open: string | null; close: string | null; closed: boolean }>
  welcome_message: string
}

type FAQ = { id?: string; question: string; answer: string; is_active: boolean }

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_LABELS: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
}

const DEFAULT_PROCEDURES_CARDIOLOGY = [
  'Coronary angiography', 'Coronary angioplasty (PTCA)', 'Echocardiography',
  'Stress test (TMT)', 'Holter monitoring', 'Pacemaker implantation', 'Cardiac consultation',
]

export default function ChatbotConfigClient({
  initialConfig,
  initialFaqs,
  specialistName,
  specialistSpecialty,
}: {
  initialConfig: Config | null
  initialFaqs: FAQ[]
  specialistName: string
  specialistSpecialty: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<'basic' | 'faqs' | 'schedule' | 'preview'>('basic')

  const defaultConfig: Config = {
    clinic_name: '',
    address: '',
    google_maps_url: '',
    fee_consultation: null,
    fee_followup: null,
    procedures: specialistSpecialty.includes('cardiol') ? DEFAULT_PROCEDURES_CARDIOLOGY : [],
    languages: ['English'],
    escalation_mobile: '',
    escalation_hours: 'Monday to Saturday, 9am to 6pm',
    booking_enabled: true,
    is_live: false,
    welcome_message: `Hello! I'm the virtual assistant for Dr. ${specialistName}. How can I help you today?`,
    timings: {
      monday:    { open: '09:00', close: '18:00', closed: false },
      tuesday:   { open: '09:00', close: '18:00', closed: false },
      wednesday: { open: '09:00', close: '18:00', closed: false },
      thursday:  { open: '09:00', close: '18:00', closed: false },
      friday:    { open: '09:00', close: '18:00', closed: false },
      saturday:  { open: '09:00', close: '13:00', closed: false },
      sunday:    { open: null, close: null, closed: true },
    },
  }

  const [config, setConfig] = useState<Config>(initialConfig || defaultConfig)
  const [faqs, setFaqs]     = useState<FAQ[]>(initialFaqs.length > 0 ? initialFaqs : [
    { question: 'What documents should I bring?', answer: 'Please bring any previous medical reports, ECGs, prescriptions, and a valid ID.', is_active: true },
    { question: 'Is parking available?', answer: 'Yes, parking is available at the clinic.', is_active: true },
  ])
  const [newProcedure, setNewProcedure] = useState('')
  const [previewInput, setPreviewInput] = useState('')
  const [previewMessages, setPreviewMessages] = useState<{ role: string; content: string }[]>([
    { role: 'assistant', content: config.welcome_message || `Hello! I'm the assistant for Dr. ${specialistName}. How can I help?` },
  ])

  function upd(field: keyof Config, value: any) {
    setConfig(prev => ({ ...prev, [field]: value }))
  }

  function updTiming(day: string, field: string, value: any) {
    setConfig(prev => ({
      ...prev,
      timings: { ...prev.timings, [day]: { ...prev.timings[day], [field]: value } },
    }))
  }

  function addFaq() {
    setFaqs(prev => [...prev, { question: '', answer: '', is_active: true }])
  }

  function updFaq(idx: number, field: keyof FAQ, value: any) {
    setFaqs(prev => prev.map((f, i) => i === idx ? { ...f, [field]: value } : f))
  }

  function removeFaq(idx: number) {
    setFaqs(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSave(goLive = false) {
    startTransition(async () => {
      try {
        const res = await fetch('/api/chatbot/config', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: { ...config, is_live: goLive }, faqs }),
        })

        const data = await res.json()
        if (data.error) {
          toast.error(data.error)
        } else {
          toast.success(goLive ? 'Chatbot is now live!' : 'Configuration saved')
          setConfig(prev => ({ ...prev, is_live: goLive }))
          router.refresh()
        }
      } catch {
        toast.error('Could not save configuration. Please try again.')
      }
    })
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault()
    if (!previewInput.trim()) return

    const userMsg = previewInput.trim()
    setPreviewMessages(prev => [...prev, { role: 'patient', content: userMsg }])
    setPreviewInput('')

    try {
      const res = await fetch('/api/chatbot/preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, config, faqs }),
      })
      const data = await res.json()
      setPreviewMessages(prev => [...prev, { role: 'assistant', content: data.response }])
    } catch {
      setPreviewMessages(prev => [...prev, {
        role: 'assistant', content: 'Preview error — check your configuration.'
      }])
    }
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
          <span className="font-sans font-medium text-navy-800 flex-1">Patient chatbot</span>
          <div className={`text-2xs px-2 py-0.5 rounded-full font-medium
            ${config.is_live ? 'bg-forest-50 text-forest-700' : 'bg-gray-100 text-gray-500'}`}>
            {config.is_live ? 'Live' : 'Not live'}
          </div>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-5">

        {/* Status banner */}
        {!config.is_live && (
          <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4 mb-4">
            <p className="text-sm text-amber-900 font-medium mb-1">Chatbot not yet live</p>
            <p className="text-xs text-amber-700/80 leading-relaxed">
              Complete the configuration below and click "Go live" to activate the patient chatbot.
            </p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-5 overflow-x-auto">
          {(['basic', 'faqs', 'schedule', 'preview'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap
                flex-shrink-0 transition-all border
                ${tab === t
                  ? 'bg-navy-800 text-white border-navy-800'
                  : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}>
              {t === 'basic' ? 'Clinic info' :
               t === 'faqs'  ? `FAQs (${faqs.length})` :
               t === 'schedule' ? 'Schedule' : 'Preview'}
            </button>
          ))}
        </div>

        {/* Basic info tab */}
        {tab === 'basic' && (
          <div className="space-y-4 animate-fade-in">
            <div className="card-clinical space-y-4">
              <div className="data-label">Clinic details</div>

              <div>
                <label className="data-label block mb-1.5">Clinic name</label>
                <input value={config.clinic_name}
                  onChange={e => upd('clinic_name', e.target.value)}
                  placeholder="e.g. Heart Care Clinic" className="input-clinical" />
              </div>

              <div>
                <label className="data-label block mb-1.5">Full address</label>
                <textarea value={config.address}
                  onChange={e => upd('address', e.target.value)}
                  placeholder="Floor, building, street, area, city — pincode"
                  rows={3} className="input-clinical resize-none text-sm" />
              </div>

              <div>
                <label className="data-label block mb-1.5">Google Maps link (optional)</label>
                <input value={config.google_maps_url}
                  onChange={e => upd('google_maps_url', e.target.value)}
                  placeholder="https://maps.google.com/..." className="input-clinical text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="data-label block mb-1.5">Consultation fee (₹)</label>
                  <input type="number" value={config.fee_consultation || ''}
                    onChange={e => upd('fee_consultation', parseInt(e.target.value) || null)}
                    placeholder="800" className="input-clinical" />
                </div>
                <div>
                  <label className="data-label block mb-1.5">Follow-up fee (₹)</label>
                  <input type="number" value={config.fee_followup || ''}
                    onChange={e => upd('fee_followup', parseInt(e.target.value) || null)}
                    placeholder="400" className="input-clinical" />
                </div>
              </div>
            </div>

            <div className="card-clinical space-y-4">
              <div className="data-label">Procedures performed</div>
              <div className="flex flex-wrap gap-1.5">
                {config.procedures.map((p, i) => (
                  <span key={i} className="flex items-center gap-1 bg-navy-50 text-navy-800
                                           text-xs px-2.5 py-1 rounded-full">
                    {p}
                    <button onClick={() => upd('procedures', config.procedures.filter((_, j) => j !== i))}
                      className="text-navy-800/40 hover:text-red-500 transition-colors ml-0.5">
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newProcedure} onChange={e => setNewProcedure(e.target.value)}
                  placeholder="Add a procedure..."
                  className="input-clinical text-sm flex-1"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newProcedure.trim()) {
                      upd('procedures', [...config.procedures, newProcedure.trim()])
                      setNewProcedure('')
                    }
                  }} />
                <button onClick={() => {
                  if (newProcedure.trim()) {
                    upd('procedures', [...config.procedures, newProcedure.trim()])
                    setNewProcedure('')
                  }
                }} className="btn-secondary text-sm px-4">Add</button>
              </div>
            </div>

            <div className="card-clinical space-y-4">
              <div className="data-label">Escalation settings</div>
              <div>
                <label className="data-label block mb-1.5">Coordinator mobile (receives escalated queries)</label>
                <input value={config.escalation_mobile}
                  onChange={e => upd('escalation_mobile', e.target.value)}
                  placeholder="9876543210" type="tel" className="input-clinical" />
              </div>
              <div>
                <label className="data-label block mb-1.5">Availability hours (shown to patients)</label>
                <input value={config.escalation_hours}
                  onChange={e => upd('escalation_hours', e.target.value)}
                  placeholder="Monday to Saturday, 9am to 6pm" className="input-clinical" />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-navy-800/8">
                <div>
                  <div className="text-sm font-medium text-navy-800">Enable appointment booking</div>
                  <div className="text-xs text-navy-800/50">Patients can book slots via chatbot</div>
                </div>
                <button
                  onClick={() => upd('booking_enabled', !config.booking_enabled)}
                  className={`w-10 h-6 rounded-full transition-all relative
                    ${config.booking_enabled ? 'bg-forest-700' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow
                                   transition-all duration-200
                                   ${config.booking_enabled ? 'left-4' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* FAQs tab */}
        {tab === 'faqs' && (
          <div className="space-y-3 animate-fade-in">
            <p className="text-xs text-navy-800/50 leading-relaxed">
              Add questions patients frequently ask. The chatbot will use these as priority answers.
            </p>
            {faqs.map((faq, idx) => (
              <div key={idx} className="card-clinical space-y-3">
                <div className="flex items-center justify-between">
                  <div className="data-label">FAQ {idx + 1}</div>
                  <button onClick={() => removeFaq(idx)}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors">
                    Remove
                  </button>
                </div>
                <div>
                  <label className="data-label block mb-1.5">Question</label>
                  <input value={faq.question} onChange={e => updFaq(idx, 'question', e.target.value)}
                    placeholder="What patients ask..." className="input-clinical text-sm" />
                </div>
                <div>
                  <label className="data-label block mb-1.5">Answer</label>
                  <textarea value={faq.answer} onChange={e => updFaq(idx, 'answer', e.target.value)}
                    placeholder="How the chatbot should respond..."
                    rows={3} className="input-clinical resize-none text-sm" />
                </div>
              </div>
            ))}
            <button onClick={addFaq}
              className="w-full border-2 border-dashed border-navy-800/20 rounded-xl
                         py-4 text-sm text-navy-800/50 hover:border-navy-800/40
                         hover:text-navy-800/70 transition-colors">
              + Add FAQ
            </button>
          </div>
        )}

        {/* Schedule tab */}
        {tab === 'schedule' && (
          <div className="space-y-3 animate-fade-in">
            <p className="text-xs text-navy-800/50 leading-relaxed">
              Set your clinic timings. The chatbot will communicate these to patients accurately.
            </p>
            <div className="card-clinical space-y-3">
              {DAYS.map(day => (
                <div key={day} className="flex items-center gap-3 py-2 border-b
                                          border-navy-800/5 last:border-0">
                  <div className="w-8 data-label flex-shrink-0">{DAY_LABELS[day]}</div>

                  <button
                    onClick={() => updTiming(day, 'closed', !config.timings[day]?.closed)}
                    className={`w-7 h-4 rounded-full transition-all relative flex-shrink-0
                      ${config.timings[day]?.closed ? 'bg-gray-300' : 'bg-forest-700'}`}>
                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full
                                     shadow transition-all
                                     ${config.timings[day]?.closed ? 'left-0.5' : 'left-3'}`} />
                  </button>

                  {!config.timings[day]?.closed ? (
                    <div className="flex items-center gap-1.5 flex-1">
                      <input type="time" value={config.timings[day]?.open || '09:00'}
                        onChange={e => updTiming(day, 'open', e.target.value)}
                        className="input-clinical text-xs py-1.5 flex-1" />
                      <span className="text-navy-800/40 text-xs flex-shrink-0">to</span>
                      <input type="time" value={config.timings[day]?.close || '18:00'}
                        onChange={e => updTiming(day, 'close', e.target.value)}
                        className="input-clinical text-xs py-1.5 flex-1" />
                    </div>
                  ) : (
                    <span className="text-xs text-navy-800/40 flex-1">Closed</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Preview tab */}
        {tab === 'preview' && (
          <div className="animate-fade-in">
            <div className="card-clinical p-0 overflow-hidden" style={{ height: '400px', display: 'flex', flexDirection: 'column' }}>
              <div className="bg-navy-800 px-4 py-3">
                <div className="text-white text-sm font-medium">Chatbot preview</div>
                <div className="text-white/60 text-xs">Test your configuration</div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {previewMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'patient' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm
                      ${msg.role === 'patient'
                        ? 'bg-navy-800 text-white rounded-tr-sm'
                        : 'bg-navy-800/6 text-navy-800 rounded-tl-sm'}`}>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={handlePreview} className="flex gap-2 px-4 pb-4 pt-2 border-t border-navy-800/8">
                <input value={previewInput} onChange={e => setPreviewInput(e.target.value)}
                  placeholder="Test a patient question..."
                  className="flex-1 input-clinical text-sm py-2.5" />
                <button type="submit" disabled={isPending || !previewInput.trim()}
                  className="btn-primary px-4 py-2.5 text-sm">Test</button>
              </form>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 mt-5">
          <button onClick={() => handleSave(false)} disabled={isPending}
            className="btn-secondary flex-1">
            {isPending ? 'Saving...' : 'Save draft'}
          </button>
          <button onClick={() => handleSave(true)} disabled={isPending}
            className="btn-primary flex-1">
            {isPending ? 'Going live...' : config.is_live ? 'Update live' : 'Go live'}
          </button>
        </div>
      </main>
    </div>
  )
}
