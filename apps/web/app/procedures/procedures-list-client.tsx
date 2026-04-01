'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createPlanAction } from '@/app/actions/procedures'

type Plan = {
  id: string; patient_name: string; procedure_name: string
  urgency: string; status: string; scheduled_date: string | null
  scheduled_time: string | null; consent_status: string
  workup_complete: boolean; resources_confirmed: boolean
  patient_ready: boolean; created_at: string
  procedure_protocols: { procedure_code: string; ot_room_type: string } | null
}
type Protocol = { id: string; procedure_name: string; procedure_code: string }

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  counselling:        { label: 'Counselling',      bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-400' },
  patient_deciding:   { label: 'Patient deciding', bg: 'bg-gray-100',  text: 'text-gray-500',   dot: 'bg-gray-400' },
  scheduled:          { label: 'Scheduled',        bg: 'bg-forest-50', text: 'text-forest-700', dot: 'bg-forest-600' },
  workup_in_progress: { label: 'Workup underway',  bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500' },
  workup_complete:    { label: 'Workup done',       bg: 'bg-teal-50',   text: 'text-teal-700',   dot: 'bg-teal-500' },
  ready_for_procedure:{ label: '✓ Ready',           bg: 'bg-forest-50', text: 'text-forest-700', dot: 'bg-forest-600' },
  in_progress:        { label: 'In progress',       bg: 'bg-red-50',    text: 'text-red-600',    dot: 'bg-red-500 animate-pulse' },
  completed:          { label: 'Completed',         bg: 'bg-gray-100',  text: 'text-gray-500',   dot: 'bg-gray-400' },
  postponed:          { label: 'Postponed',         bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-400' },
}

const URGENCY_CONFIG: Record<string, { label: string; color: string }> = {
  elective:  { label: 'Elective',   color: 'text-navy-800/50' },
  urgent:    { label: 'Urgent',     color: 'text-amber-600' },
  emergency: { label: 'Emergency',  color: 'text-red-600' },
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

function daysUntil(d: string | null) {
  if (!d) return null
  const diff = new Date(d).getTime() - Date.now()
  return Math.ceil(diff / 86400000)
}

export default function ProceduresListClient({ specialist, plans, recentCompleted, protocols, analytics }: {
  specialist: { id: string; name: string; specialty: string }
  plans: Plan[]
  recentCompleted: any[]
  protocols: Protocol[]
  analytics: { active: number; scheduled: number; ready: number; pendingWorkup: number; awaitingConsent: number }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showNew, setShowNew]   = useState(false)
  const [statusFilter, setStatusFilter] = useState('active')
  const [newForm, setNewForm]   = useState({
    patient_name: '', patient_mobile: '', patient_age: '',
    patient_gender: 'male', procedure_name: '', indication: '',
    urgency: 'elective', protocol_id: '',
  })

  const displayed = plans.filter(p => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return !['completed','cancelled','declined','patient_deciding'].includes(p.status)
    if (statusFilter === 'scheduled') return p.status === 'scheduled'
    if (statusFilter === 'workup') return ['workup_in_progress','workup_complete'].includes(p.status)
    if (statusFilter === 'ready') return p.status === 'ready_for_procedure'
    return p.status === statusFilter
  })

  // Sort: emergency first, then by date
  const sorted = [...displayed].sort((a, b) => {
    const urgencyOrder: Record<string, number> = { emergency: 0, urgent: 1, elective: 2 }
    const uo = (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2)
    if (uo !== 0) return uo
    if (a.scheduled_date && b.scheduled_date) return new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
    if (a.scheduled_date) return -1
    if (b.scheduled_date) return 1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    Object.entries(newForm).forEach(([k, v]) => fd.set(k, v))

    startTransition(async () => {
      const result = await createPlanAction(fd)
      if (!result.ok) { toast.error(result.error); return }
      toast.success('Procedure plan created')
      setShowNew(false)
      router.push(`/procedures/${result.value.id}`)
    })
  }

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1">Procedure planner</span>
          <button onClick={() => router.push('/procedures/protocols')}
            className="text-xs text-navy-800/60 hover:text-navy-800 mr-1 transition-colors">Protocols</button>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 bg-navy-800 text-white text-xs font-medium px-3 py-2 rounded-xl hover:bg-navy-900 active:scale-95 transition-all">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            New plan
          </button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Analytics */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'Active',          value: analytics.active,        color: 'text-navy-800' },
            { label: 'Scheduled',       value: analytics.scheduled,     color: 'text-forest-700' },
            { label: 'Ready',           value: analytics.ready,         color: 'text-forest-700' },
            { label: 'Workup pending',  value: analytics.pendingWorkup, color: 'text-amber-600' },
            { label: 'Consent pending', value: analytics.awaitingConsent,color:'text-red-500' },
          ].map(s => (
            <div key={s.label} className="card-clinical text-center p-2">
              <div className={`font-display text-xl font-medium ${s.color}`}>{s.value}</div>
              <div className="data-label leading-tight mt-0.5 text-2xs">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Ready alert */}
        {analytics.ready > 0 && (
          <div className="bg-forest-50 border border-forest-200/60 rounded-2xl p-4 cursor-pointer"
            onClick={() => setStatusFilter('ready')}>
            <div className="flex items-center justify-between">
              <div>
                <div className="data-label text-forest-700/70 mb-1">Ready for procedure</div>
                <p className="text-sm font-medium text-forest-900">
                  {analytics.ready} patient{analytics.ready > 1 ? 's' : ''} — all workup, consent, and resources confirmed
                </p>
              </div>
              <div className="w-8 h-8 bg-forest-700 rounded-xl flex items-center justify-center text-white font-medium text-sm">
                {analytics.ready}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[
            { key: 'active', label: 'Active' },
            { key: 'scheduled', label: 'Scheduled' },
            { key: 'workup', label: 'Workup' },
            { key: 'ready', label: 'Ready' },
            { key: 'all', label: 'All' },
          ].map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap flex-shrink-0 border transition-all
                ${statusFilter === f.key ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Plan list */}
        {sorted.length > 0 ? (
          <div className="card-clinical p-0 overflow-hidden">
            {sorted.map((plan, idx) => {
              const cfg   = STATUS_CONFIG[plan.status] || STATUS_CONFIG.counselling
              const urg   = URGENCY_CONFIG[plan.urgency] || URGENCY_CONFIG.elective
              const days  = daysUntil(plan.scheduled_date)
              const flags = []
              if (!plan.workup_complete && !['counselling','patient_deciding'].includes(plan.status)) flags.push('workup')
              if (plan.consent_status !== 'signed') flags.push('consent')
              if (!plan.resources_confirmed && plan.scheduled_date) flags.push('resources')

              return (
                <button key={plan.id}
                  onClick={() => router.push(`/procedures/${plan.id}`)}
                  className={`w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-navy-50/60 transition-colors
                    ${idx < sorted.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${cfg.dot}`}/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-medium text-navy-800">{plan.patient_name}</span>
                      <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                      {plan.urgency !== 'elective' && (
                        <span className={`text-2xs font-medium ${urg.color}`}>{urg.label}</span>
                      )}
                    </div>
                    <div className="text-xs text-navy-800/60 mb-0.5">{plan.procedure_name}</div>
                    {flags.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap">
                        {flags.map(f => (
                          <span key={f} className="text-2xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                            {f === 'workup' ? 'Workup pending' : f === 'consent' ? 'Consent needed' : 'Resources unconfirmed'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {plan.scheduled_date ? (
                      <div>
                        <div className="text-xs font-medium text-navy-800">{fmtDate(plan.scheduled_date)}</div>
                        {days !== null && (
                          <div className={`text-2xs ${days <= 3 ? 'text-red-500 font-medium' : days <= 7 ? 'text-amber-600' : 'text-navy-800/35'}`}>
                            {days === 0 ? 'Today' : days < 0 ? `${Math.abs(days)}d ago` : `in ${days}d`}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-navy-800/30">Date TBD</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="card-clinical text-center py-10">
            <div className="w-12 h-12 bg-navy-800/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-navy-800/40">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M12 12v4M10 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="font-display text-xl text-navy-800 mb-2">No procedure plans</h3>
            <p className="text-sm text-navy-800/50 mb-5 leading-relaxed max-w-xs mx-auto">
              Create a plan when you prescribe a procedure. It tracks everything from counselling to post-procedure care.
            </p>
            <button onClick={() => setShowNew(true)} className="btn-primary">Create first plan</button>
          </div>
        )}

        {/* Recent completed */}
        {recentCompleted.length > 0 && (
          <details className="mt-2">
            <summary className="text-xs text-navy-800/40 cursor-pointer hover:text-navy-800/60 transition-colors">
              Recent completed ({recentCompleted.length})
            </summary>
            <div className="mt-2 card-clinical p-0 overflow-hidden">
              {recentCompleted.map((p, i) => (
                <button key={p.id} onClick={() => router.push(`/procedures/${p.id}`)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-navy-50/60 transition-colors
                    ${i < recentCompleted.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                  <div className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0"/>
                  <div className="flex-1">
                    <span className="text-sm text-navy-800/70">{p.patient_name}</span>
                    <span className="text-xs text-navy-800/40 ml-2">{p.procedure_name}</span>
                  </div>
                  <span className={`text-2xs ${p.outcome === 'successful' ? 'text-forest-700' : 'text-amber-700'}`}>
                    {p.outcome || p.status}
                  </span>
                </button>
              ))}
            </div>
          </details>
        )}
      </main>

      {/* New plan modal */}
      {showNew && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center px-4 z-50 animate-fade-in overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-clinical-lg my-4">
            <h2 className="font-display text-xl text-navy-800 mb-1">New procedure plan</h2>
            <p className="text-sm text-navy-800/50 mb-4 leading-relaxed">
              Start a procedure plan when you prescribe a procedure. It will pre-populate with the protocol template.
            </p>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="data-label block mb-1.5">Patient name</label>
                  <input type="text" value={newForm.patient_name}
                    onChange={e => setNewForm(p => ({ ...p, patient_name: e.target.value }))}
                    placeholder="Full name" className="input-clinical" autoFocus required />
                </div>
                <div>
                  <label className="data-label block mb-1.5">Mobile</label>
                  <input type="tel" value={newForm.patient_mobile}
                    onChange={e => setNewForm(p => ({ ...p, patient_mobile: e.target.value }))}
                    placeholder="9876543210" className="input-clinical" />
                </div>
                <div>
                  <label className="data-label block mb-1.5">Age</label>
                  <input type="number" value={newForm.patient_age}
                    onChange={e => setNewForm(p => ({ ...p, patient_age: e.target.value }))}
                    placeholder="55" min="0" max="120" className="input-clinical" />
                </div>
              </div>

              <div>
                <label className="data-label block mb-1.5">Procedure</label>
                <input type="text" value={newForm.procedure_name}
                  onChange={e => setNewForm(p => ({ ...p, procedure_name: e.target.value }))}
                  placeholder="e.g. Coronary Angioplasty (PCI)" className="input-clinical" required />
              </div>

              <div>
                <label className="data-label block mb-1.5">Indication (clinical reason)</label>
                <textarea value={newForm.indication}
                  onChange={e => setNewForm(p => ({ ...p, indication: e.target.value }))}
                  placeholder="e.g. Triple vessel disease with left main stenosis — medical management failed"
                  rows={2} className="input-clinical resize-none text-sm" required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="data-label block mb-1.5">Urgency</label>
                  <select value={newForm.urgency}
                    onChange={e => setNewForm(p => ({ ...p, urgency: e.target.value }))}
                    className="input-clinical">
                    <option value="elective">Elective</option>
                    <option value="urgent">Urgent</option>
                    <option value="emergency">Emergency</option>
                  </select>
                </div>
                <div>
                  <label className="data-label block mb-1.5">Protocol template</label>
                  <select value={newForm.protocol_id}
                    onChange={e => setNewForm(p => ({ ...p, protocol_id: e.target.value }))}
                    className="input-clinical">
                    <option value="">No template</option>
                    {protocols.map(pr => (
                      <option key={pr.id} value={pr.id}>{pr.procedure_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {protocols.length === 0 && (
                <p className="text-xs text-navy-800/40 leading-relaxed">
                  No protocols yet.{' '}
                  <button type="button" onClick={() => { setShowNew(false); router.push('/procedures/protocols') }}
                    className="text-navy-800 underline">Build one</button>
                  {' '}to auto-populate workup, resources, and care plan.
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={isPending || !newForm.patient_name.trim() || !newForm.procedure_name.trim() || !newForm.indication.trim()}
                  className="btn-primary flex-1">
                  {isPending ? 'Creating...' : 'Create plan'}
                </button>
                <button type="button" onClick={() => setShowNew(false)} className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
