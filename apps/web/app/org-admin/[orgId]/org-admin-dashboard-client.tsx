'use client'

import { useRouter } from 'next/navigation'

const MODULES = [
  { key:'m1_identity',          label:'Identity & Auth',       icon:'🔑' },
  { key:'m2_network',           label:'Doctor Network',         icon:'🩺' },
  { key:'m3_referrals',         label:'Referral Workflow',      icon:'📋' },
  { key:'m4_chatbot',           label:'Patient Chatbot',        icon:'💬' },
  { key:'m5_triage',            label:'Virtual Triage',         icon:'🏥' },
  { key:'m6_synthesis',         label:'360° Synthesis',         icon:'✨' },
  { key:'m7_transcription',     label:'Transcription',          icon:'🎙️' },
  { key:'m8_procedure_planner', label:'Procedure Planner',      icon:'⚙️' },
  { key:'m9_communication',     label:'Closed-Loop Comms',      icon:'🔔' },
  { key:'m10_content',          label:'Clinical Content',       icon:'📖' },
]

function getTrialDaysLeft(trialEndsAt?: string): number | null {
  if (!trialEndsAt) return null
  const msLeft = new Date(trialEndsAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(msLeft / 86400000))
}

export default function OrgAdminDashboardClient({
  org, activeSpecialists, enabledModules, eventsLast30d,
}: {
  org:               any
  activeSpecialists: number
  enabledModules:    number
  eventsLast30d:     number
}) {
  const router = useRouter()
  const trialDaysLeft = org.status === 'trial' ? getTrialDaysLeft(org.trial_ends_at) : null

  const moduleConfig: Record<string, any> = {}
  for (const m of (org.org_module_config || [])) {
    moduleConfig[m.module_key] = m
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">

      {/* Trial banner */}
      {org.status === 'trial' && trialDaysLeft !== null && (
        <div className={`rounded-xl px-4 py-3 flex items-center gap-3 ${trialDaysLeft <= 7 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
          <span className="text-lg">{trialDaysLeft <= 7 ? '⚠️' : '⏳'}</span>
          <div>
            <div className={`text-sm font-medium ${trialDaysLeft <= 7 ? 'text-red-800' : 'text-amber-800'}`}>
              {trialDaysLeft === 0 ? 'Trial has expired' : `Trial ends in ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'}`}
            </div>
            <div className={`text-xs ${trialDaysLeft <= 7 ? 'text-red-600' : 'text-amber-700'}`}>
              Contact your ClinCollab account manager to activate a subscription.
            </div>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Active users',    value: activeSpecialists,                icon: '👥' },
          { label: 'Active modules',  value: enabledModules,                   icon: '🧩' },
          { label: 'Events (30d)',    value: eventsLast30d.toLocaleString(),   icon: '📊' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-navy-800/8 p-4 text-center">
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="font-display text-2xl font-semibold text-navy-800">{s.value}</div>
            <div className="text-xs text-navy-800/50 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="bg-white rounded-2xl border border-navy-800/8 p-5">
        <div className="data-label mb-3">Quick actions</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => router.push(`/org-admin/${org.id}/users`)}
            className="btn-primary text-xs py-2 px-4">Manage users</button>
          <button onClick={() => router.push(`/org-admin/${org.id}/modules`)}
            className="btn-secondary text-xs py-2 px-4">View modules</button>
          <button onClick={() => router.push(`/org-admin/${org.id}/users#invite`)}
            className="btn-secondary text-xs py-2 px-4">Invite user</button>
        </div>
      </div>

      {/* Module status */}
      <div className="bg-white rounded-2xl border border-navy-800/8">
        <div className="px-5 py-3.5 border-b border-navy-800/8 flex items-center justify-between">
          <span className="data-label">Active modules</span>
          <button onClick={() => router.push(`/org-admin/${org.id}/modules`)}
            className="text-xs text-navy-800/50 hover:text-navy-800 transition-colors">View all →</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-0">
          {MODULES.map((mod, i) => {
            const cfg     = moduleConfig[mod.key]
            const enabled = cfg?.is_enabled ?? false
            return (
              <div key={mod.key}
                className={`flex items-center gap-2.5 px-4 py-3 ${i % 2 === 0 ? '' : ''} border-b border-navy-800/5 last:border-0`}>
                <span className={`text-base ${enabled ? 'opacity-100' : 'opacity-30 grayscale'}`}>{mod.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium truncate ${enabled ? 'text-navy-800' : 'text-navy-800/40'}`}>{mod.label}</div>
                  <div className={`text-2xs ${enabled ? 'text-forest-700' : 'text-navy-800/30'}`}>{enabled ? 'Active' : 'Inactive'}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Org info */}
      <div className="bg-white rounded-2xl border border-navy-800/8 p-5">
        <div className="data-label mb-3">Organisation details</div>
        <div className="space-y-2 text-sm">
          {[
            { label: 'Name',   value: org.name },
            { label: 'Plan',   value: org.plan_tier },
            { label: 'Status', value: org.status },
            { label: 'City',   value: org.city || '—' },
            { label: 'Compliance', value: [org.abdm_mode&&'ABDM', org.hipaa_mode&&'HIPAA', org.gdpr_mode&&'GDPR'].filter(Boolean).join(', ') || 'None' },
            { label: 'Max specialists', value: org.max_specialists },
          ].map(r => (
            <div key={r.label} className="flex items-center gap-3">
              <span className="text-navy-800/50 w-32 flex-shrink-0">{r.label}</span>
              <span className="text-navy-800 capitalize">{r.value}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
