'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  broadcastAction, addStakeholderAction, populateStakeholdersAction,
  updateStakeholderAction, overrideConfirmationAction,
  recordMilestoneAction, resolveEscalationAction,
} from '@/app/actions/communications'

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  patient:           { label: 'Patient',          color: 'text-blue-700',   bg: 'bg-blue-50',   icon: '👤' },
  patient_nok:       { label: 'Next of Kin',       color: 'text-blue-600',   bg: 'bg-blue-50',   icon: '👨‍👩‍👦' },
  anaesthesiologist: { label: 'Anaesthesiologist', color: 'text-purple-700', bg: 'bg-purple-50', icon: '💉' },
  ot_coordinator:    { label: 'OT Coordinator',    color: 'text-teal-700',   bg: 'bg-teal-50',   icon: '🏥' },
  scrub_nurse:       { label: 'Scrub Nurse',       color: 'text-teal-600',   bg: 'bg-teal-50',   icon: '🩺' },
  referring_doctor:  { label: 'Referring Doctor',  color: 'text-forest-700', bg: 'bg-forest-50', icon: '👨‍⚕️' },
  perfusionist:      { label: 'Perfusionist',      color: 'text-amber-700',  bg: 'bg-amber-50',  icon: '🔬' },
  ward_nurse:        { label: 'Ward Nurse',         color: 'text-teal-600',   bg: 'bg-teal-50',   icon: '🏥' },
  intensivist:       { label: 'Intensivist',        color: 'text-red-700',    bg: 'bg-red-50',    icon: '💊' },
  physiotherapist:   { label: 'Physiotherapist',   color: 'text-green-700',  bg: 'bg-green-50',  icon: '🤸' },
  other_clinician:   { label: 'Other Clinician',   color: 'text-gray-700',   bg: 'bg-gray-100',  icon: '👨‍⚕️' },
}

const STATUS_CONFIG: Record<string, { label: string; dot: string }> = {
  pending:       { label: 'Not contacted', dot: 'bg-gray-300' },
  notified:      { label: 'Notified',       dot: 'bg-amber-400' },
  confirmed:     { label: 'Confirmed ✓',   dot: 'bg-forest-600' },
  declined:      { label: 'Declined ✗',    dot: 'bg-red-500' },
  non_responsive:{ label: 'No response',   dot: 'bg-red-400 animate-pulse' },
  replaced:      { label: 'Replaced',      dot: 'bg-gray-400' },
}

const BROADCAST_EVENTS = [
  { value: 'procedure_scheduled', label: 'Procedure scheduled — notify all' },
  { value: 'd_minus_3_prep_check', label: 'D-3 preparation check (patient)' },
  { value: 'd_minus_1_fasting', label: 'D-1 fasting reminder (patient)' },
  { value: 'd_day_morning_check', label: 'Morning of procedure (patient)' },
  { value: 'procedure_completed', label: 'Procedure completed' },
  { value: 'patient_discharged', label: 'Patient discharged' },
]

const MILESTONE_PRESETS = [
  { name: 'procedure_completed',    label: 'Procedure completed',      order: 10, notifyPatient: true, notifyReferrer: true },
  { name: 'patient_in_icu',         label: 'Patient in ICU/HDU',       order: 20, notifyPatient: false,notifyReferrer: false },
  { name: 'icu_to_ward',            label: 'Transferred to ward',      order: 30, notifyPatient: true, notifyReferrer: false },
  { name: 'patient_discharged',     label: 'Patient discharged',       order: 40, notifyPatient: true, notifyReferrer: true },
]

function fmtTime(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function CommsDashboardClient({
  plan, specialist, stakeholders, confirmations, escalations, milestones, adherence, templates,
}: {
  plan: any; specialist: any; stakeholders: any[]; confirmations: any[]
  escalations: any[]; milestones: any[]; adherence: any[]; templates: any[]
}) {
  const router = useRouter()
  const planId = plan.id

  const [isPending, startTransition] = useTransition()
  const [activeTab, setActiveTab] = useState<'stakeholders' | 'confirmations' | 'escalations' | 'milestones' | 'adherence'>('stakeholders')
  const [showAddStakeholder, setShowAddStakeholder] = useState(false)
  const [showBroadcast, setShowBroadcast] = useState(false)
  const [showMilestone, setShowMilestone] = useState(false)

  const [newStakeholder, setNewStakeholder] = useState({ role: 'anaesthesiologist', name: '', mobile: '', designation: '' })
  const [broadcastForm, setBroadcastForm] = useState({ event: 'procedure_scheduled', rolesFilter: '', customMsg: '' })
  const [milestoneForm, setMilestoneForm] = useState({ preset: '', notes: '', notifyPatient: true, notifyReferrer: false, customMessage: '' })

  // Analytics
  const totalStakeholders   = stakeholders.length
  const confirmedCount      = stakeholders.filter(s => s.status === 'confirmed').length
  const pendingConfirms     = confirmations.filter(c => !c.is_resolved).length
  const unresolvedEscalations = escalations.filter(e => !e.resolved).length
  const noResponseCount     = stakeholders.filter(s => s.status === 'non_responsive').length

  function handleBroadcast(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const roles = broadcastForm.rolesFilter ? broadcastForm.rolesFilter.split(',').map(r => r.trim()) : undefined
      const r = await broadcastAction(planId, broadcastForm.event, roles, broadcastForm.customMsg || undefined)
      if (!r.ok) toast.error(r.error)
      else { toast.success('Broadcast queued — messages sending'); setShowBroadcast(false); router.refresh() }
    })
  }

  function handleAddStakeholder(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const r = await addStakeholderAction(planId, newStakeholder.role, newStakeholder.name, newStakeholder.mobile, newStakeholder.designation || undefined)
      if (!r.ok) toast.error(r.error)
      else { toast.success('Stakeholder added'); setShowAddStakeholder(false); setNewStakeholder({ role: 'anaesthesiologist', name: '', mobile: '', designation: '' }); router.refresh() }
    })
  }

  function handleMilestone(e: React.FormEvent) {
    e.preventDefault()
    const preset = MILESTONE_PRESETS.find(p => p.name === milestoneForm.preset)
    if (!preset) return
    startTransition(async () => {
      const r = await recordMilestoneAction(planId, preset.name, preset.label, preset.order, {
        clinicalNotes: milestoneForm.notes || undefined,
        notifyPatient: milestoneForm.notifyPatient,
        notifyReferrer: milestoneForm.notifyReferrer,
        patientMessage: milestoneForm.customMessage || undefined,
      })
      if (!r.ok) toast.error(r.error)
      else { toast.success(`Milestone recorded — ${preset.label}`); setShowMilestone(false); router.refresh() }
    })
  }

  const tabs = [
    { key: 'stakeholders',  label: `Stakeholders (${confirmedCount}/${totalStakeholders})` },
    { key: 'confirmations', label: `Confirmations${pendingConfirms > 0 ? ` (${pendingConfirms} pending)` : ''}` },
    { key: 'escalations',   label: `Escalations${unresolvedEscalations > 0 ? ` ⚠${unresolvedEscalations}` : ''}` },
    { key: 'milestones',    label: 'Milestones' },
    { key: 'adherence',     label: 'Patient adherence' },
  ]

  return (
    <div className="min-h-screen bg-clinical-light">
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push(`/procedures/${planId}`)} className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-navy-800 truncate">Comms — {plan.patient_name}</div>
            <div className="text-2xs text-navy-800/50 truncate">{plan.procedure_name}</div>
          </div>
          <button onClick={() => setShowBroadcast(true)}
            className="text-xs font-medium bg-navy-800 text-white px-3 py-2 rounded-xl hover:bg-navy-900 active:scale-95 transition-all">
            Broadcast
          </button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* Analytics strip */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Confirmed',    value: confirmedCount,       color: 'text-forest-700' },
            { label: 'Pending',      value: pendingConfirms,      color: 'text-amber-600' },
            { label: 'Escalations',  value: unresolvedEscalations,color: unresolvedEscalations > 0 ? 'text-red-600' : 'text-navy-800/40' },
            { label: 'No response',  value: noResponseCount,      color: noResponseCount > 0 ? 'text-red-500' : 'text-navy-800/40' },
          ].map(s => (
            <div key={s.label} className="card-clinical text-center p-2">
              <div className={`font-display text-xl ${s.color}`}>{s.value}</div>
              <div className="data-label text-2xs leading-tight mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Unresolved escalation banner */}
        {unresolvedEscalations > 0 && (
          <div className="bg-red-50 border border-red-300 rounded-2xl p-4 cursor-pointer"
            onClick={() => setActiveTab('escalations')}>
            <div className="flex items-center justify-between">
              <div>
                <div className="data-label text-red-700/70 mb-1">Action required</div>
                <p className="text-sm font-medium text-red-900">
                  {unresolvedEscalations} unresolved escalation{unresolvedEscalations > 1 ? 's' : ''} — review and decide
                </p>
              </div>
              <div className="w-8 h-8 bg-red-500 rounded-xl flex items-center justify-center text-white font-medium text-sm">
                {unresolvedEscalations}
              </div>
            </div>
          </div>
        )}

        {/* Tab nav */}
        <div className="bg-white rounded-xl border border-navy-800/8 overflow-x-auto">
          <div className="flex">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key as any)}
                className={`flex-shrink-0 px-3 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors
                  ${activeTab === t.key ? 'text-navy-800 border-navy-800' : 'text-navy-800/40 border-transparent hover:text-navy-800/70'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* STAKEHOLDERS TAB */}
        {activeTab === 'stakeholders' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-navy-800/50">All people who must be aligned for this procedure</p>
              <div className="flex gap-2">
                <button onClick={() => startTransition(async () => {
                  const r = await populateStakeholdersAction(planId)
                  if (!r.ok) toast.error(r.error)
                  else { toast.success(`${r.value.count} stakeholders added`); router.refresh() }
                })} disabled={isPending}
                  className="text-xs text-navy-800/60 hover:text-navy-800 transition-colors">
                  Auto-populate
                </button>
                <button onClick={() => setShowAddStakeholder(true)}
                  className="text-xs font-medium text-forest-700 hover:text-forest-800 transition-colors">
                  + Add
                </button>
              </div>
            </div>

            {stakeholders.length === 0 ? (
              <div className="card-clinical text-center py-8">
                <p className="text-sm text-navy-800/50 mb-3">No stakeholders yet</p>
                <button onClick={() => startTransition(async () => {
                  await populateStakeholdersAction(planId); router.refresh()
                })} className="btn-primary text-sm py-2 px-5">
                  Auto-populate from plan
                </button>
              </div>
            ) : (
              stakeholders.map(s => {
                const roleCfg = ROLE_CONFIG[s.role] || ROLE_CONFIG.other_clinician
                const statusCfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.pending
                const thread = s.communication_threads?.[0]

                return (
                  <div key={s.id} className="card-clinical">
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${statusCfg.dot}`}/>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-sm font-medium text-navy-800">{s.name}</span>
                          <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${roleCfg.bg} ${roleCfg.color}`}>
                            {roleCfg.icon} {roleCfg.label}
                          </span>
                          <span className={`text-2xs ${s.status === 'confirmed' ? 'text-forest-700' : s.status === 'declined' ? 'text-red-600' : 'text-navy-800/40'}`}>
                            {statusCfg.label}
                          </span>
                        </div>
                        {s.designation && <div className="text-xs text-navy-800/40">{s.designation}</div>}
                        {s.mobile && <div className="text-xs text-navy-800/40">{s.mobile}</div>}
                        {thread && thread.total_messages > 0 && (
                          <div className="text-xs text-navy-800/40 mt-0.5">
                            {thread.total_messages} message{thread.total_messages > 1 ? 's' : ''}
                            {thread.unread_count > 0 && (
                              <span className="ml-1.5 bg-navy-800 text-white text-2xs px-1.5 py-0.5 rounded-full">
                                {thread.unread_count} new
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {s.status !== 'confirmed' && s.mobile && (
                        <button onClick={() => startTransition(async () => {
                          const r = await broadcastAction(planId, 'procedure_scheduled', [s.role])
                          if (!r.ok) toast.error(r.error)
                          else { toast.success(`Message sent to ${s.name}`); router.refresh() }
                        })} disabled={isPending}
                          className="text-2xs bg-navy-800 text-white px-2.5 py-1 rounded-lg hover:bg-navy-900 transition-colors flex-shrink-0">
                          Send
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* CONFIRMATIONS TAB */}
        {activeTab === 'confirmations' && (
          <div className="space-y-2">
            {confirmations.length === 0 ? (
              <div className="card-clinical text-center py-8">
                <p className="text-sm text-navy-800/50">No confirmation requests yet. Broadcast to stakeholders to start tracking responses.</p>
              </div>
            ) : (
              confirmations.map(c => {
                const stakeholderName = c.procedure_stakeholders?.name || 'Unknown'
                const role = c.procedure_stakeholders?.role || 'unknown'
                const roleCfg = ROLE_CONFIG[role] || ROLE_CONFIG.other_clinician
                const isOverdue = !c.is_resolved && c.response_required_by && new Date(c.response_required_by) < new Date()

                return (
                  <div key={c.id} className={`card-clinical ${isOverdue ? 'border-red-200/80 bg-red-50/30' : ''}`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                        c.response === 'yes' ? 'bg-forest-600' :
                        c.response === 'no'  ? 'bg-red-500' :
                        isOverdue ? 'bg-red-400 animate-pulse' : 'bg-amber-400'
                      }`}/>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-xs font-medium text-navy-800">{stakeholderName}</span>
                          <span className={`text-2xs px-1.5 py-0.5 rounded-full ${roleCfg.bg} ${roleCfg.color}`}>{roleCfg.label}</span>
                          <span className="text-2xs text-navy-800/40 capitalize">{c.confirmation_type.replace(/_/g, ' ')}</span>
                        </div>
                        <p className="text-xs text-navy-800/60 leading-relaxed">{c.question_text.slice(0, 100)}</p>
                        {c.response && (
                          <p className={`text-xs font-medium mt-1 capitalize ${c.response === 'yes' ? 'text-forest-700' : c.response === 'no' ? 'text-red-600' : 'text-amber-700'}`}>
                            Response: {c.response} — {c.responded_at ? fmtTime(c.responded_at) : ''}
                          </p>
                        )}
                        {isOverdue && !c.is_resolved && (
                          <p className="text-xs text-red-600 font-medium mt-1">
                            ⚠ Overdue since {fmtTime(c.response_required_by)}
                          </p>
                        )}
                      </div>
                      {!c.is_resolved && (
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => startTransition(async () => {
                            await overrideConfirmationAction(c.id, 'yes', 'Manually confirmed by specialist')
                            router.refresh()
                          })} disabled={isPending}
                            className="text-2xs bg-forest-50 text-forest-700 px-2 py-0.5 rounded hover:bg-forest-100 transition-colors">
                            Override ✓
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ESCALATIONS TAB */}
        {activeTab === 'escalations' && (
          <div className="space-y-2">
            {escalations.length === 0 ? (
              <div className="card-clinical text-center py-8">
                <div className="text-forest-700 text-2xl mb-2">✓</div>
                <p className="text-sm text-navy-800/50">No escalations — all communications on track</p>
              </div>
            ) : (
              escalations.map(esc => (
                <div key={esc.id} className={`card-clinical ${!esc.resolved ? 'border-red-200/60 bg-red-50/30' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${esc.resolved ? 'bg-forest-600' : 'bg-red-500'}`}/>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-navy-800 capitalize mb-0.5">
                        {esc.trigger_event.replace(/_/g, ' ')}
                      </div>
                      <div className="text-xs text-navy-800/50">
                        Action: {esc.action_taken.replace(/_/g, ' ')} · {fmtTime(esc.created_at)}
                      </div>
                      {esc.resolved && (
                        <div className="text-xs text-forest-700 mt-0.5">Resolved: {esc.resolution}</div>
                      )}
                    </div>
                    {!esc.resolved && (
                      <div className="flex gap-1.5 flex-shrink-0 flex-col">
                        {['rescheduled', 'cancelled', 'proceeded', 'stakeholder_replaced'].map(res => (
                          <button key={res} onClick={() => startTransition(async () => {
                            await resolveEscalationAction(esc.id, res); router.refresh()
                          })} disabled={isPending}
                            className="text-2xs px-2 py-0.5 rounded border border-navy-800/20 text-navy-800/60 hover:border-navy-800/40 capitalize whitespace-nowrap transition-colors">
                            {res.replace(/_/g, ' ')}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* MILESTONES TAB */}
        {activeTab === 'milestones' && (
          <div className="space-y-2">
            <div className="flex justify-end">
              <button onClick={() => setShowMilestone(true)}
                className="text-xs font-medium text-navy-800 hover:text-navy-900 transition-colors">
                + Record milestone
              </button>
            </div>

            {milestones.length === 0 ? (
              <div className="card-clinical text-center py-8">
                <p className="text-sm text-navy-800/50 mb-3">No milestones recorded yet</p>
                <p className="text-xs text-navy-800/40">Record milestones from procedure completion through to patient discharge. Each milestone triggers appropriate stakeholder notifications.</p>
              </div>
            ) : (
              <div className="relative">
                {milestones.map((m, idx) => (
                  <div key={m.id} className="flex gap-4 mb-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                        m.status === 'reached' ? 'bg-forest-700 border-forest-700' :
                        m.status === 'delayed' ? 'bg-amber-500 border-amber-500' :
                        'bg-white border-navy-800/20'
                      }`}/>
                      {idx < milestones.length - 1 && (
                        <div className="w-0.5 bg-navy-800/10 flex-1 my-1 min-h-4"/>
                      )}
                    </div>
                    <div className="flex-1 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-navy-800">{m.milestone_label}</span>
                        {m.status === 'reached' && <span className="text-2xs text-forest-700">✓</span>}
                      </div>
                      {m.reached_at && <div className="text-xs text-navy-800/40">{fmtTime(m.reached_at)}</div>}
                      <div className="flex gap-2 mt-0.5">
                        {m.notify_patient && <span className="text-2xs text-blue-600">Patient notified</span>}
                        {m.notify_referring_doctor && <span className="text-2xs text-forest-600">Referrer notified</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ADHERENCE TAB */}
        {activeTab === 'adherence' && (
          <div className="space-y-2">
            {adherence.length === 0 ? (
              <div className="card-clinical text-center py-8">
                <p className="text-sm text-navy-800/50">No adherence records yet</p>
                <p className="text-xs text-navy-800/40 mt-1">Adherence checks are recorded automatically when patients respond to preparation reminders</p>
              </div>
            ) : (
              adherence.map(a => (
                <div key={a.id} className={`card-clinical ${a.is_adherent === false ? 'border-red-200/60 bg-red-50/30' : a.is_adherent ? 'border-forest-200/60 bg-forest-50/20' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      a.is_adherent === true ? 'bg-forest-600' :
                      a.is_adherent === false ? 'bg-red-500' : 'bg-gray-400'
                    }`}/>
                    <div className="flex-1">
                      <div className="text-xs font-medium text-navy-800 mb-0.5">
                        {a.check_type.replace(/_/g, ' ')} — {a.check_date}
                      </div>
                      <div className="text-xs text-navy-800/60">{a.item_checked.slice(0, 120)}</div>
                      {a.patient_response && (
                        <div className="text-xs text-navy-800/50 mt-0.5 italic">"{a.patient_response.slice(0, 80)}"</div>
                      )}
                      {a.is_adherent === false && (
                        <div className="text-xs text-red-600 font-medium mt-1">
                          ⚠ Non-adherent — {a.clinical_action || 'Specialist review required'}
                        </div>
                      )}
                    </div>
                    <span className={`text-2xs flex-shrink-0 px-2 py-0.5 rounded-full font-medium ${
                      a.is_adherent === true ? 'bg-forest-50 text-forest-700' :
                      a.is_adherent === false ? 'bg-red-50 text-red-600' :
                      'bg-gray-100 text-gray-500'
                    }`}>
                      {a.is_adherent === true ? '✓ Adherent' : a.is_adherent === false ? '✗ Non-adherent' : 'Unknown'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Broadcast modal */}
      {showBroadcast && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-4">Broadcast to stakeholders</h2>
            <form onSubmit={handleBroadcast} className="space-y-4">
              <div>
                <label className="data-label block mb-1.5">Event / message type</label>
                <select value={broadcastForm.event}
                  onChange={e => setBroadcastForm(p => ({ ...p, event: e.target.value }))}
                  className="input-clinical">
                  {BROADCAST_EVENTS.map(ev => <option key={ev.value} value={ev.value}>{ev.label}</option>)}
                </select>
              </div>
              <div>
                <label className="data-label block mb-1.5">Roles to include (leave blank for all)</label>
                <input type="text" value={broadcastForm.rolesFilter}
                  onChange={e => setBroadcastForm(p => ({ ...p, rolesFilter: e.target.value }))}
                  placeholder="e.g. patient, anaesthesiologist (comma-separated)"
                  className="input-clinical" />
              </div>
              <div>
                <label className="data-label block mb-1.5">Custom message (optional — overrides template)</label>
                <textarea value={broadcastForm.customMsg}
                  onChange={e => setBroadcastForm(p => ({ ...p, customMsg: e.target.value }))}
                  rows={3} placeholder="Leave blank to use the default template for this event"
                  className="input-clinical text-sm resize-none" />
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={isPending} className="btn-primary flex-1">
                  {isPending ? 'Sending...' : 'Send broadcast'}
                </button>
                <button type="button" onClick={() => setShowBroadcast(false)} className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add stakeholder modal */}
      {showAddStakeholder && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-4">Add stakeholder</h2>
            <form onSubmit={handleAddStakeholder} className="space-y-3">
              <div>
                <label className="data-label block mb-1.5">Role</label>
                <select value={newStakeholder.role}
                  onChange={e => setNewStakeholder(p => ({ ...p, role: e.target.value }))}
                  className="input-clinical">
                  {Object.entries(ROLE_CONFIG).map(([v, cfg]) => (
                    <option key={v} value={v}>{cfg.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="data-label block mb-1.5">Name</label>
                <input type="text" value={newStakeholder.name}
                  onChange={e => setNewStakeholder(p => ({ ...p, name: e.target.value }))}
                  placeholder="Full name" className="input-clinical" autoFocus required />
              </div>
              <div>
                <label className="data-label block mb-1.5">WhatsApp mobile</label>
                <input type="tel" value={newStakeholder.mobile}
                  onChange={e => setNewStakeholder(p => ({ ...p, mobile: e.target.value }))}
                  placeholder="9876543210" className="input-clinical" />
              </div>
              <div>
                <label className="data-label block mb-1.5">Designation (optional)</label>
                <input type="text" value={newStakeholder.designation}
                  onChange={e => setNewStakeholder(p => ({ ...p, designation: e.target.value }))}
                  placeholder="e.g. Cardiac Anaesthesiologist, Apollo" className="input-clinical" />
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={isPending || !newStakeholder.name.trim()}
                  className="btn-primary flex-1">
                  {isPending ? 'Adding...' : 'Add stakeholder'}
                </button>
                <button type="button" onClick={() => setShowAddStakeholder(false)} className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record milestone modal */}
      {showMilestone && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-4">Record milestone</h2>
            <form onSubmit={handleMilestone} className="space-y-3">
              <div>
                <label className="data-label block mb-1.5">Milestone</label>
                <select value={milestoneForm.preset}
                  onChange={e => setMilestoneForm(p => ({ ...p, preset: e.target.value }))}
                  className="input-clinical" required>
                  <option value="">Select milestone...</option>
                  {MILESTONE_PRESETS.map(m => <option key={m.name} value={m.name}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="data-label block mb-1.5">Clinical notes (optional)</label>
                <textarea value={milestoneForm.notes}
                  onChange={e => setMilestoneForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2} placeholder="Outcome, vitals, key findings..."
                  className="input-clinical text-sm resize-none" />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={milestoneForm.notifyPatient}
                    onChange={e => setMilestoneForm(p => ({ ...p, notifyPatient: e.target.checked }))}
                    className="w-4 h-4" />
                  Notify patient
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={milestoneForm.notifyReferrer}
                    onChange={e => setMilestoneForm(p => ({ ...p, notifyReferrer: e.target.checked }))}
                    className="w-4 h-4" />
                  Notify referring doctor
                </label>
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={isPending || !milestoneForm.preset}
                  className="btn-primary flex-1">
                  {isPending ? 'Recording...' : 'Record milestone'}
                </button>
                <button type="button" onClick={() => setShowMilestone(false)} className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
