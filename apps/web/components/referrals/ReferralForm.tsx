'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { submitReferralAction } from '@/app/actions/referrals'

type Props = {
  token: string
  specialistName: string
  specialistSpecialty: string
  specialistCity: string
}

const URGENCY_OPTIONS = [
  { value: 'routine',   label: 'Routine',   desc: 'Non-urgent, schedule at convenience' },
  { value: 'urgent',    label: 'Urgent',    desc: 'Within 48–72 hours' },
  { value: 'emergency', label: 'Emergency', desc: 'Requires immediate attention' },
]

const STEPS = ['Patient', 'Clinical', 'Documents', 'Review']

export default function ReferralForm({
  token, specialistName, specialistSpecialty, specialistCity
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [referenceNo, setReferenceNo] = useState('')
  const [files, setFiles] = useState<File[]>([])

  const [form, setForm] = useState({
    // Doctor identity
    rd_name: '', rd_mobile: '', rd_specialty: '', rd_city: '', rd_clinic: '',
    // Patient
    patient_name: '', patient_dob: '', patient_gender: '',
    patient_mobile: '', poc_referrer_name: '', poc_referrer_mobile: '',
    // Clinical
    chief_complaint: '', soap_notes: '', procedure_recommended: '',
    urgency: 'routine',
    expected_visit_date: '',
    // Vitals
    vitals_bp_systolic: '', vitals_bp_diastolic: '', vitals_heart_rate: '',
    vitals_spo2: '', vitals_weight: '', vitals_rbs: '',
    // History
    medications: '', allergies: '', comorbidities: '',
    // Findings
    ecg_findings: '', lab_summary: '', imaging_summary: '',
  })

  function upd(f: string, v: string) {
    setForm(p => ({ ...p, [f]: v }))
  }

  function canProceed() {
    if (step === 0) return form.rd_name && form.rd_mobile && form.patient_name
    if (step === 1) return form.chief_complaint && form.urgency
    return true
  }

  async function handleSubmit() {
    const fd = new FormData()
    fd.set('specialist_id', '') // filled server-side from token
    fd.set('token', token)

    Object.entries(form).forEach(([k, v]) => { if (v) fd.set(k, v) })
    // Set poc mobile to rd mobile if not provided
    if (!form.poc_referrer_mobile) fd.set('poc_referrer_mobile', form.rd_mobile)

    files.forEach(f => fd.append('documents', f))

    startTransition(async () => {
      const result = await submitReferralAction(fd)
      if (result?.error) {
        toast.error(result.error)
      } else if (result.referenceNo) {
        setReferenceNo(result.referenceNo)
        setSubmitted(true)
      }
    })
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-clinical-light flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center animate-slide-up">
          <div className="w-16 h-16 bg-forest-700 rounded-full flex items-center
                          justify-center mx-auto mb-5">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M5 12l5 5L19 7" stroke="white" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="font-display text-2xl text-navy-800 mb-2">Referral submitted</h1>
          <p className="text-sm text-navy-800/60 mb-4 leading-relaxed">
            Dr. {specialistName} has been notified. You will receive updates
            via WhatsApp as the case progresses.
          </p>
          <div className="card-clinical text-center mb-6">
            <div className="data-label mb-1">Reference number</div>
            <div className="font-mono text-lg font-medium text-navy-800">{referenceNo}</div>
            <p className="text-xs text-navy-800/40 mt-1">Save this for your records</p>
          </div>
          <p className="text-xs text-navy-800/40">
            Powered by ClinCollab · clincollab.com
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Header */}
      <div className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center gap-2.5 mb-2">
            <Image src="/logo.png" alt="ClinCollab" width={24} height={24} />
            <div>
              <div className="text-xs font-medium text-navy-800">
                Referral to Dr. {specialistName}
              </div>
              <div className="text-2xs text-navy-800/50">
                {specialistSpecialty.replace(/_/g, ' ')} · {specialistCity}
              </div>
            </div>
          </div>
          {/* Progress */}
          <div className="flex gap-1">
            {STEPS.map((s, i) => (
              <div key={s} className="flex-1">
                <div className={`h-1 rounded-full transition-all duration-300
                  ${i <= step ? 'bg-navy-800' : 'bg-navy-800/15'}`} />
                <div className={`text-2xs mt-0.5 text-center transition-colors
                  ${i === step ? 'text-navy-800' : 'text-navy-800/30'}`}>
                  {s}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-5">

        {/* Step 0 — Doctor + Patient identity */}
        {step === 0 && (
          <div className="space-y-4 animate-fade-in">
            <div className="card-clinical space-y-4">
              <div className="data-label">Your details (referring doctor)</div>
              <div>
                <label className="data-label block mb-1.5">Your name <span className="text-red-400">*</span></label>
                <input value={form.rd_name} onChange={e => upd('rd_name', e.target.value)}
                  placeholder="Dr. Rajesh Mehta" className="input-clinical" autoFocus />
              </div>
              <div>
                <label className="data-label block mb-1.5">Your mobile (for updates) <span className="text-red-400">*</span></label>
                <input value={form.rd_mobile} onChange={e => upd('rd_mobile', e.target.value)}
                  placeholder="9876543210" type="tel" className="input-clinical" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="data-label block mb-1.5">Specialty</label>
                  <input value={form.rd_specialty} onChange={e => upd('rd_specialty', e.target.value)}
                    placeholder="Diabetologist" className="input-clinical text-sm" />
                </div>
                <div>
                  <label className="data-label block mb-1.5">City</label>
                  <input value={form.rd_city} onChange={e => upd('rd_city', e.target.value)}
                    placeholder="Hyderabad" className="input-clinical text-sm" />
                </div>
              </div>
            </div>

            <div className="card-clinical space-y-4">
              <div className="data-label">Patient details</div>
              <div>
                <label className="data-label block mb-1.5">Patient name <span className="text-red-400">*</span></label>
                <input value={form.patient_name} onChange={e => upd('patient_name', e.target.value)}
                  placeholder="Full name" className="input-clinical" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="data-label block mb-1.5">Date of birth</label>
                  <input type="date" value={form.patient_dob}
                    onChange={e => upd('patient_dob', e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    className="input-clinical text-sm" />
                </div>
                <div>
                  <label className="data-label block mb-1.5">Gender</label>
                  <select value={form.patient_gender}
                    onChange={e => upd('patient_gender', e.target.value)}
                    className="input-clinical text-sm">
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="data-label block mb-1.5">Patient mobile</label>
                <input value={form.patient_mobile} onChange={e => upd('patient_mobile', e.target.value)}
                  placeholder="Patient or NOK number" type="tel" className="input-clinical" />
              </div>
            </div>
          </div>
        )}

        {/* Step 1 — Clinical summary */}
        {step === 1 && (
          <div className="space-y-4 animate-fade-in">
            <div className="card-clinical space-y-4">
              <div className="data-label">Clinical summary</div>

              <div>
                <label className="data-label block mb-1.5">Chief complaint <span className="text-red-400">*</span></label>
                <textarea value={form.chief_complaint}
                  onChange={e => upd('chief_complaint', e.target.value)}
                  placeholder="Presenting complaint and duration..."
                  rows={3} className="input-clinical resize-none text-sm" />
              </div>

              <div>
                <label className="data-label block mb-1.5">SOAP notes / clinical summary</label>
                <textarea value={form.soap_notes}
                  onChange={e => upd('soap_notes', e.target.value)}
                  placeholder="Subjective findings, objective examination, assessment..."
                  rows={4} className="input-clinical resize-none text-sm" />
              </div>

              <div>
                <label className="data-label block mb-1.5">Procedure recommended</label>
                <input value={form.procedure_recommended}
                  onChange={e => upd('procedure_recommended', e.target.value)}
                  placeholder="e.g. Coronary angiography, PTCA..."
                  className="input-clinical" />
              </div>

              <div>
                <label className="data-label block mb-2">Urgency <span className="text-red-400">*</span></label>
                <div className="grid grid-cols-3 gap-2">
                  {URGENCY_OPTIONS.map(u => (
                    <button key={u.value} type="button"
                      onClick={() => upd('urgency', u.value)}
                      className={`p-3 rounded-xl border text-left transition-all
                        ${form.urgency === u.value
                          ? u.value === 'emergency' ? 'border-red-400 bg-red-50'
                          : u.value === 'urgent'    ? 'border-amber-400 bg-amber-50'
                          : 'border-navy-800 bg-navy-50'
                          : 'border-navy-800/15 hover:border-navy-800/30'}`}
                    >
                      <div className={`text-xs font-medium mb-0.5
                        ${form.urgency === u.value
                          ? u.value === 'emergency' ? 'text-red-700'
                          : u.value === 'urgent'    ? 'text-amber-700'
                          : 'text-navy-800'
                          : 'text-navy-800/70'}`}>
                        {u.label}
                      </div>
                      <div className="text-2xs text-navy-800/40 leading-tight">{u.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="card-clinical space-y-4">
              <div className="data-label">Vitals (if available)</div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'vitals_bp_systolic', label: 'BP Sys', placeholder: '120' },
                  { key: 'vitals_bp_diastolic', label: 'BP Dia', placeholder: '80' },
                  { key: 'vitals_heart_rate', label: 'Heart rate', placeholder: '72' },
                  { key: 'vitals_spo2', label: 'SpO2 %', placeholder: '98' },
                  { key: 'vitals_weight', label: 'Weight kg', placeholder: '70' },
                  { key: 'vitals_rbs', label: 'RBS mg/dL', placeholder: '140' },
                ].map(v => (
                  <div key={v.key}>
                    <label className="data-label block mb-1">{v.label}</label>
                    <input value={(form as any)[v.key]}
                      onChange={e => upd(v.key, e.target.value)}
                      placeholder={v.placeholder} type="number"
                      className="input-clinical text-sm text-center" />
                  </div>
                ))}
              </div>
            </div>

            <div className="card-clinical space-y-4">
              <div className="data-label">Medical history</div>
              <div>
                <label className="data-label block mb-1.5">Current medications</label>
                <textarea value={form.medications}
                  onChange={e => upd('medications', e.target.value)}
                  placeholder="List current medications with doses..."
                  rows={2} className="input-clinical resize-none text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="data-label block mb-1.5">Allergies</label>
                  <input value={form.allergies}
                    onChange={e => upd('allergies', e.target.value)}
                    placeholder="Drug / food allergies" className="input-clinical text-sm" />
                </div>
                <div>
                  <label className="data-label block mb-1.5">Comorbidities</label>
                  <input value={form.comorbidities}
                    onChange={e => upd('comorbidities', e.target.value)}
                    placeholder="DM, HTN, CKD..." className="input-clinical text-sm" />
                </div>
              </div>
            </div>

            <div className="card-clinical space-y-4">
              <div className="data-label">Investigation findings (if available)</div>
              {[
                { key: 'ecg_findings', label: 'ECG findings', placeholder: 'e.g. ST elevation in V1-V4...' },
                { key: 'lab_summary', label: 'Lab results', placeholder: 'Key lab values...' },
                { key: 'imaging_summary', label: 'Imaging / echo', placeholder: 'ECHO / X-ray / CT findings...' },
              ].map(f => (
                <div key={f.key}>
                  <label className="data-label block mb-1.5">{f.label}</label>
                  <textarea value={(form as any)[f.key]}
                    onChange={e => upd(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    rows={2} className="input-clinical resize-none text-sm" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — Documents */}
        {step === 2 && (
          <div className="space-y-4 animate-fade-in">
            <div className="card-clinical">
              <div className="data-label mb-3">Upload documents (optional)</div>
              <p className="text-xs text-navy-800/50 mb-4 leading-relaxed">
                Upload prescription, ECG, lab reports, discharge summary, or any
                relevant clinical documents. Up to 5 files, 10MB each.
                JPEG, PNG, PDF accepted.
              </p>

              <label className="block border-2 border-dashed border-navy-800/20
                                rounded-xl p-6 text-center cursor-pointer
                                hover:border-navy-800/40 transition-colors">
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.heic,.pdf"
                  className="hidden"
                  onChange={e => {
                    const newFiles = Array.from(e.target.files || [])
                    const combined = [...files, ...newFiles].slice(0, 5)
                    setFiles(combined)
                  }}
                />
                <div className="text-navy-800/40 text-sm mb-1">
                  Tap to upload
                </div>
                <div className="text-xs text-navy-800/30">
                  or take a photo of the document
                </div>
              </label>

              {files.length > 0 && (
                <div className="mt-3 space-y-2">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 p-2.5 bg-navy-50
                                            rounded-xl text-sm">
                      <span className="text-2xs bg-navy-800/10 text-navy-800/60
                                       px-1.5 py-0.5 rounded font-mono uppercase">
                        {f.name.split('.').pop()}
                      </span>
                      <span className="flex-1 truncate text-navy-800/70 text-xs">
                        {f.name}
                      </span>
                      <span className="text-xs text-navy-800/40">
                        {(f.size / 1024).toFixed(0)}KB
                      </span>
                      <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-600 transition-colors text-xs">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card-clinical space-y-3">
              <div className="data-label">Coordination</div>
              <div>
                <label className="data-label block mb-1.5">Expected visit date</label>
                <input type="date" value={form.expected_visit_date}
                  onChange={e => upd('expected_visit_date', e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="input-clinical" />
              </div>
            </div>
          </div>
        )}

        {/* Step 3 — Review */}
        {step === 3 && (
          <div className="space-y-4 animate-fade-in">
            <div className="card-clinical space-y-3">
              <div className="data-label">Review before submitting</div>

              {[
                { label: 'Referring doctor', value: `Dr. ${form.rd_name} · ${form.rd_specialty || '—'} · ${form.rd_city || '—'}` },
                { label: 'Patient', value: `${form.patient_name} · ${form.patient_gender || '—'} · ${form.patient_dob || '—'}` },
                { label: 'Chief complaint', value: form.chief_complaint },
                { label: 'Urgency', value: form.urgency.charAt(0).toUpperCase() + form.urgency.slice(1) },
                { label: 'Documents', value: files.length > 0 ? `${files.length} file(s)` : 'None' },
              ].map(row => (
                <div key={row.label} className="flex gap-3 py-2 border-b border-navy-800/5 last:border-0">
                  <span className="data-label w-36 flex-shrink-0">{row.label}</span>
                  <span className="text-sm text-navy-800 leading-relaxed">{row.value}</span>
                </div>
              ))}
            </div>

            <div className="bg-navy-50 border border-navy-800/15 rounded-xl p-4">
              <p className="text-xs text-navy-800/60 leading-relaxed">
                By submitting, you confirm this referral is for the clinical benefit
                of the patient and is consistent with the MCI Code of Ethics.
                No financial arrangement is implied.
              </p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-6">
          {step > 0 && (
            <button onClick={() => setStep(s => (s - 1) as any)}
              className="btn-secondary flex-1">
              Back
            </button>
          )}

          {step < 3 ? (
            <button
              onClick={() => setStep(s => (s + 1) as any)}
              disabled={!canProceed()}
              className="btn-primary flex-1"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isPending}
              className="btn-primary flex-1"
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white
                                   rounded-full animate-spin" />
                  Submitting...
                </span>
              ) : 'Submit referral'}
            </button>
          )}
        </div>

      </main>
    </div>
  )
}
