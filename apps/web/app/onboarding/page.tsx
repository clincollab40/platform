'use client'

import { useState, useTransition, useEffect, Suspense } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { createSpecialistAction, seedPeerNetworkAction } from '@/app/actions/auth'
import { ChevronRight, Users, Stethoscope, MapPin, User } from 'lucide-react'

// ── Comprehensive specialty list ──────────────────
const SPECIALTY_GROUPS = [
  {
    group: 'Cardiac Sciences',
    items: [
      { value: 'interventional_cardiology', label: 'Interventional Cardiology' },
      { value: 'cardiology',                label: 'Cardiology (Non-invasive)' },
      { value: 'cardiac_surgery',           label: 'Cardiac Surgery / CABG' },
      { value: 'electrophysiology',         label: 'Electrophysiology' },
    ],
  },
  {
    group: 'Neurosciences',
    items: [
      { value: 'neurology',    label: 'Neurology' },
      { value: 'neurosurgery', label: 'Neurosurgery' },
      { value: 'stroke_medicine', label: 'Stroke Medicine' },
    ],
  },
  {
    group: 'Orthopaedics & Spine',
    items: [
      { value: 'orthopedics',      label: 'Orthopaedics (General)' },
      { value: 'spine_surgery',    label: 'Spine Surgery' },
      { value: 'joint_replacement',label: 'Joint Replacement' },
      { value: 'sports_medicine',  label: 'Sports Medicine' },
    ],
  },
  {
    group: 'Gastroenterology & Hepatology',
    items: [
      { value: 'gi_surgery',         label: 'GI Surgery / Laparoscopic Surgery' },
      { value: 'hepatobiliary_surgery', label: 'Hepatobiliary Surgery' },
      { value: 'colorectal_surgery', label: 'Colorectal Surgery' },
      { value: 'bariatric_surgery',  label: 'Bariatric Surgery' },
    ],
  },
  {
    group: 'Oncology',
    items: [
      { value: 'oncology',          label: 'Medical Oncology' },
      { value: 'surgical_oncology', label: 'Surgical Oncology' },
      { value: 'radiation_oncology',label: 'Radiation Oncology' },
      { value: 'hematology',        label: 'Hematology & BMT' },
    ],
  },
  {
    group: 'Vascular & Transplant',
    items: [
      { value: 'vascular_surgery',  label: 'Vascular Surgery' },
      { value: 'transplant_surgery',label: 'Transplant Surgery' },
    ],
  },
  {
    group: 'Urology & Nephrology',
    items: [
      { value: 'urology',    label: 'Urology' },
      { value: 'nephrology', label: 'Nephrology' },
    ],
  },
  {
    group: 'Reproductive & Endocrine',
    items: [
      { value: 'reproductive_medicine', label: 'Reproductive Medicine / IVF' },
      { value: 'endocrinology',         label: 'Endocrinology & Diabetes' },
    ],
  },
  {
    group: 'Head, Neck & Senses',
    items: [
      { value: 'ophthalmology',      label: 'Ophthalmology' },
      { value: 'ent',                label: 'ENT (Otolaryngology)' },
      { value: 'maxillofacial',      label: 'Maxillofacial Surgery' },
    ],
  },
  {
    group: 'Skin & Aesthetics',
    items: [
      { value: 'dermatology',    label: 'Dermatology' },
      { value: 'plastic_surgery',label: 'Plastic & Reconstructive Surgery' },
    ],
  },
  {
    group: 'Critical Care & Support',
    items: [
      { value: 'pulmonology',    label: 'Pulmonology / Critical Care' },
      { value: 'anesthesiology', label: 'Anaesthesiology / Pain Management' },
      { value: 'radiology',      label: 'Radiology / Interventional Radiology' },
    ],
  },
  {
    group: 'General & Internal',
    items: [
      { value: 'internal_medicine', label: 'Internal Medicine / General Medicine' },
      { value: 'general_surgery',   label: 'General Surgery' },
      { value: 'pediatrics',        label: 'Paediatrics' },
      { value: 'pediatric_surgery', label: 'Paediatric Surgery' },
      { value: 'rheumatology',      label: 'Rheumatology & Immunology' },
      { value: 'other',             label: 'Other Specialty' },
    ],
  },
]

// Flat list for display
const SPECIALTIES = SPECIALTY_GROUPS.flatMap(g => g.items)

// ── Comprehensive India city list ─────────────────
const CITY_GROUPS = [
  {
    group: 'Metro Cities',
    cities: ['Mumbai', 'Delhi / NCR', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad'],
  },
  {
    group: 'Major Cities',
    cities: ['Jaipur', 'Lucknow', 'Chandigarh', 'Kochi', 'Coimbatore', 'Nagpur', 'Indore', 'Bhopal',
             'Visakhapatnam', 'Thiruvananthapuram', 'Surat', 'Vadodara', 'Patna', 'Bhubaneswar'],
  },
  {
    group: 'Other Cities',
    cities: ['Guwahati', 'Dehradun', 'Raipur', 'Ludhiana', 'Agra', 'Nashik', 'Madurai', 'Varanasi',
             'Aurangabad', 'Amritsar', 'Mangaluru', 'Mysuru', 'Goa', 'Ranchi', 'Jodhpur', 'Udaipur',
             'Gwalior', 'Jabalpur', 'Kozhikode', 'Thrissur', 'Vijayawada', 'Tiruchirappalli',
             'Hubli', 'Dharwad', 'Belgaum', 'Other'],
  },
]

const ALL_CITIES = CITY_GROUPS.flatMap(g => g.cities)

type Peer = { name: string; city: string; specialty: string }

// ── Step indicator ────────────────────────────────
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`h-1 rounded-full transition-all duration-500 ${
          i < current ? 'flex-1 bg-navy-800' :
          i === current ? 'flex-1 bg-navy-800' : 'w-6 bg-navy-800/15'
        }`} />
      ))}
    </div>
  )
}

// ── Main onboarding form ──────────────────────────
function OnboardingForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState<1 | 2>(1)

  const [name, setName]         = useState('')
  const [specialty, setSpecialty] = useState('')
  const [city, setCity]         = useState('')

  const [peers, setPeers] = useState<Peer[]>([
    { name: '', city: '', specialty: '' },
    { name: '', city: '', specialty: '' },
    { name: '', city: '', specialty: '' },
  ])

  useEffect(() => {
    if (searchParams.get('step') === '2') setStep(2)
  }, [])

  function updatePeer(i: number, field: keyof Peer, value: string) {
    setPeers(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], [field]: value }
      if (field === 'name' && value && i === updated.length - 1 && updated.length < 5)
        updated.push({ name: '', city: '', specialty: '' })
      return updated
    })
  }

  async function handleStep1(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !specialty || !city) {
      toast.error('Please complete all fields.')
      return
    }
    const fd = new FormData()
    fd.set('name', name); fd.set('specialty', specialty); fd.set('city', city)
    startTransition(async () => {
      const result = await createSpecialistAction(fd)
      if (result?.error)    toast.error(result.error)
      else if (result?.redirect) router.push(result.redirect)
      else if (result?.success)  setStep(2)
    })
  }

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault()
    const valid = peers.filter(p => p.name.trim() && p.city.trim())
    if (valid.length === 0) { toast.error('Please add at least one colleague.'); return }
    const fd = new FormData()
    valid.forEach((p, i) => {
      fd.set(`peer_${i}_name`, p.name)
      fd.set(`peer_${i}_city`, p.city)
      fd.set(`peer_${i}_specialty`, p.specialty)
    })
    startTransition(async () => {
      const result = await seedPeerNetworkAction(fd)
      if (result?.error) toast.error(result.error)
      else router.push('/dashboard?onboarded=1')
    })
  }

  const specialtyLabel = SPECIALTIES.find(s => s.value === specialty)?.label ?? ''

  return (
    <div className="min-h-screen flex bg-white">

      {/* Left panel — context */}
      <div
        className="hidden lg:flex flex-col justify-between w-2/5 p-12"
        style={{ background: 'linear-gradient(160deg, #0A1628 0%, #0F2D4A 60%, #1A5276 100%)' }}
      >
        <div>
          <div className="flex items-center gap-3 mb-16">
            <Image src="/logo.png" alt="ClinCollab" width={36} height={36} />
            <span className="font-display text-lg text-white">ClinCollab</span>
          </div>

          <div className="space-y-8">
            <div>
              <div className="text-2xs font-mono uppercase tracking-widest mb-3"
                style={{ color: 'rgba(255,255,255,0.35)' }}>
                {step === 1 ? 'Step 1 of 2' : 'Step 2 of 2'}
              </div>
              <h2 className="font-display text-3xl font-medium text-white leading-tight">
                {step === 1
                  ? 'Your clinical identity'
                  : 'Your peer network'}
              </h2>
              <p className="text-sm mt-3 leading-relaxed" style={{ color: 'rgba(255,255,255,0.50)' }}>
                {step === 1
                  ? 'Takes 30 seconds. This is the foundation of your practice intelligence.'
                  : 'Your referring colleagues are the source of your practice intelligence.'}
              </p>
            </div>

            {/* What happens next */}
            <div className="space-y-4">
              {(step === 1 ? [
                { icon: <Stethoscope size={16} />, text: 'Your specialty shapes your AI insights and benchmarks' },
                { icon: <MapPin size={16} />,      text: 'Your city calibrates your peer comparison data' },
                { icon: <User size={16} />,         text: 'Your profile builds credibility with your referrers' },
              ] : [
                { icon: <Users size={16} />,       text: 'We map your referral network and score its health' },
                { icon: <ChevronRight size={16} />, text: 'Identify inactive referrers before they go silent' },
                { icon: <ChevronRight size={16} />, text: 'Benchmark your network vs. peers in your city' },
              ]).map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="flex-shrink-0 mt-0.5" style={{ color: '#5DADE2' }}>{item.icon}</span>
                  <span className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Progress */}
        <div>
          <StepIndicator current={step - 1} total={2} />
          <p className="text-xs mt-3" style={{ color: 'rgba(255,255,255,0.25)' }}>
            {step === 1 ? '~30 seconds to complete' : '~1 minute to complete'}
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 overflow-y-auto" style={{ background: '#FAFBFC' }}>
        <div className="w-full max-w-lg animate-slide-up">

          {/* Mobile header */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <Image src="/logo.png" alt="" width={32} height={32} />
            <div>
              <div className="font-display text-lg text-ink">ClinCollab</div>
              <div className="text-xs" style={{ color: 'rgba(13,27,42,0.40)' }}>Setup your profile</div>
            </div>
          </div>

          {/* Mobile step */}
          <div className="mb-6 lg:hidden">
            <StepIndicator current={step - 1} total={2} />
          </div>

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <div>
              <div className="mb-8 hidden lg:block">
                <div className="text-2xs font-mono uppercase tracking-widest text-ink/30 mb-2">Step 1 of 2</div>
                <h1 className="font-display text-3xl text-ink font-medium mb-1">Your clinical identity</h1>
                <p className="text-sm text-ink/50">Takes 30 seconds. This shapes your entire experience.</p>
              </div>

              <form onSubmit={handleStep1} className="space-y-5">
                {/* Name */}
                <div>
                  <label className="data-label block mb-2">Full Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Dr. Rajiv Sharma"
                    className="input-clinical"
                    autoFocus required
                  />
                </div>

                {/* Specialty — grouped select */}
                <div>
                  <label className="data-label block mb-2">Specialty</label>
                  <select
                    value={specialty}
                    onChange={e => setSpecialty(e.target.value)}
                    className="input-clinical"
                    required
                  >
                    <option value="">Select your specialty</option>
                    {SPECIALTY_GROUPS.map(group => (
                      <optgroup key={group.group} label={group.group}>
                        {group.items.map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* City — grouped select */}
                <div>
                  <label className="data-label block mb-2">City of Practice</label>
                  <select
                    value={city}
                    onChange={e => setCity(e.target.value)}
                    className="input-clinical"
                    required
                  >
                    <option value="">Select your city</option>
                    {CITY_GROUPS.map(group => (
                      <optgroup key={group.group} label={group.group}>
                        {group.cities.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Preview card */}
                {name && specialty && city && (
                  <div className="rounded-2xl border border-navy-800/10 bg-white p-4 flex items-center gap-4 animate-fade-in">
                    <div className="w-12 h-12 rounded-xl bg-navy-800 flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-lg font-semibold">{name.charAt(0)}</span>
                    </div>
                    <div>
                      <div className="font-medium text-ink text-sm">{name}</div>
                      <div className="text-xs text-ink/50 mt-0.5">{specialtyLabel} · {city}</div>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isPending || !name || !specialty || !city}
                  className="btn-primary w-full flex items-center justify-center gap-2 py-3.5"
                >
                  {isPending ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    <>Continue <ChevronRight size={16} /></>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && (
            <div>
              <div className="mb-8 hidden lg:block">
                <div className="text-2xs font-mono uppercase tracking-widest text-ink/30 mb-2">Step 2 of 2</div>
                <h1 className="font-display text-3xl text-ink font-medium mb-1">Your peer network</h1>
                <p className="text-sm text-ink/50">Which colleagues refer cases to you? Add up to 5.</p>
              </div>

              {/* Value prop */}
              <div className="rounded-2xl p-4 mb-6 border" style={{ background: 'rgba(26,82,118,0.04)', borderColor: 'rgba(26,82,118,0.10)' }}>
                <p className="text-xs text-navy-800/70 leading-relaxed">
                  <span className="font-semibold text-navy-800">What happens next:</span>{' '}
                  ClinCollab maps your network health, identifies at-risk referrers,
                  and benchmarks you against specialists in {city || 'your city'}.
                  Specialists with mapped networks see <strong>34% higher referral growth</strong> on average.
                </p>
              </div>

              <form onSubmit={handleStep2}>
                <div className="space-y-3 mb-5">
                  {peers.map((peer, i) => (
                    <div key={i} className="bg-white rounded-2xl border border-navy-800/8 p-4 space-y-3">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-6 h-6 rounded-full bg-navy-800/8 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-medium text-navy-800/60">{i + 1}</span>
                        </div>
                        <span className="text-xs font-medium text-ink/50">Colleague {i + 1}</span>
                      </div>
                      <input
                        type="text"
                        value={peer.name}
                        onChange={e => updatePeer(i, 'name', e.target.value)}
                        placeholder="Dr. Full Name"
                        className="input-clinical text-sm py-2.5"
                      />
                      {peer.name && (
                        <div className="flex gap-2 animate-fade-in">
                          <select
                            value={peer.city}
                            onChange={e => updatePeer(i, 'city', e.target.value)}
                            className="input-clinical text-sm py-2 flex-1"
                          >
                            <option value="">City</option>
                            {ALL_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <select
                            value={peer.specialty}
                            onChange={e => updatePeer(i, 'specialty', e.target.value)}
                            className="input-clinical text-sm py-2 flex-1"
                          >
                            <option value="">Specialty (optional)</option>
                            {SPECIALTIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={isPending || peers.filter(p => p.name && p.city).length === 0}
                  className="btn-primary w-full flex items-center justify-center gap-2 py-3.5 mb-3"
                >
                  {isPending ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Building your practice map...
                    </>
                  ) : (
                    <>Build my practice map <ChevronRight size={16} /></>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => router.push('/dashboard')}
                  className="w-full text-center text-xs py-2 transition-colors"
                  style={{ color: 'rgba(13,27,42,0.35)' }}
                  onMouseOver={e => (e.currentTarget.style.color = 'rgba(13,27,42,0.60)')}
                  onMouseOut={e => (e.currentTarget.style.color = 'rgba(13,27,42,0.35)')}
                >
                  Skip for now — I'll add colleagues later
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-white">
        <span className="w-6 h-6 border-2 border-navy-800/20 border-t-navy-800 rounded-full animate-spin" />
      </div>
    }>
      <OnboardingForm />
    </Suspense>
  )
}
