'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'

const MODULE_LIST = [
  { key:'m1_identity',          label:'M1 — Identity & Auth' },
  { key:'m2_network',           label:'M2 — Doctor Network' },
  { key:'m3_referrals',         label:'M3 — Referral Workflow' },
  { key:'m4_chatbot',           label:'M4 — Patient Chatbot' },
  { key:'m5_triage',            label:'M5 — Virtual Triage Nurse' },
  { key:'m6_synthesis',         label:'M6 — 360° AI Synthesis' },
  { key:'m7_transcription',     label:'M7 — Transcription Agent' },
  { key:'m8_procedure_planner', label:'M8 — Procedure Planner' },
  { key:'m9_communication',     label:'M9 — Closed-Loop Comms' },
  { key:'m10_content',          label:'M10 — Clinical Content' },
]

const TIER_ORDER = ['starter','growth','professional','enterprise','custom']
const TIER_COLOURS: Record<string, { header: string; badge: string; text: string }> = {
  starter:      { header:'bg-gray-50',   badge:'bg-gray-100 text-gray-600',     text:'text-gray-700' },
  growth:       { header:'bg-blue-50',   badge:'bg-blue-100 text-blue-700',     text:'text-blue-700' },
  professional: { header:'bg-purple-50', badge:'bg-purple-100 text-purple-700', text:'text-purple-700' },
  enterprise:   { header:'bg-navy-50',   badge:'bg-navy-100 text-navy-800',     text:'text-navy-800' },
  custom:       { header:'bg-amber-50',  badge:'bg-amber-100 text-amber-700',   text:'text-amber-700' },
}

export default function AdminPlansClient({ plans, flags, tierCounts, admin }: {
  plans: any[]; flags: any[]; tierCounts: Record<string, number>; admin: any
}) {
  const router = useRouter()
  const planMap: Record<string, any> = {}
  for (const p of plans) planMap[p.tier] = p

  function hasModule(tier: string, moduleKey: string): boolean {
    return (planMap[tier]?.enabled_modules || []).includes(moduleKey)
  }

  function hasFlag(tier: string, flagKey: string): boolean {
    const shortKey = flagKey.includes('.') ? flagKey.split('.').slice(1).join('.') : flagKey
    const features = planMap[tier]?.included_features || {}
    return features[shortKey] === true || features[flagKey] === true
  }

  // Group flags by module
  const flagsByModule: Record<string, any[]> = {}
  for (const f of flags) {
    if (!flagsByModule[f.module_key]) flagsByModule[f.module_key] = []
    flagsByModule[f.module_key].push(f)
  }

  const displayedTiers = TIER_ORDER.filter(t => planMap[t])

  return (
    <div className="min-h-screen bg-clinical-light">
      <nav className="bg-navy-900 border-b border-navy-700 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/admin')} className="text-navy-400 hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="text-sm font-medium text-white flex-1">Plan Definitions</span>
        </div>
      </nav>

      {/* Sub nav */}
      <div className="bg-navy-800 border-b border-navy-700">
        <div className="max-w-6xl mx-auto px-4 flex gap-0">
          {[{label:'Overview',path:'/admin'},{label:'Organisations',path:'/admin/orgs'},{label:'Plans',path:'/admin/plans'},{label:'Audit log',path:'/admin/config'}].map(n => (
            <button key={n.path} onClick={() => router.push(n.path)}
              className={`px-4 py-3 text-xs font-medium border-b-2 transition-colors ${n.path === '/admin/plans' ? 'text-white border-white' : 'text-navy-400 border-transparent hover:text-white'}`}>
              {n.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Plan headers */}
        <div className="bg-white rounded-2xl border border-navy-800/8 overflow-hidden">
          {/* Header row */}
          <div className={`grid border-b border-navy-800/8`} style={{ gridTemplateColumns: `240px repeat(${displayedTiers.length}, 1fr)` }}>
            <div className="px-5 py-4 bg-gray-50 border-r border-navy-800/8">
              <div className="data-label">Module / Feature</div>
            </div>
            {displayedTiers.map(tier => {
              const cfg = TIER_COLOURS[tier] || TIER_COLOURS.starter
              const plan = planMap[tier]
              return (
                <div key={tier} className={`px-4 py-4 text-center border-r border-navy-800/8 last:border-0 ${cfg.header}`}>
                  <div className={`text-sm font-bold capitalize ${cfg.text}`}>{tier}</div>
                  <div className="text-xs text-navy-800/50 mt-0.5">{plan?.display_name}</div>
                  <div className={`text-2xs px-2 py-0.5 rounded-full font-medium mt-2 inline-block ${cfg.badge}`}>
                    {tierCounts[tier] || 0} org{(tierCounts[tier] || 0) !== 1 ? 's' : ''}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Limits row */}
          {[
            { label:'Max specialists', fn: (t: string) => planMap[t]?.default_max_specialists === -1 ? '∞' : planMap[t]?.default_max_specialists || '—' },
            { label:'Referrals / month', fn: (t: string) => planMap[t]?.default_max_referrals_pm === -1 ? '∞' : planMap[t]?.default_max_referrals_pm || '—' },
            { label:'Content / month', fn: (t: string) => planMap[t]?.default_max_content_pm === -1 ? '∞' : planMap[t]?.default_max_content_pm || '—' },
            { label:'Transcriptions / month', fn: (t: string) => planMap[t]?.default_max_transcriptions_pm === -1 ? '∞' : planMap[t]?.default_max_transcriptions_pm || '—' },
            { label:'Storage (GB)', fn: (t: string) => planMap[t]?.default_storage_gb === -1 ? '∞' : planMap[t]?.default_storage_gb || '—' },
          ].map((row, idx) => (
            <div key={row.label} className={`grid border-b border-navy-800/5`} style={{ gridTemplateColumns: `240px repeat(${displayedTiers.length}, 1fr)` }}>
              <div className="px-5 py-3 bg-gray-50/60 border-r border-navy-800/8">
                <span className="text-xs text-navy-800/60">{row.label}</span>
              </div>
              {displayedTiers.map(tier => (
                <div key={tier} className="px-4 py-3 text-center border-r border-navy-800/8 last:border-0">
                  <span className="text-sm font-medium text-navy-800">{row.fn(tier)}</span>
                </div>
              ))}
            </div>
          ))}

          {/* Module rows */}
          <div className="px-5 py-2.5 bg-navy-800/3 border-b border-navy-800/8">
            <span className="data-label text-2xs">Modules included</span>
          </div>
          {MODULE_LIST.map(mod => (
            <div key={mod.key} className="grid border-b border-navy-800/5 last:border-0"
              style={{ gridTemplateColumns: `240px repeat(${displayedTiers.length}, 1fr)` }}>
              <div className="px-5 py-3 bg-gray-50/40 border-r border-navy-800/8">
                <span className="text-xs text-navy-800/70">{mod.label}</span>
              </div>
              {displayedTiers.map(tier => (
                <div key={tier} className="px-4 py-3 text-center border-r border-navy-800/8 last:border-0">
                  {hasModule(tier, mod.key)
                    ? <span className="text-forest-700 text-sm font-bold">✓</span>
                    : <span className="text-navy-800/15 text-sm">—</span>}
                </div>
              ))}
            </div>
          ))}

          {/* Feature flag rows by module */}
          {Object.entries(flagsByModule).map(([moduleKey, moduleFlags]) => (
            <>
              <div key={`header-${moduleKey}`} className="px-5 py-2 bg-navy-800/3 border-b border-navy-800/8"
                style={{ gridColumn: `1 / -1` }}>
                <span className="data-label text-2xs">
                  {MODULE_LIST.find(m => m.key === moduleKey)?.label || moduleKey} — feature flags
                </span>
              </div>
              {moduleFlags.map(flag => (
                <div key={flag.flag_key} className="grid border-b border-navy-800/5"
                  style={{ gridTemplateColumns: `240px repeat(${displayedTiers.length}, 1fr)` }}>
                  <div className="px-5 py-2.5 bg-gray-50/30 border-r border-navy-800/8 pl-8">
                    <div className="text-xs text-navy-800/60">{flag.display_name}</div>
                  </div>
                  {displayedTiers.map(tier => (
                    <div key={tier} className="px-4 py-2.5 text-center border-r border-navy-800/8 last:border-0">
                      {hasFlag(tier, flag.flag_key)
                        ? <span className="text-forest-600 text-xs font-medium">✓</span>
                        : <span className="text-navy-800/12 text-xs">—</span>}
                    </div>
                  ))}
                </div>
              ))}
            </>
          ))}
        </div>
      </main>
    </div>
  )
}
