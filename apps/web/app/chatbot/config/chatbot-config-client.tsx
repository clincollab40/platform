'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, CheckCheck } from 'lucide-react'

// ── Types ───────────────────────────────────────────────────────────────────
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

// ── Constants ───────────────────────────────────────────────────────────────
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_LABELS: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
}

const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English',  script: '' },
  { code: 'hi', label: 'हिंदी',   script: 'Hindi' },
  { code: 'te', label: 'తెలుగు',  script: 'Telugu' },
  { code: 'kn', label: 'ಕನ್ನಡ',   script: 'Kannada' },
  { code: 'mr', label: 'मराठी',   script: 'Marathi' },
  { code: 'bn', label: 'বাংলা',   script: 'Bengali' },
]

const SETUP_STEPS = [
  {
    n: 1,
    title: 'Create WhatsApp Business API account',
    detail: 'Go to business.facebook.com → WhatsApp → Get Started. You need a Meta Business Manager account.',
  },
  {
    n: 2,
    title: 'Add your clinic phone number',
    detail: 'Add your dedicated clinic WhatsApp number (must not be registered to a personal WhatsApp).',
  },
  {
    n: 3,
    title: 'Configure the webhook',
    detail: 'In Meta Business Manager → WhatsApp → Configuration, set Callback URL and Verify Token (copy both below).',
  },
  {
    n: 4,
    title: 'Subscribe to "messages" events',
    detail: 'In the Webhook Fields section, toggle ON "messages". This sends patient messages to ClinCollab.',
  },
  {
    n: 5,
    title: 'Send credentials to ClinCollab',
    detail: 'Email your WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID to support@clincollab.com. We will activate within 24h.',
  },
]

// ── Copy button component ────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="flex-shrink-0 flex items-center gap-1.5 btn-secondary text-xs px-3 py-2"
    >
      {copied ? <CheckCheck size={12} className="text-emerald-600" /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ChatbotConfigClient({
  initialConfig,
  initialFaqs,
  specialistName,
  specialistSpecialty,
  specialistId,
  appUrl,
}: {
  initialConfig: Config | null
  initialFaqs: FAQ[]
  specialistName: string
  specialistSpecialty: string
  specialistId: string
  appUrl: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<'basic' | 'faqs' | 'schedule' | 'preview' | 'deploy'>('basic')

  const defaultConfig: Config = {
    clinic_name: '',
    address: '',
    google_maps_url: '',
    fee_consultation: null,
    fee_followup: null,
    procedures: [],
    languages: ['English', 'हिंदी'],
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
  const [faqs, setFaqs] = useState<FAQ[]>(
    initialFaqs.length > 0 ? initialFaqs : [
      { question: 'What documents should I bring?', answer: 'Please bring any previous medical reports, ECGs, prescriptions, and a valid ID.', is_active: true },
      { question: 'Is parking available?',           answer: 'Yes, parking is available at the clinic.', is_active: true },
    ]
  )
  const [newProcedure, setNewProcedure]       = useState('')
  const [previewInput, setPreviewInput]       = useState('')
  const [previewLoading, setPreviewLoading]   = useState(false)
  const previewEndRef                         = useRef<HTMLDivElement>(null)
  const [previewMessages, setPreviewMessages] = useState<{ role: string; content: string }[]>([
    { role: 'assistant', content: config.welcome_message || `Hello! I'm the assistant for Dr. ${specialistName}. How can I help?` },
  ])

  useEffect(() => {
    previewEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [previewMessages])

  // ── Helpers ────────────────────────────────────────────────────────────────
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

  // ── Save / Go live ─────────────────────────────────────────────────────────
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
          toast.success(goLive ? '🚀 Chatbot is now live!' : 'Configuration saved')
          setConfig(prev => ({ ...prev, is_live: goLive }))
          router.refresh()
        }
      } catch {
        toast.error('Could not save configuration. Please try again.')
      }
    })
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  async function handlePreview(e: React.FormEvent) {
    e.preventDefault()
    if (!previewInput.trim() || previewLoading) return

    const userMsg = previewInput.trim()
    setPreviewMessages(prev => [...prev, { role: 'patient', content: userMsg }])
    setPreviewInput('')
    setPreviewLoading(true)

    try {
      const res = await fetch('/api/chatbot/preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:             userMsg,
          config,
          faqs,
          specialistName,
          specialistSpecialty,
        }),
      })
      const data = await res.json()
      setPreviewMessages(prev => [...prev, { role: 'assistant', content: data.response }])
    } catch {
      setPreviewMessages(prev => [...prev, {
        role: 'assistant', content: 'Preview error — check your configuration and try again.',
      }])
    } finally {
      setPreviewLoading(false)
    }
  }

  // ── Deploy helpers ─────────────────────────────────────────────────────────
  const webhookUrl   = `${appUrl}/api/webhook/whatsapp`
  const verifyToken  = `clincollab-wa-${specialistId.slice(0, 8)}`
  const embedCode    = `<script\n  src="${appUrl}/widget/chat.js"\n  data-specialist="${specialistId}"\n  data-position="bottom-right"\n  defer>\n</script>`

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-clinical-light">

      {/* ── Inner nav (non-sticky — AppLayout TopNav handles page header) ──── */}
      <div className="bg-white border-b border-navy-800/8">
        <div className="px-5 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1">Patient chatbot</span>
          <div className={`text-2xs px-2.5 py-1 rounded-full font-semibold
            ${config.is_live
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-gray-100 text-gray-500'}`}>
            {config.is_live ? '● Live' : '○ Not live'}
          </div>
        </div>
      </div>

      <main className="px-5 py-5">

        {/* Status banner */}
        {!config.is_live && (
          <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4 mb-4">
            <p className="text-sm text-amber-900 font-medium mb-1">Chatbot not yet live</p>
            <p className="text-xs text-amber-700/80 leading-relaxed">
              Complete the configuration below, then go to the <strong>Deploy</strong> tab to see how patients can reach you via WhatsApp or your website.
            </p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-5 overflow-x-auto pb-0.5">
          {(['basic', 'faqs', 'schedule', 'preview', 'deploy'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap
                flex-shrink-0 transition-all border
                ${tab === t
                  ? 'bg-navy-800 text-white border-navy-800'
                  : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}>
              {t === 'basic'    ? 'Clinic info'         :
               t === 'faqs'    ? `FAQs (${faqs.length})` :
               t === 'schedule' ? 'Schedule'            :
               t === 'preview'  ? 'Preview'             :
               '🚀 Deploy'}
            </button>
          ))}
        </div>

        {/* ── CLINIC INFO TAB ──────────────────────────────────────────────── */}
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
              <div className="data-label">Welcome message</div>
              <div>
                <label className="data-label block mb-1.5">First message patients see</label>
                <textarea value={config.welcome_message}
                  onChange={e => upd('welcome_message', e.target.value)}
                  placeholder={`Hello! I'm the virtual assistant for Dr. ${specialistName}...`}
                  rows={3} className="input-clinical resize-none text-sm" />
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
                <label className="data-label block mb-1.5">Coordinator mobile (receives escalated queries via WhatsApp)</label>
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
                    ${config.booking_enabled ? 'bg-emerald-600' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow
                                   transition-all duration-200
                                   ${config.booking_enabled ? 'left-4' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── FAQS TAB ──────────────────────────────────────────────────────── */}
        {tab === 'faqs' && (
          <div className="space-y-3 animate-fade-in">
            <div className="rounded-xl bg-navy-800/4 border border-navy-800/8 p-3">
              <p className="text-xs text-navy-800/70 leading-relaxed">
                Add questions patients ask most. The AI uses these as <strong>priority answers</strong> — exact wording matters. Aim for <strong>10+ FAQs</strong> for strong coverage.
              </p>
            </div>
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

        {/* ── SCHEDULE TAB ──────────────────────────────────────────────────── */}
        {tab === 'schedule' && (
          <div className="space-y-3 animate-fade-in">
            <p className="text-xs text-navy-800/50 leading-relaxed">
              Set your clinic timings. The chatbot communicates these accurately to patients in any language.
            </p>
            <div className="card-clinical space-y-3">
              {DAYS.map(day => (
                <div key={day} className="flex items-center gap-3 py-2 border-b
                                          border-navy-800/5 last:border-0">
                  <div className="w-8 data-label flex-shrink-0">{DAY_LABELS[day]}</div>

                  <button
                    onClick={() => updTiming(day, 'closed', !config.timings[day]?.closed)}
                    className={`w-7 h-4 rounded-full transition-all relative flex-shrink-0
                      ${config.timings[day]?.closed ? 'bg-gray-300' : 'bg-emerald-600'}`}>
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

        {/* ── PREVIEW TAB ───────────────────────────────────────────────────── */}
        {tab === 'preview' && (
          <div className="animate-fade-in">
            <div className="rounded-xl bg-navy-800/4 border border-navy-800/8 p-3 mb-3">
              <p className="text-xs text-navy-800/60 leading-relaxed">
                Test your chatbot with real questions — including in Hindi, Telugu, Kannada, Marathi, or Bengali.
                This uses your current (unsaved) configuration.
              </p>
            </div>
            <div className="card-clinical p-0 overflow-hidden" style={{ height: '420px', display: 'flex', flexDirection: 'column' }}>
              <div className="bg-navy-800 px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-sm">🤖</div>
                <div>
                  <div className="text-white text-sm font-medium">
                    {config.clinic_name || `Dr. ${specialistName}'s clinic`}
                  </div>
                  <div className="text-white/50 text-xs">AI Assistant · 24/7</div>
                </div>
                <div className="ml-auto flex gap-1">
                  {SUPPORTED_LANGUAGES.map(l => (
                    <span key={l.code} className="text-xs text-white/40">{l.label}</span>
                  )).reduce((acc, el, i) => i === 0 ? [el] : [...acc, <span key={`d${i}`} className="text-white/20 text-xs">·</span>, el], [] as React.ReactNode[])}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
                {previewMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'patient' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm
                      ${msg.role === 'patient'
                        ? 'bg-navy-800 text-white rounded-tr-sm'
                        : 'bg-white text-navy-800 rounded-tl-sm shadow-sm border border-navy-800/6'}`}>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    </div>
                  </div>
                ))}
                {previewLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm border border-navy-800/6">
                      <div className="flex gap-1">
                        {[0, 1, 2].map(i => (
                          <span key={i} className="w-1.5 h-1.5 rounded-full bg-navy-800/30 animate-bounce"
                            style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={previewEndRef} />
              </div>

              <form onSubmit={handlePreview} className="flex gap-2 px-4 pb-4 pt-2 border-t border-navy-800/8 bg-white">
                <input value={previewInput} onChange={e => setPreviewInput(e.target.value)}
                  placeholder="Test a patient question in any language..."
                  className="flex-1 input-clinical text-sm py-2.5" />
                <button type="submit" disabled={previewLoading || !previewInput.trim()}
                  className="btn-primary px-4 py-2.5 text-sm">Test</button>
              </form>
            </div>
          </div>
        )}

        {/* ── DEPLOY TAB ────────────────────────────────────────────────────── */}
        {tab === 'deploy' && (
          <div className="space-y-4 animate-fade-in">

            {/* Language support banner */}
            <div className="card-clinical bg-navy-800/3 border border-navy-800/8">
              <div className="data-label mb-3">Languages your chatbot speaks</div>
              <div className="flex flex-wrap gap-2">
                {SUPPORTED_LANGUAGES.map(l => (
                  <div key={l.code} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                                               bg-white border border-navy-800/10 text-xs font-medium text-navy-800">
                    <span className="text-base leading-none">{l.label}</span>
                    {l.script && <span className="text-navy-800/40">({l.script})</span>}
                  </div>
                ))}
              </div>
              <p className="text-xs text-navy-800/50 mt-3 leading-relaxed">
                The AI automatically detects the patient's language from their message and responds in the same language — no setup needed. Works with Hinglish, Tanglish, and regional-English mixes.
              </p>
            </div>

            {/* WhatsApp section */}
            <div className="card-clinical space-y-5">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 text-2xl"
                     style={{ background: '#e7fbe6' }}>
                  📱
                </div>
                <div className="flex-1">
                  <div className="font-bold text-navy-800 text-sm">WhatsApp Business</div>
                  <div className="text-xs text-navy-800/50 mt-0.5">Recommended · Reaches 95%+ of Indian patients</div>
                </div>
                <div className={`text-2xs px-2.5 py-1 rounded-full font-semibold flex-shrink-0
                  ${config.is_live
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                  {config.is_live ? 'Live' : 'Setup required'}
                </div>
              </div>

              {/* How it works */}
              <div className="rounded-xl bg-[#25D366]/6 border border-[#25D366]/20 p-4 space-y-2">
                <div className="text-xs font-bold text-[#128C7E] mb-2">How patients interact</div>
                <div className="space-y-1.5 text-xs text-[#075E54]/80 leading-relaxed">
                  <p>① Patient messages your clinic's WhatsApp Business number</p>
                  <p>② AI responds <strong>instantly</strong> in their language — English, Hindi, Telugu, Kannada, Marathi, or Bengali</p>
                  <p>③ Appointments booked, FAQs answered, fees shared — all automatically, 24/7</p>
                  <p>④ Complex queries escalated to your coordinator's WhatsApp immediately</p>
                  <p>⑤ Emergencies: AI instructs patient to call 112 — never attempts clinical assessment</p>
                </div>
              </div>

              {/* Setup steps */}
              <div>
                <div className="data-label mb-3">One-time setup (≈ 15 minutes)</div>
                <div className="space-y-3">
                  {SETUP_STEPS.map(({ n, title, detail }) => (
                    <div key={n} className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-navy-800 text-white text-2xs font-bold
                                      flex items-center justify-center flex-shrink-0 mt-0.5">
                        {n}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-navy-800">{title}</div>
                        <div className="text-xs text-navy-800/55 leading-relaxed mt-0.5">{detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Credentials to copy */}
              <div className="space-y-3">
                <div className="data-label">Webhook credentials (copy these into Meta)</div>

                <div>
                  <label className="text-2xs text-navy-800/40 uppercase tracking-widest block mb-1.5">
                    Callback URL (Webhook URL)
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1 flex items-center rounded-xl bg-navy-800/4 border
                                    border-navy-800/10 px-3 py-2.5 text-xs font-mono text-navy-800 overflow-hidden">
                      <span className="truncate">{webhookUrl}</span>
                    </div>
                    <CopyButton text={webhookUrl} />
                  </div>
                </div>

                <div>
                  <label className="text-2xs text-navy-800/40 uppercase tracking-widest block mb-1.5">
                    Verify Token
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1 flex items-center rounded-xl bg-navy-800/4 border
                                    border-navy-800/10 px-3 py-2.5 text-xs font-mono text-navy-800">
                      {verifyToken}
                    </div>
                    <CopyButton text={verifyToken} />
                  </div>
                </div>

                <div>
                  <label className="text-2xs text-navy-800/40 uppercase tracking-widest block mb-1.5">
                    Webhook Fields to subscribe
                  </label>
                  <div className="rounded-xl bg-navy-800/4 border border-navy-800/10 px-3 py-2.5">
                    <span className="text-xs font-mono text-navy-800">messages</span>
                    <span className="text-xs text-navy-800/40 ml-2">(toggle ON in Meta webhook fields)</span>
                  </div>
                </div>
              </div>

              {/* Share with patients */}
              <div className="rounded-xl border border-navy-800/10 p-4 space-y-2">
                <div className="text-xs font-bold text-navy-800 mb-2">💬 What to tell patients</div>
                <p className="text-xs text-navy-800/70 leading-relaxed italic">
                  "For appointments and queries, message us on WhatsApp at [your clinic number]. Our AI assistant responds instantly, 24/7."
                </p>
                <p className="text-xs text-navy-800/50 leading-relaxed">
                  Add this message to your visiting card, prescription pad, and clinic website. Once set up, your WhatsApp number IS your chatbot.
                </p>
              </div>
            </div>

            {/* Web widget section */}
            <div className="card-clinical space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl bg-navy-50 flex items-center justify-center
                                flex-shrink-0 text-2xl">
                  🌐
                </div>
                <div>
                  <div className="font-bold text-navy-800 text-sm">Website Chat Widget</div>
                  <div className="text-xs text-navy-800/50 mt-0.5">For your clinic website</div>
                </div>
              </div>

              <p className="text-xs text-navy-800/60 leading-relaxed">
                If your clinic has a website, a chat bubble lets patients start a conversation directly from it —
                before they even find your WhatsApp number.
              </p>

              <div>
                <label className="text-2xs text-navy-800/40 uppercase tracking-widest block mb-1.5">
                  Embed code — paste before &lt;/body&gt; on your website
                </label>
                <div className="relative">
                  <pre className="rounded-xl bg-navy-800/4 border border-navy-800/10 p-3
                                  text-xs font-mono text-navy-800/80 overflow-x-auto leading-relaxed">
{embedCode}
                  </pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton text={embedCode} />
                  </div>
                </div>
                <p className="text-2xs text-navy-800/40 mt-1.5 leading-relaxed">
                  Share your website URL + this snippet with your web developer. The widget auto-connects to your configuration.
                </p>
              </div>
            </div>

            {/* Go live CTA if not live */}
            {!config.is_live && (
              <div className="rounded-2xl bg-navy-800 p-4 text-center">
                <div className="text-white font-bold text-sm mb-1">Ready to go live?</div>
                <p className="text-white/60 text-xs mb-3 leading-relaxed">
                  Save your configuration and activate the chatbot. Patients can start interacting immediately via WhatsApp.
                </p>
                <button onClick={() => handleSave(true)} disabled={isPending}
                  className="bg-white text-navy-800 rounded-xl px-5 py-2.5 text-sm font-bold
                             hover:bg-gray-50 active:scale-95 transition-all">
                  {isPending ? 'Activating...' : '🚀 Go live now'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Action buttons (not shown on deploy tab — it has its own CTA) ── */}
        {tab !== 'deploy' && (
          <div className="flex gap-3 mt-5">
            <button onClick={() => handleSave(false)} disabled={isPending}
              className="btn-secondary flex-1">
              {isPending ? 'Saving...' : 'Save draft'}
            </button>
            <button onClick={() => handleSave(true)} disabled={isPending}
              className="btn-primary flex-1">
              {isPending ? 'Saving...' : config.is_live ? 'Update live' : 'Go live'}
            </button>
          </div>
        )}

      </main>
    </div>
  )
}
