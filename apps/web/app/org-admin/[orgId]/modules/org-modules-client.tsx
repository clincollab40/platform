'use client'

const MODULES = [
  { key:'m1_identity',          label:'M1 · Identity & Auth',       desc:'Core authentication and identity management. Always required.', icon:'🔑', alwaysOn: true },
  { key:'m2_network',           label:'M2 · Doctor Network',         desc:'Build and manage your specialist referral network.',           icon:'🩺' },
  { key:'m3_referrals',         label:'M3 · Referral Workflow',      desc:'End-to-end referral management with tracking.',               icon:'📋' },
  { key:'m4_chatbot',           label:'M4 · Patient Chatbot',        desc:'WhatsApp AI chatbot for appointment booking.',                 icon:'💬' },
  { key:'m5_triage',            label:'M5 · Virtual Triage Nurse',   desc:'Intelligent pre-consultation triage questionnaire.',          icon:'🏥' },
  { key:'m6_synthesis',         label:'M6 · 360° Synthesis',         desc:'AI-generated pre-consultation brief for specialists.',        icon:'✨' },
  { key:'m7_transcription',     label:'M7 · Transcription Agent',    desc:'Real-time AI consultation transcription and notes.',          icon:'🎙️' },
  { key:'m8_procedure_planner', label:'M8 · Procedure Planner',      desc:'End-to-end surgical and procedure coordination.',             icon:'⚙️' },
  { key:'m9_communication',     label:'M9 · Closed-Loop Comms',      desc:'Stakeholder communication engine with audit trail.',          icon:'🔔' },
  { key:'m10_content',          label:'M10 · Clinical Content',      desc:'AI-powered CME and clinical content generation.',             icon:'📖' },
]

const RISK_COLOURS: Record<string, string> = {
  low:      'text-forest-700',
  medium:   'text-amber-700',
  high:     'text-red-600',
  critical: 'text-red-700',
}

export default function OrgModulesClient({
  orgId, config, flags,
}: {
  orgId:  string
  config: any[]
  flags:  any[]
}) {
  const moduleConfig: Record<string, any> = {}
  for (const c of config) moduleConfig[c.module_key] = c

  const flagsByModule: Record<string, any[]> = {}
  for (const f of flags) {
    if (!flagsByModule[f.module_key]) flagsByModule[f.module_key] = []
    flagsByModule[f.module_key].push(f)
  }

  function isEnabled(key: string) { return moduleConfig[key]?.is_enabled ?? false }
  function getFlag(moduleKey: string, flagKey: string) {
    const flags = moduleConfig[moduleKey]?.feature_flags || {}
    const shortKey = flagKey.includes('.') ? flagKey.split('.').slice(1).join('.') : flagKey
    return flags[shortKey] ?? false
  }

  const enabledCount = MODULES.filter(m => isEnabled(m.key)).length

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">

      {/* Header */}
      <div className="bg-navy-50 border border-navy-800/8 rounded-xl px-4 py-3">
        <p className="text-xs text-navy-800/70">
          <strong>{enabledCount} of {MODULES.length} modules</strong> are active for your organisation.
          Module configuration is managed by your ClinCollab account manager.
          Contact support to request changes.
        </p>
      </div>

      {/* Module cards */}
      {MODULES.map(mod => {
        const enabled   = mod.alwaysOn ? true : isEnabled(mod.key)
        const modFlags  = flagsByModule[mod.key] || []
        const activeFlags = modFlags.filter(f => getFlag(mod.key, f.flag_key))

        return (
          <div key={mod.key}
            className={`bg-white rounded-2xl border transition-all ${enabled ? 'border-navy-800/12' : 'border-navy-800/6 opacity-60'}`}>
            <div className="flex items-start gap-4 px-5 py-4">
              <span className={`text-2xl flex-shrink-0 ${!enabled ? 'grayscale opacity-40' : ''}`}>{mod.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-semibold ${enabled ? 'text-navy-800' : 'text-navy-800/40'}`}>{mod.label}</span>
                  {mod.alwaysOn && (
                    <span className="text-2xs bg-navy-800/8 text-navy-800/50 px-1.5 py-0.5 rounded">Always on</span>
                  )}
                  <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${enabled ? 'bg-forest-50 text-forest-700' : 'bg-red-50 text-red-500'}`}>
                    {enabled ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className={`text-xs mt-1 ${enabled ? 'text-navy-800/60' : 'text-navy-800/30'}`}>{mod.desc}</p>

                {/* Feature flags (read-only) */}
                {enabled && modFlags.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-navy-800/6 space-y-1.5">
                    <div className="text-2xs text-navy-800/40 font-medium uppercase tracking-wider mb-2">Feature flags</div>
                    {modFlags.map(flag => {
                      const val = getFlag(mod.key, flag.flag_key)
                      return (
                        <div key={flag.flag_key} className="flex items-center gap-2.5">
                          <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0
                            ${val ? 'bg-forest-600 border-forest-600' : 'bg-white border-navy-800/20'}`}>
                            {val && <span className="text-white text-2xs leading-none">✓</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs text-navy-800">{flag.display_name}</span>
                            <span className={`ml-2 text-2xs ${RISK_COLOURS[flag.risk_level] || 'text-navy-800/40'}`}>{flag.risk_level}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Monthly limit */}
                {enabled && moduleConfig[mod.key]?.monthly_limit && (
                  <div className="mt-2 text-xs text-navy-800/50">
                    Monthly limit: <span className="font-medium text-navy-800">{moduleConfig[mod.key].monthly_limit.toLocaleString()}</span> events
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {/* Contact notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
        To enable or disable modules, or to change feature flags, please contact your ClinCollab account manager
        at <strong>support@clincollab.com</strong> or raise a request through your implementation manager.
      </div>
    </main>
  )
}
