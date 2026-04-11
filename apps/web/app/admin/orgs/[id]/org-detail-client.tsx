'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  toggleModuleAction, updateFeatureFlagsAction,
  setSpecialistPermissionAction, changePlanAction,
  updateOrgAction, assignSpecialistToOrgAction,
} from '@/app/actions/admin'
import {
  getImplementationStepsAction, updateStepAction,
  runTestSuiteAction, getTestRunsAction,
  inviteUserAction, getInvitationsAction, revokeInvitationAction,
} from '@/app/actions/provisioning'

const MODULES = [
  { key:'m1_identity',         label:'M1 · Identity & Auth',       desc:'Core — always required', alwaysOn: true },
  { key:'m2_network',          label:'M2 · Doctor Network',         desc:'Peer network management' },
  { key:'m3_referrals',        label:'M3 · Referral Workflow',      desc:'End-to-end referral management' },
  { key:'m4_chatbot',          label:'M4 · Patient Chatbot',        desc:'WhatsApp chatbot + appointments' },
  { key:'m5_triage',           label:'M5 · Virtual Triage Nurse',   desc:'Pre-consultation questionnaire' },
  { key:'m6_synthesis',        label:'M6 · 360° Synthesis',         desc:'AI pre-consultation brief' },
  { key:'m7_transcription',    label:'M7 · Transcription Agent',    desc:'AI consultation notes' },
  { key:'m8_procedure_planner',label:'M8 · Procedure Planner',      desc:'End-to-end procedure coordination' },
  { key:'m9_communication',    label:'M9 · Closed-Loop Comms',      desc:'Stakeholder communication engine' },
  { key:'m10_content',         label:'M10 · Clinical Content',      desc:'AI medical content generation' },
]

const PLAN_TIERS = ['starter','growth','professional','enterprise','custom']

const RISK_COLOURS: Record<string, string> = {
  low:'text-forest-700', medium:'text-amber-700', high:'text-red-600', critical:'text-red-700'
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
}

export default function OrgDetailClient({ org, usage, auditLog, flagRegistry, allSpecialists, admin }: {
  org: any; usage: any; auditLog: any[]; flagRegistry: any[]; allSpecialists: any[]; admin: any
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<'modules'|'specialists'|'usage'|'settings'|'audit'|'provision'|'tests'>('modules')

  // Provision tab state
  const [steps,         setSteps]         = useState<any[]>([])
  const [stepsLoading,  setStepsLoading]  = useState(false)
  const [invitations,   setInvitations]   = useState<any[]>([])
  const [inviteEmail,   setInviteEmail]   = useState('')
  const [inviteRole,    setInviteRole]    = useState<'owner'|'admin'|'member'>('member')
  const [inviteMsg,     setInviteMsg]     = useState('')
  const [inviting,      setInviting]      = useState(false)

  // Test Runner tab state
  const [testRuns,       setTestRuns]      = useState<any[]>([])
  const [testRunning,    setTestRunning]   = useState(false)
  const [expandedRun,    setExpandedRun]   = useState<string | null>(null)

  const loadProvisionData = useCallback(async () => {
    setStepsLoading(true)
    const [stepsRes, invRes] = await Promise.all([
      getImplementationStepsAction(org.id),
      getInvitationsAction(org.id),
    ])
    if (stepsRes.ok)  setSteps(stepsRes.value)
    if (invRes.ok)    setInvitations(invRes.value)
    setStepsLoading(false)
  }, [org.id])

  const loadTestRuns = useCallback(async () => {
    const r = await getTestRunsAction(org.id)
    if (r.ok) setTestRuns(r.value)
  }, [org.id])

  useEffect(() => {
    if (tab === 'provision') loadProvisionData()
    if (tab === 'tests')     loadTestRuns()
  }, [tab, loadProvisionData, loadTestRuns])
  const [reason, setReason] = useState('')
  const [expandedModule, setExpandedModule] = useState<string | null>(null)
  const [pendingChanges, setPendingChanges] = useState<Record<string, any>>({})

  const moduleConfig: Record<string, any> = {}
  for (const m of (org.org_module_config || [])) {
    moduleConfig[m.module_key] = m
  }

  function getModuleEnabled(key: string): boolean {
    return moduleConfig[key]?.is_enabled ?? false
  }

  function getFlag(moduleKey: string, flagKey: string): boolean {
    return moduleConfig[moduleKey]?.feature_flags?.[flagKey] ?? false
  }

  function toggleModule(key: string, currentValue: boolean) {
    if (key === 'm1_identity') return // Always on
    startTransition(async () => {
      const r = await toggleModuleAction(org.id, key, !currentValue, reason || undefined)
      if (!r.ok) toast.error(r.error)
      else { toast.success(`${key} ${!currentValue ? 'enabled' : 'disabled'}`); router.refresh() }
    })
  }

  function updateFlag(moduleKey: string, flagKey: string, value: boolean) {
    startTransition(async () => {
      const r = await updateFeatureFlagsAction(org.id, moduleKey, { [flagKey]: value }, reason || undefined)
      if (!r.ok) toast.error(r.error)
      else { toast.success('Feature flag updated'); router.refresh() }
    })
  }

  function changePlan(newTier: string) {
    if (!reason.trim()) { toast.error('Please enter a reason for the plan change'); return }
    startTransition(async () => {
      const r = await changePlanAction(org.id, newTier, reason)
      if (!r.ok) toast.error(r.error)
      else { toast.success(`Plan changed to ${newTier}`); setReason(''); router.refresh() }
    })
  }

  const orgSpecialists = (org.org_specialists || []).filter((os: any) => os.is_active)
  const notInOrg = allSpecialists.filter((s: any) => !orgSpecialists.some((os: any) => os.specialist_id === s.id))
  const flagsByModule: Record<string, any[]> = {}
  for (const flag of flagRegistry) {
    if (!flagsByModule[flag.module_key]) flagsByModule[flag.module_key] = []
    flagsByModule[flag.module_key].push(flag)
  }

  const tabs = [
    { key:'modules',      label:'Modules & Flags' },
    { key:'specialists',  label:`Specialists (${orgSpecialists.length})` },
    { key:'usage',        label:'Usage' },
    { key:'settings',     label:'Settings' },
    { key:'audit',        label:`Audit (${auditLog.length})` },
    { key:'provision',    label:'Provision' },
    { key:'tests',        label:'Tests' },
  ]

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-navy-900 border-b border-navy-700 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/admin')} className="text-navy-400 hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">{org.name}</div>
            <div className="text-2xs text-navy-400">{org.slug} · {org.plan_tier} · {org.status}</div>
          </div>
          <span className={`text-2xs px-2 py-1 rounded-lg font-medium capitalize
            ${org.status === 'active' ? 'bg-forest-900 text-forest-400' :
              org.status === 'trial'  ? 'bg-amber-900/50 text-amber-400' :
              'bg-red-900/50 text-red-400'}`}>
            {org.status}
          </span>
        </div>
      </nav>

      {/* Reason bar — always visible for accountability */}
      <div className="bg-amber-50 border-b border-amber-200/60 sticky top-14 z-30">
        <div className="max-w-4xl mx-auto px-4 py-2 flex items-center gap-3">
          <span className="text-2xs text-amber-700 font-medium flex-shrink-0">Change reason:</span>
          <input type="text" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Required for plan changes · Optional for module toggles"
            className="flex-1 bg-transparent border-none outline-none text-xs text-amber-900 placeholder-amber-700/40" />
          {reason && <button onClick={() => setReason('')} className="text-amber-600 text-xs">Clear</button>}
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-5 space-y-4">

        {/* Tabs */}
        <div className="bg-white rounded-xl border border-navy-800/8 overflow-x-auto">
          <div className="flex">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key as any)}
                className={`flex-shrink-0 px-4 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors
                  ${tab === t.key ? 'text-navy-800 border-navy-800' : 'text-navy-800/40 border-transparent hover:text-navy-800/70'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* MODULES TAB */}
        {tab === 'modules' && (
          <div className="space-y-2">
            <div className="bg-navy-50 rounded-xl px-4 py-3">
              <p className="text-xs text-navy-800/70">
                Toggle modules on/off for <strong>{org.name}</strong>. Feature flags within each module control fine-grained behaviour.
                All changes are logged in the audit trail.
              </p>
            </div>

            {MODULES.map(mod => {
              const enabled   = mod.alwaysOn ? true : getModuleEnabled(mod.key)
              const isExpanded= expandedModule === mod.key
              const modFlags  = flagsByModule[mod.key] || []

              return (
                <div key={mod.key} className={`bg-white rounded-2xl border transition-all ${enabled ? 'border-navy-800/12' : 'border-navy-800/6 opacity-70'}`}>
                  <div className="flex items-center gap-3 px-4 py-4">
                    {/* Toggle */}
                    <button
                      onClick={() => !mod.alwaysOn && toggleModule(mod.key, enabled)}
                      disabled={isPending || mod.alwaysOn}
                      className={`relative w-10 h-5.5 rounded-full transition-all flex-shrink-0 ${enabled ? 'bg-navy-800' : 'bg-navy-800/20'} ${mod.alwaysOn ? 'cursor-default' : 'cursor-pointer hover:opacity-80'}`}
                      style={{ height: '22px', minWidth: '40px' }}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`}/>
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${enabled ? 'text-navy-800' : 'text-navy-800/50'}`}>
                          {mod.label}
                        </span>
                        {mod.alwaysOn && <span className="text-2xs bg-navy-800/8 text-navy-800/50 px-1.5 py-0.5 rounded">Always on</span>}
                        {enabled && modFlags.length > 0 && (
                          <span className="text-2xs text-forest-700/60">{modFlags.length} flags</span>
                        )}
                      </div>
                      <div className="text-xs text-navy-800/40 mt-0.5">{mod.desc}</div>
                    </div>

                    {/* Expand feature flags */}
                    {enabled && modFlags.length > 0 && (
                      <button onClick={() => setExpandedModule(isExpanded ? null : mod.key)}
                        className="text-xs text-navy-800/50 hover:text-navy-800 transition-colors flex items-center gap-1">
                        {isExpanded ? 'Hide flags' : 'Feature flags'}
                        <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
                      </button>
                    )}
                  </div>

                  {/* Feature flags panel */}
                  {isExpanded && enabled && (
                    <div className="border-t border-navy-800/8 px-4 pb-4 pt-3 space-y-2">
                      {modFlags.map(flag => {
                        const currentVal = getFlag(mod.key, flag.flag_key.split('.').slice(1).join('.'))
                        const flagShortKey = flag.flag_key.includes('.') ? flag.flag_key.split('.').slice(1).join('.') : flag.flag_key
                        return (
                          <div key={flag.flag_key} className="flex items-start gap-3 py-1.5 border-b border-navy-800/5 last:border-0">
                            <button
                              onClick={() => updateFlag(mod.key, flagShortKey, !currentVal)}
                              disabled={isPending || flag.requires_admin}
                              className={`relative flex-shrink-0 rounded-full transition-all ${currentVal ? 'bg-forest-700' : 'bg-navy-800/15'} ${flag.requires_admin ? 'cursor-default opacity-50' : 'cursor-pointer'}`}
                              style={{ width: '32px', height: '18px', minWidth: '32px' }}>
                              <span className={`absolute top-0.5 rounded-full bg-white shadow-sm transition-transform ${currentVal ? 'translate-x-3.5' : 'translate-x-0.5'}`}
                                style={{ width: '14px', height: '14px' }}/>
                            </button>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-navy-800">{flag.display_name}</span>
                                <span className={`text-2xs ${RISK_COLOURS[flag.risk_level]}`}>{flag.risk_level}</span>
                                {flag.requires_admin && <span className="text-2xs text-navy-800/30">Super-admin only</span>}
                              </div>
                              <div className="text-2xs text-navy-800/40 leading-relaxed mt-0.5">{flag.description}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* SPECIALISTS TAB */}
        {tab === 'specialists' && (
          <div className="space-y-3">
            {/* Active specialists */}
            <div className="bg-white rounded-2xl border border-navy-800/8">
              <div className="px-5 py-3.5 border-b border-navy-800/8 data-label">
                Active specialists in this org
              </div>
              {orgSpecialists.length === 0 ? (
                <div className="text-center py-8 text-sm text-navy-800/50">No specialists assigned yet</div>
              ) : (
                orgSpecialists.map((os: any, idx: number) => {
                  const spec = os.specialists
                  return (
                    <div key={os.specialist_id}
                      className={`px-5 py-3.5 ${idx < orgSpecialists.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-navy-800">{spec?.name}</span>
                            <span className="text-2xs bg-navy-50 text-navy-800/50 px-1.5 py-0.5 rounded capitalize">{os.org_role}</span>
                          </div>
                          <div className="text-xs text-navy-800/40">{spec?.specialty?.replace(/_/g,' ')} · {spec?.email}</div>
                        </div>
                        {/* Per-specialist module overrides */}
                        <div className="flex gap-1">
                          {['m10_content','m7_transcription','m8_procedure_planner'].map(mk => (
                            <select key={mk}
                              defaultValue="inherit"
                              onChange={e => startTransition(async () => {
                                const r = await setSpecialistPermissionAction(org.id, os.specialist_id, mk, e.target.value as any, reason || undefined)
                                if (!r.ok) toast.error(r.error)
                                else toast.success('Permission updated')
                              })}
                              className="text-2xs border border-navy-800/15 rounded-lg px-1.5 py-1 text-navy-800/60 bg-white">
                              <option value="inherit">{mk.replace('m','M').replace(/_/,'').slice(0,3)} inherit</option>
                              <option value="enabled">enabled</option>
                              <option value="disabled">disabled</option>
                            </select>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Assign specialist */}
            {notInOrg.length > 0 && (
              <div className="bg-white rounded-2xl border border-navy-800/8 p-4">
                <div className="data-label mb-3">Assign specialist to this org</div>
                <div className="flex gap-3">
                  <select id="assign-select" className="input-clinical flex-1 text-sm">
                    <option value="">Select specialist...</option>
                    {notInOrg.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name} — {s.specialty?.replace(/_/g,' ')}</option>
                    ))}
                  </select>
                  <button onClick={() => {
                    const sel = (document.getElementById('assign-select') as HTMLSelectElement)?.value
                    if (!sel) { toast.error('Select a specialist'); return }
                    startTransition(async () => {
                      const r = await assignSpecialistToOrgAction(sel, org.id, 'member')
                      if (!r.ok) toast.error(r.error)
                      else { toast.success('Specialist assigned'); router.refresh() }
                    })
                  }} disabled={isPending} className="btn-primary text-sm py-2 px-4">Assign</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* USAGE TAB */}
        {tab === 'usage' && usage && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total events (30d)', value: usage.totalEvents },
                { label: 'Active modules',      value: Object.keys(usage.byModule).length },
                { label: 'Peak day',            value: Object.values(usage.byDay as Record<string,number>).reduce((a,b)=>Math.max(a,b),0) + ' events' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-2xl border border-navy-800/8 p-4 text-center">
                  <div className="font-display text-2xl font-medium text-navy-800">{s.value}</div>
                  <div className="data-label mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            {/* By module */}
            <div className="bg-white rounded-2xl border border-navy-800/8 p-5">
              <div className="data-label mb-4">Events by module (last 30 days)</div>
              {Object.entries(usage.byModule as Record<string,number>)
                .sort(([,a],[,b])=>b-a)
                .map(([mk, count]) => {
                  const total = usage.totalEvents || 1
                  const pct = Math.round((count / total) * 100)
                  return (
                    <div key={mk} className="flex items-center gap-3 py-2">
                      <span className="text-xs text-navy-800/60 w-36">{mk.replace(/_/g,' ')}</span>
                      <div className="flex-1 h-2 bg-navy-800/5 rounded-full overflow-hidden">
                        <div className="h-full bg-navy-800 rounded-full" style={{ width: `${pct}%` }}/>
                      </div>
                      <span className="text-xs text-navy-800/40 w-8 text-right">{count}</span>
                    </div>
                  )
                })}
            </div>
          </div>
        )}

        {/* SETTINGS TAB */}
        {tab === 'settings' && (
          <div className="space-y-4">
            {/* Plan change */}
            <div className="bg-white rounded-2xl border border-navy-800/8 p-5">
              <div className="data-label mb-4">Change plan tier</div>
              <div className="grid grid-cols-5 gap-2 mb-4">
                {PLAN_TIERS.map(tier => (
                  <button key={tier} onClick={() => changePlan(tier)}
                    disabled={tier === org.plan_tier || isPending}
                    className={`py-3 rounded-xl border text-xs font-medium capitalize transition-all
                      ${tier === org.plan_tier
                        ? 'bg-navy-800 text-white border-navy-800 cursor-default'
                        : 'border-navy-800/15 text-navy-800/70 hover:border-navy-800/40 hover:bg-navy-50 disabled:opacity-30'}`}>
                    {tier}
                    {tier === org.plan_tier && ' ✓'}
                  </button>
                ))}
              </div>
              {!reason && (
                <p className="text-xs text-amber-700/80">Enter a change reason in the bar above before changing the plan.</p>
              )}
            </div>

            {/* Org details */}
            <div className="bg-white rounded-2xl border border-navy-800/8 p-5 space-y-3">
              <div className="data-label mb-1">Organisation details</div>
              {[
                { label: 'Name', field: 'name', value: org.name, type: 'text' },
                { label: 'Admin email', field: 'admin_email', value: org.admin_email, type: 'email' },
                { label: 'City', field: 'city', value: org.city || '', type: 'text' },
              ].map(({ label, field, value, type }) => (
                <div key={field}>
                  <label className="data-label block mb-1">{label}</label>
                  <input type={type} defaultValue={value}
                    onBlur={async e => {
                      if (e.target.value === value) return
                      startTransition(async () => {
                        const r = await updateOrgAction(org.id, { [field]: e.target.value }, reason || undefined)
                        if (!r.ok) toast.error(r.error)
                        else toast.success(`${label} updated`)
                      })
                    }}
                    className="input-clinical" />
                </div>
              ))}
            </div>

            {/* Compliance flags */}
            <div className="bg-white rounded-2xl border border-navy-800/8 p-5">
              <div className="data-label mb-4">Compliance and regulatory flags</div>
              {[
                { key:'hipaa_mode',  label:'HIPAA mode',   desc:'Enables HIPAA-specific data handling',     value:org.hipaa_mode },
                { key:'gdpr_mode',   label:'GDPR mode',    desc:'Enables GDPR data residency and rights',   value:org.gdpr_mode },
                { key:'abdm_mode',   label:'ABDM mode',    desc:'India ABDM health data standards',         value:org.abdm_mode },
                { key:'ucpmp_mode',  label:'UCPMP mode',   desc:'India pharma marketing compliance rules',  value:org.ucpmp_mode },
              ].map(flag => (
                <div key={flag.key} className="flex items-center gap-4 py-2.5 border-b border-navy-800/5 last:border-0">
                  <button
                    onClick={() => startTransition(async () => {
                      const r = await updateOrgAction(org.id, { [flag.key]: !flag.value }, reason || undefined)
                      if (!r.ok) toast.error(r.error)
                      else { toast.success(`${flag.label} ${!flag.value ? 'enabled' : 'disabled'}`); router.refresh() }
                    })}
                    disabled={isPending}
                    className={`relative flex-shrink-0 rounded-full transition-all ${flag.value ? 'bg-navy-800' : 'bg-navy-800/15'}`}
                    style={{ width: '36px', height: '20px' }}>
                    <span className={`absolute top-0.5 rounded-full bg-white shadow-sm transition-transform ${flag.value ? 'translate-x-4' : 'translate-x-0.5'}`}
                      style={{ width: '16px', height: '16px' }}/>
                  </button>
                  <div>
                    <div className="text-sm font-medium text-navy-800">{flag.label}</div>
                    <div className="text-2xs text-navy-800/40">{flag.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AUDIT TAB */}
        {tab === 'audit' && (
          <div className="bg-white rounded-2xl border border-navy-800/8 p-0 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-navy-800/8 data-label">
              Configuration change history (most recent first)
            </div>
            {auditLog.length === 0 ? (
              <div className="text-center py-8 text-sm text-navy-800/50">No changes recorded yet</div>
            ) : (
              auditLog.map((entry: any, idx: number) => (
                <div key={entry.id}
                  className={`px-5 py-3.5 ${idx < auditLog.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      entry.change_type.includes('enabled')  ? 'bg-forest-600' :
                      entry.change_type.includes('disabled') ? 'bg-red-500' :
                      entry.change_type.includes('plan')     ? 'bg-purple-500' : 'bg-amber-500'}`}/>
                    <div className="flex-1">
                      <div className="text-xs font-medium text-navy-800 capitalize">
                        {entry.change_type.replace(/_/g, ' ')} — {entry.field_name}
                      </div>
                      <div className="text-2xs text-navy-800/50 mt-0.5">
                        {entry.old_value && entry.new_value
                          ? `${entry.old_value} → ${entry.new_value}`
                          : entry.new_value || entry.old_value}
                        {entry.change_reason && ` · "${entry.change_reason}"`}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-2xs text-navy-800/40">
                        {(entry.specialists as any)?.name || 'System'}
                      </div>
                      <div className="text-2xs text-navy-800/30">
                        {new Date(entry.changed_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
        {/* PROVISION TAB */}
        {tab === 'provision' && (
          <div className="space-y-4">
            {/* Implementation checklist */}
            <div className="bg-white rounded-2xl border border-navy-800/8">
              <div className="px-5 py-3.5 border-b border-navy-800/8 flex items-center justify-between">
                <span className="data-label">Implementation checklist</span>
                <button onClick={loadProvisionData} className="text-xs text-navy-800/50 hover:text-navy-800 transition-colors">Refresh</button>
              </div>

              {stepsLoading ? (
                <div className="text-center py-8 text-sm text-navy-800/40">Loading…</div>
              ) : steps.length === 0 ? (
                <div className="text-center py-8 text-sm text-navy-800/50">
                  No checklist yet.
                  <button onClick={async () => {
                    const r = await fetch(`/api/admin/provision-steps?orgId=${org.id}`, { method: 'POST' })
                    loadProvisionData()
                  }} className="ml-2 text-navy-800 underline">Seed checklist</button>
                </div>
              ) : (
                steps.map((step: any, idx: number) => {
                  const statusColours: Record<string, string> = {
                    completed:   'bg-forest-600 text-white',
                    in_progress: 'bg-amber-500 text-white',
                    failed:      'bg-red-500 text-white',
                    skipped:     'bg-navy-800/20 text-navy-800/50',
                    pending:     'bg-navy-800/10 text-navy-800/40',
                  }
                  return (
                    <div key={step.id} className={`px-5 py-3.5 ${idx < steps.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-6 h-6 rounded-full text-2xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5 ${statusColours[step.status]}`}>
                          {step.status === 'completed' ? '✓' : step.status === 'failed' ? '✗' : step.step_number}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-navy-800">{step.title}</span>
                            <span className={`text-2xs px-1.5 py-0.5 rounded capitalize font-medium ${statusColours[step.status]}`}>{step.status.replace('_',' ')}</span>
                          </div>
                          <div className="text-xs text-navy-800/50 mt-0.5">{step.description}</div>
                          {step.notes && <div className="text-xs text-amber-700 mt-1 italic">{step.notes}</div>}
                          {step.completed_at && (
                            <div className="text-2xs text-navy-800/30 mt-0.5">
                              Completed {new Date(step.completed_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                              {step.specialists?.name && ` by ${step.specialists.name}`}
                            </div>
                          )}
                        </div>
                        {/* Step actions */}
                        {step.status !== 'completed' && step.status !== 'skipped' && (
                          <div className="flex gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => startTransition(async () => {
                                const r = await updateStepAction(org.id, step.step_key, 'completed')
                                if (!r.ok) toast.error(r.error)
                                else { toast.success('Step marked complete'); loadProvisionData() }
                              })}
                              disabled={isPending}
                              className="text-2xs bg-forest-50 text-forest-700 border border-forest-200 rounded-lg px-2 py-1 hover:bg-forest-100 transition-colors">
                              Done
                            </button>
                            {step.status !== 'in_progress' && (
                              <button
                                onClick={() => startTransition(async () => {
                                  await updateStepAction(org.id, step.step_key, 'skipped')
                                  loadProvisionData()
                                })}
                                disabled={isPending}
                                className="text-2xs bg-navy-50 text-navy-800/50 border border-navy-800/10 rounded-lg px-2 py-1 hover:bg-navy-100 transition-colors">
                                Skip
                              </button>
                            )}
                          </div>
                        )}
                        {step.status === 'completed' && (
                          <button
                            onClick={() => startTransition(async () => {
                              await updateStepAction(org.id, step.step_key, 'pending')
                              loadProvisionData()
                            })}
                            disabled={isPending}
                            className="text-2xs text-navy-800/30 hover:text-navy-800/60 transition-colors flex-shrink-0">
                            Undo
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Invitations */}
            <div className="bg-white rounded-2xl border border-navy-800/8">
              <div className="px-5 py-3.5 border-b border-navy-800/8 data-label">
                User invitations
              </div>

              {/* Invite form */}
              <div className="px-5 py-4 border-b border-navy-800/5">
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="data-label block mb-1">Email</label>
                    <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                      placeholder="user@hospital.com" className="input-clinical" />
                  </div>
                  <div className="w-28">
                    <label className="data-label block mb-1">Role</label>
                    <select value={inviteRole} onChange={e => setInviteRole(e.target.value as any)} className="input-clinical">
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      <option value="owner">Owner</option>
                    </select>
                  </div>
                  <button
                    onClick={async () => {
                      if (!inviteEmail.trim()) { toast.error('Enter an email'); return }
                      setInviting(true)
                      const r = await inviteUserAction({ orgId: org.id, email: inviteEmail, orgRole: inviteRole, message: inviteMsg })
                      setInviting(false)
                      if (!r.ok) toast.error(r.error)
                      else { toast.success('Invitation created'); setInviteEmail(''); setInviteMsg(''); loadProvisionData() }
                    }}
                    disabled={inviting || !inviteEmail.trim()}
                    className="btn-primary text-xs py-2 px-4 h-10">
                    {inviting ? '…' : 'Invite'}
                  </button>
                </div>
              </div>

              {/* Invitation list */}
              {invitations.length === 0 ? (
                <div className="text-center py-6 text-sm text-navy-800/40">No invitations sent yet</div>
              ) : (
                invitations.map((inv: any, idx: number) => {
                  const statusDot: Record<string, string> = {
                    pending:  'bg-amber-400',
                    accepted: 'bg-forest-500',
                    expired:  'bg-red-400',
                    revoked:  'bg-navy-800/20',
                  }
                  return (
                    <div key={inv.id} className={`px-5 py-3 ${idx < invitations.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[inv.status] || 'bg-navy-800/20'}`}/>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-navy-800">{inv.email}</span>
                            <span className="text-2xs bg-navy-50 text-navy-800/50 px-1.5 py-0.5 rounded capitalize">{inv.org_role}</span>
                            <span className="text-2xs text-navy-800/30 capitalize">{inv.status}</span>
                          </div>
                          <div className="text-2xs text-navy-800/40 mt-0.5">
                            Invited {new Date(inv.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}
                            · Expires {new Date(inv.expires_at).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}
                            {inv.specialists?.name && ` · by ${inv.specialists.name}`}
                          </div>
                        </div>
                        {inv.status === 'pending' && (
                          <button
                            onClick={async () => {
                              const r = await revokeInvitationAction(inv.id, org.id)
                              if (!r.ok) toast.error(r.error)
                              else { toast.success('Invitation revoked'); loadProvisionData() }
                            }}
                            className="text-2xs text-red-500 hover:text-red-700 transition-colors">
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* TESTS TAB */}
        {tab === 'tests' && (
          <div className="space-y-4">
            {/* Run controls */}
            <div className="bg-white rounded-2xl border border-navy-800/8 p-5">
              <div className="data-label mb-3">Run module health check</div>
              <p className="text-xs text-navy-800/60 mb-4">
                Runs a health-check suite across all enabled modules for <strong>{org.name}</strong>.
                Validates configuration, checks required env vars, and verifies specialist assignment.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    setTestRunning(true)
                    const r = await runTestSuiteAction(org.id)
                    setTestRunning(false)
                    if (!r.ok) toast.error(r.error)
                    else {
                      toast[r.value.failed > 0 ? 'error' : 'success'](
                        `Tests complete: ${r.value.passed} passed, ${r.value.failed} failed, ${r.value.skipped} skipped`
                      )
                      loadTestRuns()
                    }
                  }}
                  disabled={testRunning || isPending}
                  className="btn-primary text-sm py-2 px-5 disabled:opacity-60">
                  {testRunning ? 'Running tests…' : 'Run full test suite'}
                </button>
                <button onClick={loadTestRuns} className="btn-secondary text-sm py-2 px-4">Refresh</button>
              </div>
            </div>

            {/* Test run history */}
            <div className="bg-white rounded-2xl border border-navy-800/8">
              <div className="px-5 py-3.5 border-b border-navy-800/8 data-label">Test run history</div>

              {testRuns.length === 0 ? (
                <div className="text-center py-8 text-sm text-navy-800/40">No test runs yet</div>
              ) : (
                testRuns.map((run: any, idx: number) => {
                  const isExpanded = expandedRun === run.id
                  const passRate   = run.total_tests > 0 ? Math.round((run.passed / run.total_tests) * 100) : 0

                  return (
                    <div key={run.id} className={`${idx < testRuns.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                      <button onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                        className="w-full px-5 py-3.5 text-left flex items-center gap-3 hover:bg-navy-50/50 transition-colors">
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                          run.status === 'completed' && run.failed === 0 ? 'bg-forest-500' :
                          run.status === 'failed' || run.failed > 0 ? 'bg-red-500' :
                          run.status === 'in_progress' ? 'bg-amber-400' : 'bg-navy-800/20'
                        }`}/>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-navy-800">
                              {run.module_key ? `Module: ${run.module_key}` : 'Full suite'}
                            </span>
                            <span className={`text-2xs px-1.5 py-0.5 rounded capitalize font-medium ${
                              run.failed === 0 && run.status === 'completed'
                                ? 'bg-forest-50 text-forest-700'
                                : run.failed > 0 ? 'bg-red-50 text-red-600'
                                : 'bg-amber-50 text-amber-700'
                            }`}>{run.status}</span>
                          </div>
                          <div className="text-2xs text-navy-800/40 mt-0.5">
                            {run.passed}✓ {run.failed > 0 ? `${run.failed}✗ ` : ''}{run.skipped > 0 ? `${run.skipped} skipped ` : ''}
                            · {new Date(run.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                            {run.specialists?.name && ` · ${run.specialists.name}`}
                          </div>
                        </div>
                        {run.total_tests > 0 && (
                          <div className="text-right flex-shrink-0">
                            <div className="text-sm font-semibold text-navy-800">{passRate}%</div>
                            <div className="text-2xs text-navy-800/40">{run.total_tests} tests</div>
                          </div>
                        )}
                        <span className={`text-navy-800/40 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
                      </button>

                      {isExpanded && run.results && Array.isArray(run.results) && (
                        <div className="px-5 pb-4 pt-1 bg-navy-50/30">
                          <div className="space-y-1">
                            {(run.results as any[]).map((res: any, ri: number) => (
                              <div key={ri} className="flex items-start gap-2.5 py-1.5">
                                <span className={`text-xs font-mono flex-shrink-0 ${
                                  res.result === 'pass' ? 'text-forest-600' :
                                  res.result === 'fail' ? 'text-red-600' :
                                  'text-navy-800/40'
                                }`}>
                                  {res.result === 'pass' ? '✓' : res.result === 'fail' ? '✗' : '·'}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs text-navy-800/60 font-mono">{res.module} · {res.test}</span>
                                  <span className="text-xs text-navy-800/40 ml-2">{res.message}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
