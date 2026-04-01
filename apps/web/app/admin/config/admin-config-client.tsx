'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

const CHANGE_TYPE_CFG: Record<string, { dot: string; label: string }> = {
  org_created:      { dot: 'bg-forest-600', label: 'Org created' },
  module_enabled:   { dot: 'bg-forest-600', label: 'Module enabled' },
  module_disabled:  { dot: 'bg-red-500',    label: 'Module disabled' },
  plan_changed:     { dot: 'bg-purple-500', label: 'Plan changed' },
  flag_changed:     { dot: 'bg-amber-500',  label: 'Flag changed' },
  permission_changed:{ dot: 'bg-blue-500',  label: 'Permission changed' },
  org_updated:      { dot: 'bg-gray-400',   label: 'Org updated' },
}

const RISK_COLOURS: Record<string, string> = {
  low:'text-forest-700 bg-forest-50', medium:'text-amber-700 bg-amber-50',
  high:'text-red-600 bg-red-50', critical:'text-red-700 bg-red-100',
}

export default function AdminConfigClient({ auditLog, flags, admin }: {
  auditLog: any[]; flags: any[]; admin: any
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'audit'|'flags'>('audit')
  const [filter, setFilter] = useState('')

  const filteredAudit = auditLog.filter(e =>
    !filter || e.field_name?.includes(filter) || e.change_type?.includes(filter) || e.new_value?.includes(filter)
  )
  const filteredFlags = flags.filter(f =>
    !filter || f.flag_key.includes(filter) || f.display_name.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-clinical-light">
      <nav className="bg-navy-900 border-b border-navy-700 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/admin')} className="text-navy-400 hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="text-sm font-medium text-white flex-1">Platform Config</span>
        </div>
      </nav>

      <div className="bg-navy-800 border-b border-navy-700">
        <div className="max-w-4xl mx-auto px-4 flex gap-0">
          {[{label:'Overview',path:'/admin'},{label:'Organisations',path:'/admin/orgs'},{label:'Plans',path:'/admin/plans'},{label:'Audit log',path:'/admin/config'}].map(n => (
            <button key={n.path} onClick={() => router.push(n.path)}
              className={`px-4 py-3 text-xs font-medium border-b-2 transition-colors ${n.path === '/admin/config' ? 'text-white border-white' : 'text-navy-400 border-transparent hover:text-white'}`}>
              {n.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Tab + search */}
        <div className="flex items-center gap-3">
          <div className="flex bg-white rounded-xl border border-navy-800/8">
            {[{k:'audit',label:`Audit log (${auditLog.length})`},{k:'flags',label:`Flag registry (${flags.length})`}].map(t => (
              <button key={t.k} onClick={() => setTab(t.k as any)}
                className={`px-4 py-2.5 text-xs font-medium rounded-xl transition-colors
                  ${tab === t.k ? 'bg-navy-800 text-white' : 'text-navy-800/50 hover:text-navy-800'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <input type="text" value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Filter..." className="input-clinical text-xs py-2 flex-1 max-w-xs" />
        </div>

        {/* AUDIT LOG */}
        {tab === 'audit' && (
          <div className="bg-white rounded-2xl border border-navy-800/8 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-navy-800/8 bg-gray-50/50">
              <div className="data-label">All configuration changes — platform-wide</div>
            </div>
            {filteredAudit.length === 0 ? (
              <div className="text-center py-12 text-sm text-navy-800/50">No audit records found</div>
            ) : (
              filteredAudit.map((entry, idx) => {
                const cfg = CHANGE_TYPE_CFG[entry.change_type] || { dot:'bg-gray-400', label: entry.change_type }
                return (
                  <div key={entry.id}
                    className={`flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50/50 transition-colors ${idx < filteredAudit.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${cfg.dot}`}/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-navy-800">{cfg.label}</span>
                        <span className="text-2xs text-navy-800/40">{entry.entity_type}</span>
                        <span className="text-2xs bg-navy-50 text-navy-800/50 px-1.5 py-0.5 rounded font-mono">{entry.field_name}</span>
                      </div>
                      {(entry.old_value || entry.new_value) && (
                        <div className="text-2xs text-navy-800/50 mt-0.5 font-mono">
                          {entry.old_value && <span className="line-through mr-2">{entry.old_value.slice(0,40)}</span>}
                          {entry.new_value && <span className="text-forest-700">{entry.new_value.slice(0,40)}</span>}
                        </div>
                      )}
                      {entry.change_reason && (
                        <div className="text-2xs text-navy-800/40 mt-0.5 italic">"{entry.change_reason}"</div>
                      )}
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
                )
              })
            )}
          </div>
        )}

        {/* FLAG REGISTRY */}
        {tab === 'flags' && (
          <div className="bg-white rounded-2xl border border-navy-800/8 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-navy-800/8 bg-gray-50/50">
              <div className="data-label">Feature flag registry — all {flags.length} platform flags</div>
            </div>
            {filteredFlags.map((flag, idx) => (
              <div key={flag.id}
                className={`flex items-start gap-3 px-5 py-3.5 ${idx < filteredFlags.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${flag.default_value ? 'bg-forest-600' : 'bg-gray-300'}`}/>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-xs font-mono font-medium text-navy-800">{flag.flag_key}</span>
                    <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${RISK_COLOURS[flag.risk_level] || 'text-gray-500 bg-gray-100'}`}>
                      {flag.risk_level}
                    </span>
                    {flag.requires_admin && (
                      <span className="text-2xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">admin-only</span>
                    )}
                    {flag.included_from_tier && (
                      <span className="text-2xs text-navy-800/40">from {flag.included_from_tier}</span>
                    )}
                  </div>
                  <div className="text-xs font-medium text-navy-800">{flag.display_name}</div>
                  <div className="text-2xs text-navy-800/50 leading-relaxed mt-0.5">{flag.description}</div>
                </div>
                <div className="flex-shrink-0">
                  <span className={`text-2xs font-medium ${flag.default_value ? 'text-forest-700' : 'text-navy-800/30'}`}>
                    Default: {flag.default_value ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
