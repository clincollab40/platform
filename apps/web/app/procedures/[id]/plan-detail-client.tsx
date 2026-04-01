'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  updatePlanAction, updateWorkupItemAction, updateResourceAction,
  updateConsentAction, sendCarePlanAlertAction, checkPlanReadinessAction,
  completeProcedureAction,
} from '@/app/actions/procedures'

type Plan = any
const WORKUP_STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  not_ordered:          { label: 'Not ordered',      color: 'text-gray-500',   bg: 'bg-gray-100' },
  ordered:              { label: 'Ordered',           color: 'text-blue-600',   bg: 'bg-blue-50' },
  done_pending_review:  { label: 'Done — review',     color: 'text-amber-700',  bg: 'bg-amber-50' },
  reviewed_normal:      { label: '✓ Normal',          color: 'text-forest-700', bg: 'bg-forest-50' },
  reviewed_acceptable:  { label: '✓ Acceptable',      color: 'text-forest-700', bg: 'bg-forest-50' },
  reviewed_abnormal:    { label: '⚠ Abnormal',        color: 'text-amber-700',  bg: 'bg-amber-50' },
  waived:               { label: 'Waived',            color: 'text-gray-400',   bg: 'bg-gray-50' },
}
const RESOURCE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  required:    { label: 'Required',   color: 'text-amber-600' },
  requested:   { label: 'Requested',  color: 'text-blue-600' },
  confirmed:   { label: '✓ Confirmed',color: 'text-forest-700' },
  unavailable: { label: '✗ Unavailable',color:'text-red-600' },
  not_needed:  { label: 'N/A',        color: 'text-gray-400' },
}
const ALERT_LABELS: Record<string, string> = {
  d_minus_7: 'D-7 (one week before)', d_minus_3: 'D-3 (three days before)',
  d_minus_1: 'D-1 (day before)', d_day_morning: 'Day of procedure',
  post_procedure_24h: 'Post-procedure day 1', post_procedure_7d: 'Post-procedure week 1',
}

export default function PlanDetailClient({ plan, specialist }: { plan: Plan; specialist: any }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<'overview'|'workup'|'resources'|'consent'|'careplan'|'alerts'>('overview')
  const [scheduledDate, setScheduledDate] = useState(plan.scheduled_date || '')
  const [scheduledTime, setScheduledTime] = useState(plan.scheduled_time || '')

  const workup    = (plan.procedure_workup || []).sort((a: any, b: any) => a.sort_order - b.sort_order)
  const resources = (plan.procedure_resources || []).sort((a: any, b: any) => a.sort_order - b.sort_order)
  const medHolds  = plan.procedure_medication_holds || []
  const carePlan  = plan.patient_care_plans?.[0]
  const consent   = plan.procedure_consent?.[0]
  const alertLog  = plan.procedure_alert_log || []

  const workupDone      = workup.filter((w: any) => ['reviewed_normal','reviewed_acceptable','reviewed_abnormal','waived'].includes(w.status)).length
  const workupTotal     = workup.filter((w: any) => w.mandatory).length
  const resourcesDone   = resources.filter((r: any) => ['confirmed','not_needed'].includes(r.status)).length
  const resourcesTotal  = resources.filter((r: any) => r.mandatory).length
  const sentAlertStages = new Set(alertLog.map((a: any) => a.alert_stage))

  function updateWorkup(itemId: string, status: string) {
    startTransition(async () => {
      await updateWorkupItemAction(itemId, { status })
      router.refresh()
    })
  }

  function updateResource(resourceId: string, status: string) {
    startTransition(async () => {
      await updateResourceAction(resourceId, status)
      router.refresh()
    })
  }

  function saveSchedule() {
    startTransition(async () => {
      const r = await updatePlanAction(plan.id, {
        scheduled_date: scheduledDate || null,
        scheduled_time: scheduledTime || null,
        status: scheduledDate && plan.status === 'counselling' ? 'scheduled' : plan.status,
      })
      if (!r.ok) toast.error(r.error)
      else { toast.success('Schedule saved'); router.refresh() }
    })
  }

  function sendAlert(stage: string) {
    startTransition(async () => {
      const r = await sendCarePlanAlertAction(plan.id, stage)
      if (!r.ok) toast.error(r.error)
      else { toast.success(`Alert sent to patient`); router.refresh() }
    })
  }

  async function checkReadiness() {
    startTransition(async () => {
      const r = await checkPlanReadinessAction(plan.id)
      if (!r.ok) { toast.error(r.error); return }
      if (r.value.ready) toast.success('All checks passed — patient is ready for procedure')
      else {
        const issues = []
        if (r.value.pendingWorkupCount > 0) issues.push(`${r.value.pendingWorkupCount} workup items pending`)
        if (r.value.pendingResourceCount > 0) issues.push(`${r.value.pendingResourceCount} resources unconfirmed`)
        if (!r.value.consentSigned) issues.push('Consent not signed')
        toast.error('Not ready: ' + issues.join(', '))
      }
      router.refresh()
    })
  }

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'workup',   label: `Workup (${workupDone}/${workupTotal})` },
    { key: 'resources',label: `Resources (${resourcesDone}/${resourcesTotal})` },
    { key: 'consent',  label: consent?.form_signed ? '✓ Consent' : 'Consent' },
    { key: 'careplan', label: 'Care plan' },
    { key: 'alerts',   label: `Alerts (${sentAlertStages.size})` },
  ]

  return (
    <div className="min-h-screen bg-clinical-light">
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/procedures')} className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-navy-800 truncate">{plan.patient_name}</div>
            <div className="text-2xs text-navy-800/50 truncate">{plan.procedure_name}</div>
          </div>
          {plan.status === 'ready_for_procedure' && (
            <span className="text-2xs bg-forest-50 text-forest-700 px-2 py-1 rounded-full font-medium flex-shrink-0">✓ Ready</span>
          )}
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* Tab nav */}
        <div className="bg-white rounded-xl border border-navy-800/8 overflow-x-auto">
          <div className="flex">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key as any)}
                className={`flex-shrink-0 px-3 py-3 text-xs font-medium whitespace-nowrap transition-colors border-b-2
                  ${tab === t.key ? 'text-navy-800 border-navy-800' : 'text-navy-800/40 border-transparent hover:text-navy-800/70'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* OVERVIEW TAB */}
        {tab === 'overview' && (
          <div className="space-y-3">
            <div className="card-clinical">
              <div className="data-label mb-3">Procedure details</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {[
                  ['Patient', plan.patient_name],
                  ['Age/Gender', [plan.patient_age, plan.patient_gender].filter(Boolean).join(', ') || '—'],
                  ['Mobile', plan.patient_mobile || '—'],
                  ['Procedure', plan.procedure_name],
                  ['Urgency', plan.urgency],
                  ['OT type', plan.ot_room_type || plan.procedure_protocols?.ot_room_type || '—'],
                  ['Anaesthesia', plan.anaesthesia_type || plan.procedure_protocols?.anaesthesia_type || '—'],
                  ['Est. duration', plan.estimated_duration_mins ? `${plan.estimated_duration_mins} min` : '—'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="data-label text-2xs">{k}</div>
                    <div className="text-navy-800/80 text-xs mt-0.5">{v}</div>
                  </div>
                ))}
              </div>
              {plan.indication && (
                <div className="mt-3 pt-3 border-t border-navy-800/8">
                  <div className="data-label text-2xs mb-1">Indication</div>
                  <p className="text-xs text-navy-800/70 leading-relaxed">{plan.indication}</p>
                </div>
              )}
            </div>

            {/* Scheduling */}
            <div className="card-clinical space-y-3">
              <div className="data-label">Schedule</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="data-label block mb-1.5">Procedure date</label>
                  <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]} className="input-clinical" />
                </div>
                <div>
                  <label className="data-label block mb-1.5">Start time</label>
                  <input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} className="input-clinical" />
                </div>
              </div>
              <button onClick={saveSchedule} disabled={isPending} className="btn-primary w-full py-2.5">
                {isPending ? 'Saving...' : 'Save schedule'}
              </button>
            </div>

            {/* Readiness summary */}
            <div className="card-clinical space-y-2">
              <div className="flex items-center justify-between">
                <div className="data-label">Plan readiness</div>
                <button onClick={checkReadiness} disabled={isPending}
                  className="text-xs text-navy-800/60 hover:text-navy-800 transition-colors">Check now</button>
              </div>
              {[
                { label: 'Workup', done: workupDone, total: workupTotal, ok: plan.workup_complete },
                { label: 'Resources', done: resourcesDone, total: resourcesTotal, ok: plan.resources_confirmed },
                { label: 'Consent', done: consent?.form_signed ? 1 : 0, total: 1, ok: consent?.form_signed },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${item.ok ? 'bg-forest-700' : 'bg-navy-800/10'}`}>
                    {item.ok && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4l2 2 3-3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <div className="flex-1 text-sm text-navy-800/70">{item.label}</div>
                  <div className="text-xs text-navy-800/50">{item.done}/{item.total}</div>
                </div>
              ))}
            </div>

            {/* Medication holds */}
            {medHolds.length > 0 && (
              <div className="card-clinical">
                <div className="data-label mb-3">Medication holds before procedure</div>
                <div className="space-y-2">
                  {medHolds.filter((m: any) => m.applies_to_patient !== false).map((hold: any) => (
                    <div key={hold.id} className="bg-amber-50 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-navy-800">{hold.drug_name}</span>
                        <span className="text-xs text-amber-700">Stop {hold.hold_days_before}d before</span>
                      </div>
                      <p className="text-xs text-navy-800/60">{hold.reason}</p>
                      <p className="text-xs text-navy-800/50 mt-0.5">Resume: {hold.resume_when}</p>
                      {hold.bridging_required && (
                        <p className="text-xs text-red-600 mt-1 font-medium">⚠ Bridging required: {hold.bridging_details}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* WORKUP TAB */}
        {tab === 'workup' && (
          <div className="space-y-2">
            <div className="bg-navy-50 rounded-xl px-4 py-2.5">
              <p className="text-xs text-navy-800/70">{workupDone} of {workupTotal} mandatory investigations reviewed. All must be reviewed before marking ready.</p>
            </div>
            {workup.map((item: any) => {
              const cfg = WORKUP_STATUS_LABELS[item.status] || WORKUP_STATUS_LABELS.not_ordered
              return (
                <div key={item.id} className="card-clinical">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-sm font-medium text-navy-800">{item.investigation}</span>
                        {item.mandatory && <span className="text-2xs bg-navy-800/8 text-navy-800/50 px-1.5 py-0.5 rounded">Required</span>}
                        {item.is_abnormal && <span className="text-2xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">Abnormal</span>}
                      </div>
                      {item.result_value && <p className="text-xs text-navy-800/60">Result: {item.result_value}</p>}
                      {item.normal_range && <p className="text-2xs text-navy-800/40">Normal: {item.normal_range}</p>}
                    </div>
                    <span className={`text-2xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  {/* Quick actions */}
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {item.status === 'not_ordered' && (
                      <button onClick={() => updateWorkup(item.id, 'ordered')} disabled={isPending}
                        className="text-2xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg hover:bg-blue-100 transition-colors">
                        Mark ordered
                      </button>
                    )}
                    {item.status === 'ordered' && (
                      <button onClick={() => updateWorkup(item.id, 'done_pending_review')} disabled={isPending}
                        className="text-2xs bg-amber-50 text-amber-700 px-2.5 py-1 rounded-lg hover:bg-amber-100 transition-colors">
                        Mark done
                      </button>
                    )}
                    {['done_pending_review','ordered'].includes(item.status) && (
                      <>
                        <button onClick={() => updateWorkup(item.id, 'reviewed_normal')} disabled={isPending}
                          className="text-2xs bg-forest-50 text-forest-700 px-2.5 py-1 rounded-lg hover:bg-forest-100 transition-colors">
                          Normal
                        </button>
                        <button onClick={() => updateWorkup(item.id, 'reviewed_abnormal')} disabled={isPending}
                          className="text-2xs bg-amber-50 text-amber-700 px-2.5 py-1 rounded-lg hover:bg-amber-100 transition-colors">
                          Abnormal
                        </button>
                        <button onClick={() => updateWorkup(item.id, 'reviewed_acceptable')} disabled={isPending}
                          className="text-2xs bg-teal-50 text-teal-700 px-2.5 py-1 rounded-lg hover:bg-teal-100 transition-colors">
                          Acceptable
                        </button>
                      </>
                    )}
                    {!['reviewed_normal','reviewed_acceptable','reviewed_abnormal','waived'].includes(item.status) && (
                      <button onClick={() => updateWorkup(item.id, 'waived')} disabled={isPending}
                        className="text-2xs text-gray-500 px-2.5 py-1 rounded-lg hover:bg-gray-50 transition-colors">
                        Waive
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* RESOURCES TAB */}
        {tab === 'resources' && (
          <div className="space-y-2">
            <div className="bg-navy-50 rounded-xl px-4 py-2.5">
              <p className="text-xs text-navy-800/70">{resourcesDone} of {resourcesTotal} resources confirmed. All mandatory resources must be confirmed before the procedure date.</p>
            </div>
            {Object.entries(
              resources.reduce((acc: any, r: any) => {
                const type = r.resource_type
                if (!acc[type]) acc[type] = []
                acc[type].push(r)
                return acc
              }, {})
            ).map(([type, items]: [string, any]) => (
              <div key={type} className="card-clinical">
                <div className="data-label mb-2 capitalize">{type.replace(/_/g, ' ')}</div>
                {(items as any[]).map((r: any) => {
                  const cfg = RESOURCE_STATUS_LABELS[r.status] || RESOURCE_STATUS_LABELS.required
                  return (
                    <div key={r.id} className="flex items-center gap-3 py-2 border-b border-navy-800/5 last:border-0">
                      <div className="flex-1">
                        <div className="text-sm text-navy-800">{r.name}</div>
                        {r.specification && <div className="text-xs text-navy-800/40">{r.specification}</div>}
                        {r.quantity > 1 && <div className="text-xs text-navy-800/40">Qty: {r.quantity}</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-2xs font-medium ${cfg.color}`}>{cfg.label}</span>
                        {r.status !== 'confirmed' && r.status !== 'not_needed' && (
                          <button onClick={() => updateResource(r.id, 'confirmed')} disabled={isPending}
                            className="text-2xs bg-forest-50 text-forest-700 px-2 py-0.5 rounded hover:bg-forest-100 transition-colors">
                            Confirm
                          </button>
                        )}
                        {r.status !== 'not_needed' && (
                          <button onClick={() => updateResource(r.id, 'not_needed')} disabled={isPending}
                            className="text-2xs text-gray-400 px-2 py-0.5 rounded hover:bg-gray-50 transition-colors">
                            N/A
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {/* CONSENT TAB */}
        {tab === 'consent' && (
          <div className="space-y-3">
            {consent?.form_signed ? (
              <div className="bg-forest-50 border border-forest-200/60 rounded-2xl p-4 text-center">
                <div className="text-forest-700 text-2xl mb-1">✓</div>
                <div className="text-sm font-medium text-forest-700">Consent signed</div>
                <div className="text-xs text-navy-800/50 mt-1">
                  {consent.form_signed_at ? new Date(consent.form_signed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                  {consent.witness_name ? ` · Witness: ${consent.witness_name}` : ''}
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-3">
                <p className="text-xs text-amber-800/80">Consent not yet signed. Complete the consent discussion below and mark when the form is signed.</p>
              </div>
            )}

            {/* Consent checklist */}
            {plan.procedure_protocols?.consent_items && (
              <div className="card-clinical">
                <div className="data-label mb-3">Consent discussion checklist</div>
                <div className="space-y-2">
                  {(plan.procedure_protocols.consent_items as any[]).map((item: any) => (
                    <div key={item.id} className="flex gap-3">
                      <input type="checkbox"
                        checked={consent?.risks_covered?.some?.((r: any) => r.id === item.id) || false}
                        onChange={async (e) => {
                          const current = consent?.risks_covered || []
                          const updated = e.target.checked
                            ? [...current, { id: item.id, discussed_at: new Date().toISOString() }]
                            : current.filter((r: any) => r.id !== item.id)
                          await updateConsentAction(plan.id, { risks_covered: updated })
                          router.refresh()
                        }}
                        className="mt-0.5 w-4 h-4 flex-shrink-0" />
                      <div>
                        <div className="text-sm text-navy-800">{item.topic}</div>
                        <div className="text-xs text-navy-800/50 leading-relaxed">{item.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mark consent signed */}
            {!consent?.form_signed && (
              <button
                onClick={async () => {
                  startTransition(async () => {
                    const r = await updateConsentAction(plan.id, {
                      form_signed: true,
                      form_signed_at: new Date().toISOString(),
                      patient_decision: 'agreed',
                    })
                    if (!r.ok) toast.error(r.error)
                    else { toast.success('Consent signed'); router.refresh() }
                  })
                }}
                disabled={isPending}
                className="btn-primary w-full py-3">
                ✓ Mark consent form as signed
              </button>
            )}
          </div>
        )}

        {/* CARE PLAN TAB */}
        {tab === 'careplan' && (
          <div className="space-y-3">
            <div className="bg-purple-50 border border-purple-200/60 rounded-xl px-4 py-3">
              <p className="text-xs text-purple-800/80 leading-relaxed">
                The care plan is sent to the patient via WhatsApp in stages. Each alert is sent manually from the Alerts tab — you control the timing.
              </p>
            </div>

            {carePlan && (
              <div className="space-y-3">
                {[
                  { key: 'fasting_instructions', label: 'Fasting instructions', placeholder: 'Do not eat or drink after midnight...' },
                  { key: 'arrival_instructions', label: 'Arrival instructions', placeholder: 'Arrive at the hospital at...' },
                  { key: 'what_to_bring', label: 'What to bring', placeholder: 'All investigation reports, ID proof...' },
                  { key: 'post_procedure_instructions', label: 'Post-procedure instructions', placeholder: 'After the procedure...' },
                  { key: 'activity_restrictions', label: 'Activity restrictions', placeholder: 'No lifting, no driving for...' },
                  { key: 'red_flags', label: 'Red flags — when to go to emergency', placeholder: 'Go to emergency immediately if...' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key} className="card-clinical">
                    <label className="data-label block mb-2">{label}</label>
                    <textarea
                      defaultValue={(carePlan as any)[key] || ''}
                      onBlur={async e => {
                        await updatePlanAction(plan.id, {})
                        // Save via care plan update
                        const { saveCareplanAction } = await import('@/app/actions/procedures')
                        await saveCareplanAction(plan.id, { [key]: e.target.value })
                      }}
                      placeholder={placeholder}
                      rows={3}
                      className="input-clinical text-sm resize-none w-full" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ALERTS TAB */}
        {tab === 'alerts' && (
          <div className="space-y-3">
            <div className="bg-navy-50 rounded-xl px-4 py-3">
              <p className="text-xs text-navy-800/70 leading-relaxed">
                Send WhatsApp alerts to {plan.patient_name} at key stages. Each alert uses the care plan content.
                {!plan.patient_mobile && <span className="text-amber-700 font-medium"> No patient mobile — add it to the plan to send alerts.</span>}
              </p>
            </div>

            {Object.entries(ALERT_LABELS).map(([stage, label]) => {
              const sent = sentAlertStages.has(stage)
              const sentEntry = alertLog.find((a: any) => a.alert_stage === stage)
              return (
                <div key={stage} className="card-clinical flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${sent ? 'bg-forest-600' : 'bg-navy-800/15'}`}/>
                  <div className="flex-1">
                    <div className="text-sm text-navy-800">{label}</div>
                    {sent && sentEntry && (
                      <div className="text-xs text-navy-800/40">
                        Sent {new Date(sentEntry.delivered_at).toLocaleDateString('en-IN')}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => sendAlert(stage)}
                    disabled={isPending || !plan.patient_mobile}
                    className={`text-xs font-medium px-3 py-1.5 rounded-xl transition-all
                      ${sent ? 'bg-navy-800/8 text-navy-800/50 hover:bg-navy-800/12' : 'bg-navy-800 text-white hover:bg-navy-900'}`}>
                    {sent ? 'Resend' : 'Send now'}
                  </button>
                </div>
              )
            })}

            {/* Procedure complete */}
            {['in_progress', 'ready_for_procedure', 'scheduled'].includes(plan.status) && (
              <div className="mt-4 card-clinical border-forest-200/60 bg-forest-50">
                <div className="data-label text-forest-700/70 mb-3">Mark procedure complete</div>
                <div className="flex gap-3">
                  {['successful', 'complicated', 'abandoned'].map(outcome => (
                    <button key={outcome}
                      onClick={() => startTransition(async () => {
                        const r = await completeProcedureAction(plan.id, outcome)
                        if (!r.ok) toast.error(r.error)
                        else { toast.success('Procedure marked complete'); router.refresh() }
                      })}
                      disabled={isPending}
                      className={`flex-1 text-xs font-medium py-2.5 rounded-xl border transition-all capitalize
                        ${outcome === 'successful' ? 'bg-forest-700 text-white border-forest-700 hover:bg-forest-800' :
                          outcome === 'complicated' ? 'border-amber-500 text-amber-700 hover:bg-amber-50' :
                          'border-red-300 text-red-600 hover:bg-red-50'}`}>
                      {outcome}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
