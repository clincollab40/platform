'use client'

import { useState } from 'react'
import { useRouter }  from 'next/navigation'
import Image          from 'next/image'
import { toast }      from 'sonner'
import { provisionOrgAction } from '@/app/actions/provisioning'

// ── Module definitions ──────────────────────────────────────
const MODULES = [
  { key:'m1_identity',          label:'M1 · Identity & Auth',       desc:'Core — always required', alwaysOn: true },
  { key:'m2_network',           label:'M2 · Doctor Network',         desc:'Peer network management' },
  { key:'m3_referrals',         label:'M3 · Referral Workflow',      desc:'End-to-end referral management' },
  { key:'m4_chatbot',           label:'M4 · Patient Chatbot',        desc:'WhatsApp chatbot + appointments' },
  { key:'m5_triage',            label:'M5 · Virtual Triage Nurse',   desc:'Pre-consultation questionnaire' },
  { key:'m6_synthesis',         label:'M6 · 360° Synthesis',         desc:'AI pre-consultation brief' },
  { key:'m7_transcription',     label:'M7 · Transcription Agent',    desc:'AI consultation notes' },
  { key:'m8_procedure_planner', label:'M8 · Procedure Planner',      desc:'End-to-end procedure coordination' },
  { key:'m9_communication',     label:'M9 · Closed-Loop Comms',      desc:'Stakeholder communication engine' },
  { key:'m10_content',          label:'M10 · Clinical Content',      desc:'AI medical content generation' },
]

const GEOGRAPHIES = ['india','gcc','sea','uk','aus','usa','global']

const STEP_LABELS = [
  'Organisation details',
  'Package selection',
  'Module configuration',
  'Admin user',
  'Review & provision',
]

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
}

// ── Plan tier pill colours ───────────────────────────────────
const TIER_COLOURS: Record<string, string> = {
  starter:      'bg-slate-100 text-slate-700 border-slate-200',
  growth:       'bg-blue-50  text-blue-700  border-blue-200',
  professional: 'bg-purple-50 text-purple-700 border-purple-200',
  enterprise:   'bg-amber-50 text-amber-800 border-amber-300',
  custom:       'bg-navy-50  text-navy-800  border-navy-300',
}

export default function ProvisioningWizardClient({
  admin, plans,
}: {
  admin: { id: string; name: string }
  plans: any[]
}) {
  const router = useRouter()
  const [step, setStep]     = useState(0)
  const [saving, setSaving] = useState(false)

  // Step 0 — Org details
  const [orgName,     setOrgName]     = useState('')
  const [orgSlug,     setOrgSlug]     = useState('')
  const [adminEmail,  setAdminEmail]  = useState('')
  const [geography,   setGeography]   = useState('india')
  const [city,        setCity]        = useState('')
  const [phone,       setPhone]       = useState('')
  const [maxSpecs,    setMaxSpecs]    = useState(10)
  const [hipaa,       setHipaa]       = useState(false)
  const [gdpr,        setGdpr]        = useState(false)
  const [abdm,        setAbdm]        = useState(true)

  // Step 1 — Plan
  const [planTier, setPlanTier] = useState('starter')

  // Step 2 — Module overrides
  const selectedPlan   = plans.find(p => p.tier === planTier)
  const planModules: string[] = selectedPlan?.enabled_modules || ['m1_identity']
  const [moduleOverrides, setModuleOverrides] = useState<Record<string, boolean>>({})

  function isModuleEnabled(key: string): boolean {
    if (key === 'm1_identity') return true
    if (moduleOverrides[key] !== undefined) return moduleOverrides[key]
    return planModules.includes(key)
  }

  // Step 3 — Admin invite
  const [sendInvite,     setSendInvite]     = useState(true)
  const [inviteMessage,  setInviteMessage]  = useState('')

  // ── Validation per step ──────────────────────────────────
  function canProceed(): boolean {
    if (step === 0) return orgName.trim().length >= 2 && orgSlug.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)
    if (step === 1) return !!planTier
    return true
  }

  // ── Submit ───────────────────────────────────────────────
  async function handleProvision() {
    setSaving(true)
    try {
      const r = await provisionOrgAction({
        name:          orgName.trim(),
        slug:          orgSlug.trim(),
        planTier,
        adminEmail:    adminEmail.trim(),
        geography,
        city:          city.trim() || undefined,
        phone:         phone.trim() || undefined,
        maxSpecialists: maxSpecs,
        hipaaMode:     hipaa,
        gdprMode:      gdpr,
        abdmMode:      abdm,
        moduleOverrides,
        sendInvitation: sendInvite,
        inviteMessage:  inviteMessage.trim() || undefined,
      })

      if (!r.ok) {
        toast.error(r.error || 'Provisioning failed')
        setSaving(false)
        return
      }

      toast.success(`${orgName} provisioned successfully!`)
      router.push(`/admin/orgs/${r.value.orgId}`)
    } catch (e: any) {
      toast.error(e?.message || 'Unexpected error')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-clinical-light">

      {/* Nav */}
      <nav className="bg-navy-900 border-b border-navy-700 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/admin')} className="text-navy-400 hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="text-sm font-medium text-white">Provision New Organisation</span>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-6">

        {/* Step indicator */}
        <div className="flex items-center gap-1.5 mb-6">
          {STEP_LABELS.map((label, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className={`flex items-center gap-1.5 ${i <= step ? 'opacity-100' : 'opacity-30'}`}>
                <div className={`w-6 h-6 rounded-full text-2xs font-semibold flex items-center justify-center flex-shrink-0
                  ${i < step ? 'bg-forest-600 text-white' : i === step ? 'bg-navy-800 text-white' : 'bg-navy-800/20 text-navy-800/50'}`}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span className={`text-xs hidden sm:block ${i === step ? 'text-navy-800 font-medium' : 'text-navy-800/50'}`}>{label}</span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className={`h-px flex-1 w-4 ${i < step ? 'bg-forest-600' : 'bg-navy-800/15'}`}/>
              )}
            </div>
          ))}
        </div>

        {/* ── STEP 0: Organisation Details ──────────────────── */}
        {step === 0 && (
          <div className="bg-white rounded-2xl border border-navy-800/10 p-6 space-y-4">
            <h2 className="text-base font-semibold text-navy-800">Organisation details</h2>

            <div>
              <label className="data-label block mb-1">Organisation name *</label>
              <input type="text" value={orgName}
                onChange={e => { setOrgName(e.target.value); setOrgSlug(slugify(e.target.value)) }}
                placeholder="e.g. Apollo Hospitals Hyderabad"
                className="input-clinical" />
            </div>

            <div>
              <label className="data-label block mb-1">URL slug * <span className="text-navy-800/40">(auto-generated)</span></label>
              <div className="flex items-center gap-2 input-clinical px-0 overflow-hidden">
                <span className="px-3 text-navy-800/40 text-xs border-r border-navy-800/15 h-full flex items-center">app.clincollab.com/</span>
                <input type="text" value={orgSlug} onChange={e => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''))}
                  className="flex-1 bg-transparent outline-none px-2 py-2 text-sm" placeholder="apollo-hyderabad" />
              </div>
            </div>

            <div>
              <label className="data-label block mb-1">Admin email *</label>
              <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
                placeholder="admin@hospital.com" className="input-clinical" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="data-label block mb-1">Geography</label>
                <select value={geography} onChange={e => setGeography(e.target.value)} className="input-clinical capitalize">
                  {GEOGRAPHIES.map(g => <option key={g} value={g} className="capitalize">{g}</option>)}
                </select>
              </div>
              <div>
                <label className="data-label block mb-1">City</label>
                <input type="text" value={city} onChange={e => setCity(e.target.value)}
                  placeholder="Hyderabad" className="input-clinical" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="data-label block mb-1">Phone</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="+91 40 xxxx xxxx" className="input-clinical" />
              </div>
              <div>
                <label className="data-label block mb-1">Max specialists</label>
                <input type="number" value={maxSpecs} min={1} max={500}
                  onChange={e => setMaxSpecs(parseInt(e.target.value) || 10)}
                  className="input-clinical" />
              </div>
            </div>

            {/* Compliance */}
            <div>
              <div className="data-label mb-2">Compliance requirements</div>
              <div className="flex flex-wrap gap-3">
                {[
                  { key:'abdm', label:'ABDM (India)', val: abdm, set: setAbdm },
                  { key:'hipaa', label:'HIPAA',        val: hipaa, set: setHipaa },
                  { key:'gdpr',  label:'GDPR',          val: gdpr,  set: setGdpr },
                ].map(f => (
                  <label key={f.key} className="flex items-center gap-2 cursor-pointer">
                    <div onClick={() => f.set(!f.val)}
                      className={`w-9 h-5 rounded-full transition-colors cursor-pointer ${f.val ? 'bg-navy-800' : 'bg-navy-800/20'}`}
                      style={{ position:'relative' }}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${f.val ? 'translate-x-4' : 'translate-x-0.5'}`}/>
                    </div>
                    <span className="text-xs text-navy-800">{f.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 1: Package Selection ─────────────────────── */}
        {step === 1 && (
          <div className="bg-white rounded-2xl border border-navy-800/10 p-6 space-y-4">
            <h2 className="text-base font-semibold text-navy-800">Select package</h2>
            <p className="text-xs text-navy-800/60">The plan determines which modules are enabled by default. You can override individual modules in the next step.</p>

            <div className="space-y-2">
              {plans.map(plan => {
                const selected = plan.tier === planTier
                return (
                  <button key={plan.tier} onClick={() => setPlanTier(plan.tier)}
                    className={`w-full text-left rounded-xl border-2 p-4 transition-all ${selected ? 'border-navy-800 bg-navy-50' : 'border-navy-800/10 hover:border-navy-800/30'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${selected ? 'border-navy-800 bg-navy-800' : 'border-navy-800/30'}`}>
                          {selected && <div className="w-2 h-2 rounded-full bg-white m-auto mt-0.5"/>}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded border capitalize ${TIER_COLOURS[plan.tier] || 'bg-navy-50 text-navy-800 border-navy-200'}`}>
                              {plan.tier}
                            </span>
                            {plan.display_name && (
                              <span className="text-sm font-medium text-navy-800">{plan.display_name}</span>
                            )}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {(plan.enabled_modules || []).map((mk: string) => {
                              const mod = MODULES.find(m => m.key === mk)
                              return (
                                <span key={mk} className="text-2xs bg-forest-50 text-forest-700 px-1.5 py-0.5 rounded">
                                  {mod?.label.split(' · ')[0] || mk}
                                </span>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {plan.default_max_specialists && (
                          <div className="text-xs text-navy-800/50">Up to {plan.default_max_specialists} specialists</div>
                        )}
                        {plan.monthly_price_inr && (
                          <div className="text-sm font-semibold text-navy-800">₹{plan.monthly_price_inr?.toLocaleString('en-IN')}/mo</div>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── STEP 2: Module Override ───────────────────────── */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-navy-800/10 p-6 space-y-3">
            <div>
              <h2 className="text-base font-semibold text-navy-800">Module configuration</h2>
              <p className="text-xs text-navy-800/60 mt-0.5">
                Modules shaded in green are included in the <span className="font-medium capitalize">{planTier}</span> plan.
                Toggle individual modules to override the plan defaults.
              </p>
            </div>

            {MODULES.map(mod => {
              const fromPlan = planModules.includes(mod.key)
              const enabled  = isModuleEnabled(mod.key)
              const isOverridden = !mod.alwaysOn && moduleOverrides[mod.key] !== undefined

              return (
                <div key={mod.key}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all
                    ${enabled ? 'bg-forest-50/40 border-forest-200/60' : 'border-navy-800/8 opacity-60'}`}>
                  <button
                    onClick={() => {
                      if (mod.alwaysOn) return
                      setModuleOverrides(prev => {
                        const next = { ...prev }
                        if (next[mod.key] !== undefined) {
                          // If already overridden, toggle to opposite
                          next[mod.key] = !next[mod.key]
                        } else {
                          // First override — flip from plan default
                          next[mod.key] = !fromPlan
                        }
                        return next
                      })
                    }}
                    disabled={mod.alwaysOn}
                    className={`relative flex-shrink-0 rounded-full transition-all ${enabled ? 'bg-forest-600' : 'bg-navy-800/20'} ${mod.alwaysOn ? 'cursor-default' : 'cursor-pointer'}`}
                    style={{ width: '36px', height: '20px' }}>
                    <span className={`absolute top-0.5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
                      style={{ width: '16px', height: '16px' }}/>
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-navy-800">{mod.label}</span>
                      {mod.alwaysOn && <span className="text-2xs bg-navy-800/8 text-navy-800/40 px-1.5 py-0.5 rounded">Always on</span>}
                      {!mod.alwaysOn && !fromPlan && enabled && (
                        <span className="text-2xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Added</span>
                      )}
                      {!mod.alwaysOn && fromPlan && !enabled && (
                        <span className="text-2xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Removed</span>
                      )}
                    </div>
                    <div className="text-2xs text-navy-800/40">{mod.desc}</div>
                  </div>
                </div>
              )
            })}

            {Object.keys(moduleOverrides).length > 0 && (
              <button onClick={() => setModuleOverrides({})}
                className="text-xs text-navy-800/50 hover:text-navy-800 transition-colors underline mt-1">
                Reset to plan defaults
              </button>
            )}
          </div>
        )}

        {/* ── STEP 3: Admin User ────────────────────────────── */}
        {step === 3 && (
          <div className="bg-white rounded-2xl border border-navy-800/10 p-6 space-y-4">
            <h2 className="text-base font-semibold text-navy-800">Admin user setup</h2>
            <p className="text-xs text-navy-800/60">
              The organisation admin email is <strong>{adminEmail}</strong>. Send them an invitation to join the platform as the org owner.
            </p>

            <div className="flex items-center gap-3 p-4 rounded-xl border border-navy-800/10 bg-navy-50">
              <button onClick={() => setSendInvite(!sendInvite)}
                className={`relative flex-shrink-0 rounded-full transition-all cursor-pointer ${sendInvite ? 'bg-navy-800' : 'bg-navy-800/20'}`}
                style={{ width: '40px', height: '22px' }}>
                <span className={`absolute top-0.5 rounded-full bg-white shadow-sm transition-transform ${sendInvite ? 'translate-x-5' : 'translate-x-0.5'}`}
                  style={{ width: '18px', height: '18px' }}/>
              </button>
              <div>
                <div className="text-sm font-medium text-navy-800">Send invitation email</div>
                <div className="text-xs text-navy-800/50">A 7-day invitation link will be created for {adminEmail}</div>
              </div>
            </div>

            {sendInvite && (
              <div>
                <label className="data-label block mb-1">Personal message (optional)</label>
                <textarea value={inviteMessage} onChange={e => setInviteMessage(e.target.value)}
                  rows={3} placeholder="Welcome to ClinCollab! Here's how to get started..."
                  className="input-clinical resize-none" />
              </div>
            )}

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-xs text-amber-800">
                Note: The invitation creates a pending record. The actual email delivery requires an email service to be configured (Resend/SendGrid). The invite link will be visible in the provisioning checklist.
              </p>
            </div>
          </div>
        )}

        {/* ── STEP 4: Review & Provision ────────────────────── */}
        {step === 4 && (
          <div className="space-y-3">
            <div className="bg-white rounded-2xl border border-navy-800/10 p-6">
              <h2 className="text-base font-semibold text-navy-800 mb-4">Review & confirm</h2>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-2 border-b border-navy-800/6">
                  <span className="text-navy-800/60">Organisation</span>
                  <span className="font-medium text-navy-800">{orgName}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-navy-800/6">
                  <span className="text-navy-800/60">Slug</span>
                  <span className="font-mono text-xs text-navy-800">{orgSlug}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-navy-800/6">
                  <span className="text-navy-800/60">Admin email</span>
                  <span className="text-navy-800">{adminEmail}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-navy-800/6">
                  <span className="text-navy-800/60">Plan</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded border capitalize ${TIER_COLOURS[planTier]}`}>{planTier}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-navy-800/6">
                  <span className="text-navy-800/60">Geography</span>
                  <span className="text-navy-800 capitalize">{geography}{city ? `, ${city}` : ''}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-navy-800/6">
                  <span className="text-navy-800/60">Max specialists</span>
                  <span className="text-navy-800">{maxSpecs}</span>
                </div>
                <div className="flex justify-between items-start py-2 border-b border-navy-800/6">
                  <span className="text-navy-800/60">Modules</span>
                  <div className="flex flex-wrap gap-1 justify-end max-w-xs">
                    {MODULES.filter(m => isModuleEnabled(m.key)).map(m => (
                      <span key={m.key} className="text-2xs bg-forest-50 text-forest-700 px-1.5 py-0.5 rounded">
                        {m.label.split(' · ')[0]}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between py-2 border-b border-navy-800/6">
                  <span className="text-navy-800/60">Compliance</span>
                  <span className="text-navy-800 text-xs">{[hipaa&&'HIPAA',gdpr&&'GDPR',abdm&&'ABDM'].filter(Boolean).join(', ') || 'None'}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-navy-800/60">Invitation</span>
                  <span className={`text-xs font-medium ${sendInvite ? 'text-forest-700' : 'text-navy-800/40'}`}>
                    {sendInvite ? `Will be sent to ${adminEmail}` : 'Not sending'}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-navy-50 border border-navy-800/10 rounded-xl p-4">
              <p className="text-xs text-navy-800/70">
                Clicking <strong>Provision</strong> will create the organisation record, configure modules,
                seed the implementation checklist, and optionally send the admin invitation.
                The org status will be set to <strong>Trial</strong> with a 30-day trial period.
              </p>
            </div>
          </div>
        )}

        {/* ── Navigation buttons ───────────────────────────── */}
        <div className="flex items-center justify-between mt-5">
          <button
            onClick={() => step > 0 ? setStep(s => s - 1) : router.push('/admin')}
            disabled={saving}
            className="btn-secondary text-sm py-2 px-5">
            {step === 0 ? 'Cancel' : '← Back'}
          </button>

          {step < STEP_LABELS.length - 1 ? (
            <button onClick={() => setStep(s => s + 1)} disabled={!canProceed()}
              className="btn-primary text-sm py-2 px-6 disabled:opacity-40 disabled:cursor-not-allowed">
              Continue →
            </button>
          ) : (
            <button onClick={handleProvision} disabled={saving}
              className="btn-primary text-sm py-2 px-6 disabled:opacity-60">
              {saving ? 'Provisioning…' : 'Provision organisation'}
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
