'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createOrgAction } from '@/app/actions/admin'

const PLAN_COLOURS: Record<string, { bg: string; text: string; border: string }> = {
  starter:      { bg: 'bg-gray-100',   text: 'text-gray-600',    border: 'border-gray-300' },
  growth:       { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-300' },
  professional: { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-300' },
  enterprise:   { bg: 'bg-navy-50',    text: 'text-navy-800',    border: 'border-navy-400' },
  custom:       { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-300' },
}

const ORG_STATUS_CFG: Record<string, { label: string; dot: string }> = {
  trial:     { label: 'Trial',     dot: 'bg-amber-400' },
  active:    { label: 'Active',    dot: 'bg-forest-600' },
  suspended: { label: 'Suspended', dot: 'bg-red-500' },
  cancelled: { label: 'Cancelled', dot: 'bg-gray-400' },
  demo:      { label: 'Demo',      dot: 'bg-purple-500' },
}

const MODULE_LABELS: Record<string, string> = {
  m1_identity:'M1', m2_network:'M2', m3_referrals:'M3', m4_chatbot:'M4',
  m5_triage:'M5', m6_synthesis:'M6', m7_transcription:'M7',
  m8_procedure_planner:'M8', m9_communication:'M9', m10_content:'M10',
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

export default function AdminDashboardClient({ admin, summary, orgs, plans, defaultTab }: {
  admin: { id: string; name: string; role: string }
  summary: any; orgs: any[]; plans: any[]; defaultTab?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showNewOrg, setShowNewOrg]   = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [newOrg, setNewOrg] = useState({ name:'', slug:'', plan_tier:'starter', admin_email:'', geography:'india' })

  const displayed = orgs
    .filter(o => statusFilter === 'all' || o.status === statusFilter)
    .filter(o => !search || o.name.toLowerCase().includes(search.toLowerCase()) || o.admin_email?.includes(search))

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    Object.entries(newOrg).forEach(([k,v]) => fd.set(k, v))
    startTransition(async () => {
      const r = await createOrgAction(fd)
      if (!r.ok) { toast.error(r.error); return }
      toast.success('Organisation created')
      setShowNewOrg(false)
      setNewOrg({ name:'', slug:'', plan_tier:'starter', admin_email:'', geography:'india' })
      router.refresh()
      router.push(`/admin/orgs/${r.value.orgId}`)
    })
  }

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-navy-900 border-b border-navy-700 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-white flex-1">ClinCollab Admin</span>
          <span className="text-2xs bg-navy-700 text-navy-300 px-2 py-1 rounded-lg">Platform Config</span>
          <button onClick={() => router.push('/dashboard')}
            className="text-xs text-navy-400 hover:text-white transition-colors">Exit admin</button>
        </div>
      </nav>

      {/* Sub nav */}
      <div className="bg-navy-800 border-b border-navy-700">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex gap-0">
            {[
              { label: 'Overview',      path: '/admin' },
              { label: 'Organisations', path: '/admin/orgs' },
              { label: 'Plans',         path: '/admin/plans' },
              { label: 'Audit log',     path: '/admin/config' },
            ].map(n => (
              <button key={n.path} onClick={() => router.push(n.path)}
                className="px-4 py-3 text-xs font-medium text-navy-400 hover:text-white transition-colors border-b-2 border-transparent hover:border-navy-400">
                {n.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Platform summary */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total orgs',         value: summary.totalOrgs,         color: 'text-navy-800' },
              { label: 'Active specialists', value: summary.activeSpecialists, color: 'text-forest-700' },
              { label: 'Events (30d)',        value: summary.totalEventsLast30d,color: 'text-blue-700' },
              { label: 'Avg per org',         value: summary.totalOrgs > 0 ? Math.round(summary.totalEventsLast30d / summary.totalOrgs) : 0, color:'text-navy-800' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-2xl border border-navy-800/8 p-4 text-center">
                <div className={`font-display text-3xl font-medium ${s.color}`}>{s.value}</div>
                <div className="data-label mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Plan distribution */}
        {summary?.orgsByTier && (
          <div className="bg-white rounded-2xl border border-navy-800/8 p-5">
            <div className="data-label mb-4">Plan distribution</div>
            <div className="grid grid-cols-5 gap-3">
              {['starter','growth','professional','enterprise','custom'].map(tier => {
                const cfg = PLAN_COLOURS[tier] || PLAN_COLOURS.starter
                const count = summary.orgsByTier[tier] || 0
                return (
                  <div key={tier} className={`rounded-xl border p-3 text-center ${cfg.bg} ${cfg.border}`}>
                    <div className={`font-display text-2xl font-medium ${cfg.text}`}>{count}</div>
                    <div className={`text-2xs font-medium mt-0.5 capitalize ${cfg.text}`}>{tier}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Module activity */}
        {summary?.moduleActivityLast30d && (
          <div className="bg-white rounded-2xl border border-navy-800/8 p-5">
            <div className="data-label mb-4">Module usage — last 30 days</div>
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
              {Object.entries(MODULE_LABELS).map(([key, label]) => {
                const count = summary.moduleActivityLast30d[key] || 0
                const max   = Math.max(...Object.values(summary.moduleActivityLast30d as Record<string,number>), 1)
                const pct   = Math.round((count / max) * 100)
                return (
                  <div key={key} className="text-center">
                    <div className="text-xs font-medium text-navy-800 mb-1">{label}</div>
                    <div className="h-12 bg-navy-800/5 rounded-lg overflow-hidden flex items-end">
                      <div className="w-full bg-navy-800 rounded-b-lg transition-all" style={{ height: `${Math.max(pct, 4)}%` }}/>
                    </div>
                    <div className="text-2xs text-navy-800/40 mt-1">{count}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Org list */}
        <div className="bg-white rounded-2xl border border-navy-800/8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-navy-800/8">
            <div className="data-label">Organisations ({displayed.length})</div>
            <div className="flex items-center gap-2">
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search..." className="input-clinical text-xs py-1.5 w-32" />
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="input-clinical text-xs py-1.5 w-28">
                <option value="all">All status</option>
                {['trial','active','suspended','demo','cancelled'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button onClick={() => router.push('/admin/orgs/new')}
                className="bg-navy-800 text-white text-xs font-medium px-3 py-2 rounded-xl hover:bg-navy-900 transition-all">
                + Provision org
              </button>
            </div>
          </div>
          {displayed.length === 0 ? (
            <div className="text-center py-12 text-sm text-navy-800/50">
              No organisations yet. Create one to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-navy-800/8">
                    {['Organisation', 'Plan', 'Status', 'Specialists', 'Modules', 'Created'].map(h => (
                      <th key={h} className="text-left text-2xs font-medium text-navy-800/40 px-5 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((org, idx) => {
                    const pc  = PLAN_COLOURS[org.plan_tier] || PLAN_COLOURS.starter
                    const sc2 = ORG_STATUS_CFG[org.status]  || ORG_STATUS_CFG.trial
                    return (
                      <tr key={org.id}
                        className={`cursor-pointer hover:bg-navy-50/60 transition-colors ${idx < displayed.length - 1 ? 'border-b border-navy-800/5' : ''}`}
                        onClick={() => router.push(`/admin/orgs/${org.id}`)}>
                        <td className="px-5 py-3.5">
                          <div className="text-sm font-medium text-navy-800">{org.name}</div>
                          <div className="text-2xs text-navy-800/40">{org.admin_email}</div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`text-2xs px-2 py-0.5 rounded-full font-medium capitalize ${pc.bg} ${pc.text}`}>
                            {org.plan_tier}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${sc2.dot}`}/>
                            <span className="text-xs text-navy-800/70">{sc2.label}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-sm text-navy-800">{(org.org_specialists?.[0] as any)?.count || 0}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-xs text-navy-800/50">
                            {org.plan_tier === 'starter' ? 'M1–M3' :
                             org.plan_tier === 'growth' ? 'M1–M6' :
                             org.plan_tier === 'professional' ? 'M1–M9' :
                             org.plan_tier === 'enterprise' ? 'M1–M10' : 'Custom'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-xs text-navy-800/40">{timeAgo(org.created_at)}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Create org modal */}
      {showNewOrg && (
        <div className="fixed inset-0 bg-navy-900/60 flex items-center justify-center px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-4">Create organisation</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="data-label block mb-1.5">Organisation name</label>
                  <input type="text" value={newOrg.name}
                    onChange={e => {
                      const slug = e.target.value.toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-')
                      setNewOrg(p => ({ ...p, name: e.target.value, slug }))
                    }}
                    placeholder="Apollo Hospitals Delhi" className="input-clinical" autoFocus required />
                </div>
                <div>
                  <label className="data-label block mb-1.5">Slug (URL-safe)</label>
                  <input type="text" value={newOrg.slug}
                    onChange={e => setNewOrg(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-') }))}
                    placeholder="apollo-delhi" className="input-clinical" required />
                </div>
                <div>
                  <label className="data-label block mb-1.5">Plan tier</label>
                  <select value={newOrg.plan_tier} onChange={e => setNewOrg(p => ({ ...p, plan_tier: e.target.value }))}
                    className="input-clinical">
                    {['starter','growth','professional','enterprise','custom'].map(t => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="data-label block mb-1.5">Admin email</label>
                  <input type="email" value={newOrg.admin_email}
                    onChange={e => setNewOrg(p => ({ ...p, admin_email: e.target.value }))}
                    placeholder="admin@apollohospitals.com" className="input-clinical" required />
                </div>
                <div>
                  <label className="data-label block mb-1.5">Geography</label>
                  <select value={newOrg.geography} onChange={e => setNewOrg(p => ({ ...p, geography: e.target.value }))}
                    className="input-clinical">
                    {['india','gcc','sea','uk','aus','usa','global'].map(g => (
                      <option key={g} value={g}>{g.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="bg-blue-50 rounded-xl px-4 py-3 text-xs text-blue-800/80 leading-relaxed">
                Organisation will start on a 30-day trial. All modules in the selected plan tier will be enabled automatically.
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={isPending || !newOrg.name || !newOrg.slug || !newOrg.admin_email}
                  className="btn-primary flex-1">
                  {isPending ? 'Creating...' : 'Create organisation'}
                </button>
                <button type="button" onClick={() => setShowNewOrg(false)} className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
