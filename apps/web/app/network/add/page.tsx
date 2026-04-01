'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { addReferrerAction } from '@/app/actions/network'

const SPECIALTIES = [
  'General Physician', 'Family Medicine', 'Internal Medicine',
  'Diabetologist', 'Endocrinologist', 'Cardiologist', 'Pulmonologist',
  'Nephrologist', 'Neurologist', 'Gastroenterologist', 'Orthopaedic Surgeon',
  'Gynaecologist', 'Paediatrician', 'Dermatologist', 'Ophthalmologist',
  'ENT Specialist', 'Psychiatrist', 'Emergency Medicine', 'Other',
]

const CITIES = [
  'Hyderabad', 'Bengaluru', 'Mumbai', 'Delhi', 'Chennai',
  'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow',
  'Kochi', 'Coimbatore', 'Nagpur', 'Indore', 'Bhopal', 'Other',
]

export default function AddReferrerPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showMore, setShowMore] = useState(false)

  const [form, setForm] = useState({
    name: '', city: '', specialty: '',
    clinic_name: '', clinic_area: '', mobile: '', whatsapp: '',
  })

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!form.name.trim() || !form.city) {
      toast.error('Name and city are required.')
      return
    }

    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => { if (v) fd.set(k, v) })

    startTransition(async () => {
      const result = await addReferrerAction(fd)
      if (result?.error) {
        toast.error(result.error)
      } else {
        toast.success(`${form.name} added to your network`)
        router.push('/network')
      }
    })
  }

  return (
    <div className="min-h-screen bg-clinical-light">
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.back()}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800">Add colleague</span>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="mb-5">
          <h1 className="font-display text-2xl text-navy-800 mb-1">Add clinical colleague</h1>
          <p className="text-sm text-navy-800/50">Only name and city are required — add more details any time.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="card-clinical space-y-4">

            {/* Required */}
            <div>
              <label className="data-label block mb-1.5">Full name <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={form.name}
                onChange={e => update('name', e.target.value)}
                placeholder="Dr. Rajesh Mehta"
                className="input-clinical"
                autoFocus
                required
              />
            </div>

            <div>
              <label className="data-label block mb-1.5">City <span className="text-red-400">*</span></label>
              <select
                value={form.city}
                onChange={e => update('city', e.target.value)}
                className="input-clinical"
                required
              >
                <option value="">Select city</option>
                {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Optional */}
            <div>
              <label className="data-label block mb-1.5">Specialty</label>
              <select
                value={form.specialty}
                onChange={e => update('specialty', e.target.value)}
                className="input-clinical"
              >
                <option value="">Select specialty (optional)</option>
                {SPECIALTIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Toggle more fields */}
            <button
              type="button"
              onClick={() => setShowMore(!showMore)}
              className="text-xs text-navy-800/50 hover:text-navy-800/70 transition-colors"
            >
              {showMore ? 'Show fewer fields' : '+ Add clinic and contact details'}
            </button>

            {showMore && (
              <div className="space-y-4 pt-2 border-t border-navy-800/8 animate-fade-in">
                <div>
                  <label className="data-label block mb-1.5">Clinic / hospital name</label>
                  <input
                    type="text"
                    value={form.clinic_name}
                    onChange={e => update('clinic_name', e.target.value)}
                    placeholder="Sunshine Clinic"
                    className="input-clinical"
                  />
                </div>

                <div>
                  <label className="data-label block mb-1.5">Area / locality</label>
                  <input
                    type="text"
                    value={form.clinic_area}
                    onChange={e => update('clinic_area', e.target.value)}
                    placeholder="Banjara Hills"
                    className="input-clinical"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="data-label block mb-1.5">Mobile</label>
                    <input
                      type="tel"
                      value={form.mobile}
                      onChange={e => update('mobile', e.target.value)}
                      placeholder="9876543210"
                      className="input-clinical"
                    />
                  </div>
                  <div>
                    <label className="data-label block mb-1.5">WhatsApp</label>
                    <input
                      type="tel"
                      value={form.whatsapp}
                      onChange={e => update('whatsapp', e.target.value)}
                      placeholder="9876543210"
                      className="input-clinical"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isPending || !form.name.trim() || !form.city}
            className="btn-primary w-full"
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Adding to network...
              </span>
            ) : 'Add to peer network'}
          </button>
        </form>
      </main>
    </div>
  )
}
