'use client'

import { useState, useTransition, useEffect, Suspense } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { createSpecialistAction, seedPeerNetworkAction } from '@/app/actions/auth'

const SPECIALTIES = [
  { value: 'interventional_cardiology', label: 'Interventional Cardiology' },
  { value: 'cardiac_surgery',           label: 'Cardiac Surgery' },
  { value: 'cardiology',                label: 'Cardiology' },
  { value: 'orthopedics',               label: 'Orthopaedics' },
  { value: 'spine_surgery',             label: 'Spine Surgery' },
  { value: 'neurology',                 label: 'Neurology' },
  { value: 'neurosurgery',              label: 'Neurosurgery' },
  { value: 'gi_surgery',                label: 'GI Surgery' },
  { value: 'urology',                   label: 'Urology' },
  { value: 'oncology',                  label: 'Oncology' },
  { value: 'reproductive_medicine',     label: 'Reproductive Medicine' },
  { value: 'dermatology',               label: 'Dermatology' },
  { value: 'ophthalmology',             label: 'Ophthalmology' },
  { value: 'internal_medicine',         label: 'Internal Medicine' },
  { value: 'other',                     label: 'Other' },
]

const CITIES = [
  'Hyderabad', 'Bengaluru', 'Mumbai', 'Delhi', 'Chennai',
  'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow',
  'Kochi', 'Coimbatore', 'Nagpur', 'Indore', 'Bhopal', 'Other',
]

type Peer = { name: string; city: string; specialty: string }

function OnboardingForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState<1 | 2>(1)

  // If auth callback sent ?step=2, skip to step 2
  useEffect(() => {
    const s = searchParams.get('step')
    if (s === '2') setStep(2)
  }, [])

  // Step 1 state
  const [name, setName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [city, setCity] = useState('')

  // Step 2 state
  const [peers, setPeers] = useState<Peer[]>([
    { name: '', city: '', specialty: '' },
    { name: '', city: '', specialty: '' },
    { name: '', city: '', specialty: '' },
  ])

  function updatePeer(index: number, field: keyof Peer, value: string) {
    setPeers(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      // Auto-add row if filling last row and under 5
      if (field === 'name' && value && index === updated.length - 1 && updated.length < 5) {
        updated.push({ name: '', city: '', specialty: '' })
      }
      return updated
    })
  }

  async function handleStep1Submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim() || !specialty || !city) {
      toast.error('Please complete all fields to continue.')
      return
    }

    const formData = new FormData()
    formData.set('name', name)
    formData.set('specialty', specialty)
    formData.set('city', city)

    startTransition(async () => {
      const result = await createSpecialistAction(formData)
      if (result?.error) {
        toast.error(result.error)
      } else if (result?.redirect) {
        router.push(result.redirect)
      } else if (result?.success) {
        setStep(2)
      }
    })
  }

  async function handleStep2Submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const validPeers = peers.filter(p => p.name.trim() && p.city.trim())

    if (validPeers.length === 0) {
      toast.error('Please add at least one clinical colleague to continue.')
      return
    }

    const formData = new FormData()
    validPeers.forEach((p, i) => {
      formData.set(`peer_${i}_name`, p.name)
      formData.set(`peer_${i}_city`, p.city)
      formData.set(`peer_${i}_specialty`, p.specialty)
    })

    startTransition(async () => {
      const result = await seedPeerNetworkAction(formData)
      if (result?.error) {
        toast.error(result.error)
      } else {
        router.push('/dashboard?onboarded=1')
      }
    })
  }

  return (
    <main className="min-h-screen bg-clinical-light flex flex-col items-center justify-center px-4 py-8">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(26,82,118,0.04) 1px, transparent 0)`,
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative w-full max-w-md animate-slide-up">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <Image src="/logo.png" alt="ClinCollab" width={40} height={40} />
          <span className="font-display text-xl text-navy-800">ClinCollab</span>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          <div className={`h-1 flex-1 rounded-full transition-all duration-500 ${step >= 1 ? 'bg-navy-800' : 'bg-navy-800/15'}`} />
          <div className={`h-1 flex-1 rounded-full transition-all duration-500 ${step >= 2 ? 'bg-forest-700' : 'bg-navy-800/15'}`} />
        </div>

        {/* Step 1 — Identity */}
        {step === 1 && (
          <div className="animate-fade-in">
            <div className="mb-6">
              <h1 className="font-display text-3xl text-navy-800 mb-2">
                Your clinical identity
              </h1>
              <p className="text-sm text-navy-800/60">
                Takes 10 seconds. This is all we need to get started.
              </p>
            </div>

            <form onSubmit={handleStep1Submit} className="card-clinical space-y-4">
              <div>
                <label className="data-label block mb-1.5">Full name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Dr. Avinash Kumar"
                  className="input-clinical"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="data-label block mb-1.5">Specialty</label>
                <select
                  value={specialty}
                  onChange={e => setSpecialty(e.target.value)}
                  className="input-clinical"
                  required
                >
                  <option value="">Select your specialty</option>
                  {SPECIALTIES.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="data-label block mb-1.5">City</label>
                <select
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  className="input-clinical"
                  required
                >
                  <option value="">Select your city</option>
                  {CITIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={isPending || !name || !specialty || !city}
                className="btn-primary w-full mt-2"
              >
                {isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Setting up...
                  </span>
                ) : 'Continue'}
              </button>
            </form>
          </div>
        )}

        {/* Step 2 — Peer network seeding */}
        {step === 2 && (
          <div className="animate-fade-in">
            <div className="mb-6">
              <h1 className="font-display text-3xl text-navy-800 mb-2">
                Your clinical peer network
              </h1>
              <p className="text-sm text-navy-800/60 leading-relaxed">
                Which colleagues refer cases to you? Add up to 5.
                We will build your practice intelligence from this.
              </p>
            </div>

            <form onSubmit={handleStep2Submit}>
              <div className="card-clinical space-y-3 mb-4">
                {peers.map((peer, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        value={peer.name}
                        onChange={e => updatePeer(i, 'name', e.target.value)}
                        placeholder={`Colleague ${i + 1} name`}
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
                            {CITIES.map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={peer.specialty}
                            onChange={e => updatePeer(i, 'specialty', e.target.value)}
                            placeholder="Specialty (opt.)"
                            className="input-clinical text-sm py-2 flex-1"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Value proposition */}
              <div className="bg-forest-50 border border-forest-700/15 rounded-xl p-4 mb-4">
                <p className="text-xs text-forest-700 leading-relaxed">
                  <span className="font-medium">What happens next:</span> Your practice map
                  reveals which colleagues are active, drifting, or silent —
                  and benchmarks your network against specialists in your city.
                </p>
              </div>

              <button
                type="submit"
                disabled={isPending || peers.filter(p => p.name && p.city).length === 0}
                className="btn-primary w-full"
              >
                {isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Building your practice map...
                  </span>
                ) : 'Build my practice map'}
              </button>

              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="w-full text-center text-xs text-navy-800/40 mt-3 py-2 hover:text-navy-800/60 transition-colors"
              >
                Skip for now
              </button>
            </form>
          </div>
        )}
      </div>
    </main>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-clinical-light flex items-center justify-center">
        <span className="w-6 h-6 border-2 border-navy-800/20 border-t-navy-800 rounded-full animate-spin" />
      </main>
    }>
      <OnboardingForm />
    </Suspense>
  )
}
