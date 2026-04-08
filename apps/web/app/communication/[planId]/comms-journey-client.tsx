'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  broadcastAction,
  addStakeholderAction,
  populateStakeholdersAction,
  overrideConfirmationAction,
  resolveEscalationAction,
  recordMilestoneAction,
  updateStakeholderAction,
} from '@/app/actions/communications'

// ── Types ──────────────────────────────────────────────────────────────────
type Plan = {
  id: string; patient_name: string; procedure_name: string
  urgency: string; status: string; scheduled_date: string | null
  scheduled_time: string | null; consent_status: string; workup_complete: boolean
  patient_mobile: string | null
  procedure_protocols: { procedure_code: string; ot_room_type: string; anaesthesia_type: string; estimated_duration_mins: number } | null
}

type Stakeholder = {
  id: string; role: string; name: string; mobile: string | null
  designation: string | null; status: string; last_contacted_at: string | null
  confirmed_at: string | null; confirmations_needed: string[]
  notify_on_schedule: boolean; notify_d_minus_3: boolean; notify_d_minus_1: boolean
  notify_d_day: boolean; notify_post_procedure: boolean; notify_discharge: boolean
  is_referring_doctor: boolean; notes: string | null; sort_order: number
  thread: {
    id: string; unread_count: number; total_messages: number
    pending_confirmations: string[] | null; completed_confirmations: string[] | null
    last_event_at: string | null; last_direction: string | null
  } | null
  recentEvents: {
    id: string; direction: string; message_text: string
    is_automated: boolean; created_at: string; channel: string
  }[]
}

type Confirmation = {
  id: string; stakeholder_id: string; confirmation_type: string; question_text: string
  sent_at: string; response_required_by: string | null; response: string | null
  response_text: string | null; responded_at: string | null; is_resolved: boolean
  resolved_by: string | null; override_reason: string | null
}

type Escalation = {
  id: string; trigger_event: string; severity: string; description: string | null
  resolved: boolean; resolved_at: string | null; resolved_by: string | null
  resolution_notes: string | null; created_at: string
}

type Milestone = {
  id: string; milestone_name: string; milestone_label: string
  status: string; sequence_order: number; reached_at: string | null
  clinical_notes: string | null; notify_patient: boolean; notify_referring_doctor: boolean
}

// ── Journey stages ─────────────────────────────────────────────────────────
type Stage = 'planning' | 'd_minus_7' | 'd_minus_3' | 'd_minus_1' | 'd_day' | 'post_procedure' | 'discharge'

const STAGES: { key: Stage; label: string; short: string; daysRange: [number, number] }[] = [
  { key: 'planning',       label: 'Planning',     short: 'Plan',    daysRange: [999, 8] },
  { key: 'd_minus_7',      label: '1 week out',   short: 'D-7',     daysRange: [7, 4] },
  { key: 'd_minus_3',      label: '3 days out',   short: 'D-3',     daysRange: [3, 2] },
  { key: 'd_minus_1',      label: 'Day before',   short: 'D-1',     daysRange: [1, 1] },
  { key: 'd_day',          label: 'Procedure day',short: 'D-Day',   daysRange: [0, 0] },
  { key: 'post_procedure', label: 'Post-op',      short: 'Post-op', daysRange: [-1, -3] },
  { key: 'discharge',      label: 'Discharge',    short: 'D/C',     daysRange: [-4, -999] },
]

// Which stages a stakeholder participates in (based on their notify_* fields)
function getStakeholderStages(s: Stakeholder): Stage[] {
  const stages: Stage[] = ['planning']
  if (s.notify_on_schedule)   stages.push('d_minus_7')
  if (s.notify_d_minus_3)     stages.push('d_minus_3')
  if (s.notify_d_minus_1)     stages.push('d_minus_1')
  if (s.notify_d_day)         stages.push('d_day')
  if (s.notify_post_procedure)stages.push('post_procedure')
  if (s.notify_discharge)     stages.push('discharge')
  return stages
}

// Determine current active stage from scheduled date
function getCurrentStage(scheduledDate: string | null): Stage {
  if (!scheduledDate) return 'planning'
  const days = Math.ceil((new Date(scheduledDate).getTime() - Date.now()) / 86400000)
  if (days > 7)  return 'planning'
  if (days > 3)  return 'd_minus_7'
  if (days > 1)  return 'd_minus_3'
  if (days === 1)return 'd_minus_1'
  if (days === 0)return 'd_day'
  if (days > -4) return 'post_procedure'
  return 'discharge'
}

// Map confirmation_type to journey stage
const CONF_STAGE_MAP: Record<string, Stage> = {
  availability:        'd_minus_7',
  pre_assessment_done: 'd_minus_7',
  equipment_confirmed: 'd_minus_1',
  patient_preparation: 'd_minus_3',
  patient_arrived:     'd_day',
  procedure_done:      'post_procedure',
  patient_discharged:  'discharge',
  adherence_check:     'd_minus_3',
  custom:              'planning',
}

// ── Config ─────────────────────────────────────────────────────────────────
const ROLE_CONFIG: Record<string, { label: string; icon: string; bg: string; color: string }> = {
  patient:           { label: 'Patient',          icon: '👤', bg: 'bg-blue-50',   color: 'text-blue-700' },
  patient_nok:       { label: 'Next of Kin',       icon: '👨‍👩‍👦', bg: 'bg-blue-50',   color: 'text-blue-600' },
  anaesthesiologist: { label: 'Anaesthesiologist', icon: '💉', bg: 'bg-purple-50', color: 'text-purple-700' },
  ot_coordinator:    { label: 'OT Coordinator',    icon: '🏥', bg: 'bg-teal-50',   color: 'text-teal-700' },
  scrub_nurse:       { label: 'Scrub Nurse',       icon: '🩺', bg: 'bg-teal-50',   color: 'text-teal-600' },
  referring_doctor:  { label: 'Referring Dr',      icon: '👨‍⚕️', bg: 'bg-forest-50', color: 'text-forest-700' },
  perfusionist:      { label: 'Perfusionist',      icon: '🔬', bg: 'bg-amber-50',  color: 'text-amber-700' },
  ward_nurse:        { label: 'Ward Nurse',         icon: '🏥', bg: 'bg-teal-50',   color: 'text-teal-600' },
  intensivist:       { label: 'Intensivist',        icon: '💊', bg: 'bg-red-50',    color: 'text-red-700' },
  physiotherapist:   { label: 'Physiotherapist',   icon: '🤸', bg: 'bg-green-50',  color: 'text-green-700' },
  other_clinician:   { label: 'Other',             icon: '👨‍⚕️', bg: 'bg-gray-100',  color: 'text-gray-600' },
}

const STATUS_DOT: Record<string, string> = {
  pending:       'bg-gray-300',
  notified:      'bg-amber-400',
  confirmed:     'bg-forest-600',
  declined:      'bg-red-500',
  non_responsive:'bg-red-400 animate-pulse',
  replaced:      'bg-gray-400',
}

const STATUS_LABEL: Record<string, string> = {
  pending:       'Not contacted',
  notified:      'Notified',
  confirmed:     'Confirmed ✓',
  declined:      'Declined',
  non_responsive:'No response ⚠',
  replaced:      'Replaced',
}

const MILESTONE_PRESETS = [
  { name: 'procedure_completed', label: 'Procedure completed', order: 10 },
  { name: 'patient_in_icu',      label: 'Patient in ICU/HDU',  order: 20 },
  { name: 'icu_to_ward',         label: 'Transferred to ward', order: 30 },
  { name: 'patient_discharged',  label: 'Patient discharged',  order: 40 },
]

function fmtTime(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtDate(d: string | null) {
  if (!d) return 'Unscheduled'
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)
}

// ── Stakeholder card (compact) ─────────────────────────────────────────────
function StakeholderCard({
  s, confirmations, onSend, onConfirm, isPending,
}: {
  s: Stakeholder
  confirmations: Confirmation[]
  onSend: (s: Stakeholder) => void
  onConfirm: (s: Stakeholder) => void
  isPending: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const role = ROLE_CONFIG[s.role] || ROLE_CONFIG.other_clinician
  const myConfs = confirmations.filter(c => c.stakeholder_id === s.id)
  const pendingConfs = myConfs.filter(c => !c.is_resolved)
  const overdueConfs = pendingConfs.filter(c =>
    c.response_required_by && new Date(c.response_required_by) < new Date()
  )
  const isActionable = s.status !== 'confirmed' || pendingConfs.length > 0 || overdueConfs.length > 0

  return (
    <div className={`card-clinical p-0 overflow-hidden ${
      s.status === 'non_responsive' || overdueConfs.length > 0
        ? 'border-red-200/60'
        : s.status === 'confirmed' && pendingConfs.length === 0
        ? 'border-forest-200/40'
        : ''
    }`}>
      {/* Main row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-navy-50/40 transition-colors"
      >
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${STATUS_DOT[s.status] || 'bg-gray-300'}`} />

        <div className="flex-1 min-w-0">
          {/* Row 1: name + role + status */}
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-xs font-medium text-navy-800">{s.name}</span>
            <span className={`text-2xs px-1.5 py-0.5 rounded-full font-medium ${role.bg} ${role.color}`}>
              {role.icon} {role.label}
            </span>
            <span className={`text-2xs font-medium ${
              s.status === 'confirmed'     ? 'text-forest-700' :
              s.status === 'non_responsive'? 'text-red-600' :
              s.status === 'declined'      ? 'text-red-500' :
              'text-navy-800/40'
            }`}>
              {STATUS_LABEL[s.status] || s.status}
            </span>
          </div>

          {/* Row 2: last contact + pending confs */}
          <div className="flex items-center gap-2 flex-wrap">
            {s.last_contacted_at && (
              <span className="text-2xs text-navy-800/35">
                Last contacted {fmtTime(s.last_contacted_at)}
              </span>
            )}
            {pendingConfs.length > 0 && (
              <span className={`text-2xs font-medium ${overdueConfs.length > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                {overdueConfs.length > 0 ? `⚠ ${overdueConfs.length} overdue` : `${pendingConfs.length} awaiting reply`}
              </span>
            )}
            {s.thread && s.thread.unread_count > 0 && (
              <span className="text-2xs bg-navy-800 text-white px-1.5 py-0.5 rounded-full">
                {s.thread.unread_count} new
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-1 items-center flex-shrink-0">
          {s.status === 'confirmed' && pendingConfs.length === 0 ? (
            <span className="text-forest-600 text-xs">✓</span>
          ) : (
            <>
              {s.mobile && (
                <button
                  onClick={e => { e.stopPropagation(); onSend(s) }}
                  disabled={isPending}
                  className="text-2xs bg-navy-800 text-white px-2.5 py-1 rounded-lg hover:bg-navy-900 transition-colors"
                >
                  Send
                </button>
              )}
              <button
                onClick={e => { e.stopPropagation(); onConfirm(s) }}
                disabled={isPending}
                className="text-2xs bg-forest-50 text-forest-700 px-2.5 py-1 rounded-lg hover:bg-forest-100 transition-colors"
              >
                Mark ✓
              </button>
            </>
          )}
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            className={`text-navy-800/20 transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>

      {/* Expanded: recent events + confirmations */}
      {expanded && (
        <div className="border-t border-navy-800/5 px-4 py-3 bg-navy-800/2 space-y-2">
          {/* Confirmation requests */}
          {myConfs.length > 0 && (
            <div>
              <div className="data-label mb-1.5">Confirmations</div>
              {myConfs.slice(0, 4).map(c => (
                <div key={c.id} className={`flex items-start gap-2 py-1.5 text-xs border-b border-navy-800/5 last:border-0
                  ${!c.is_resolved && c.response_required_by && new Date(c.response_required_by) < new Date() ? 'text-red-800' : 'text-navy-800/70'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${
                    c.response === 'yes' ? 'bg-forest-600' :
                    c.response === 'no'  ? 'bg-red-500'    :
                    c.is_resolved        ? 'bg-gray-400'   : 'bg-amber-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <span className="capitalize">{c.confirmation_type.replace(/_/g,' ')}</span>
                    {c.response
                      ? <span className={`ml-1.5 font-medium ${c.response === 'yes' ? 'text-forest-700' : 'text-red-600'}`}>
                          — {c.response === 'yes' ? 'Confirmed' : c.response}
                        </span>
                      : <span className="ml-1.5 text-navy-800/40">— Awaiting</span>
                    }
                    <div className="text-2xs text-navy-800/35">{fmtTime(c.sent_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent messages */}
          {s.recentEvents.length > 0 && (
            <div>
              <div className="data-label mb-1.5">Recent messages</div>
              {s.recentEvents.slice(0, 3).map(ev => (
                <div key={ev.id} className="flex gap-2 py-1">
                  <div className={`w-1 flex-shrink-0 rounded-full mt-1 self-stretch ${
                    ev.direction === 'outbound' ? 'bg-navy-800/20' : 'bg-blue-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-2xs text-navy-800/40 mb-0.5">
                      {ev.direction === 'inbound' ? `${s.name} replied` : 'You sent'} · {fmtTime(ev.created_at)}
                    </div>
                    <p className="text-xs text-navy-800/60 line-clamp-2 leading-relaxed">{ev.message_text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {s.recentEvents.length === 0 && myConfs.length === 0 && (
            <p className="text-xs text-navy-800/35">No messages sent yet</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Journey stage view ─────────────────────────────────────────────────────
function JourneyView({
  stages, currentStage, stakeholders, confirmations, selectedStage, onStageSelect,
}: {
  stages: typeof STAGES
  currentStage: Stage
  stakeholders: Stakeholder[]
  confirmations: Confirmation[]
  selectedStage: Stage
  onStageSelect: (s: Stage) => void
}) {
  const stageStakeholders = stakeholders.filter(s =>
    getStakeholderStages(s).includes(selectedStage)
  )
  const stageConfs = confirmations.filter(c =>
    CONF_STAGE_MAP[c.confirmation_type] === selectedStage
  )
  const pendingStageConfs = stageConfs.filter(c => !c.is_resolved)
  const nonResponsiveInStage = stageStakeholders.filter(s => s.status === 'non_responsive')
  const confirmedInStage    = stageStakeholders.filter(s => s.status === 'confirmed')

  return (
    <div className="space-y-4">
      {/* Stage progress bar */}
      <div className="card-clinical p-3">
        <div className="flex items-stretch gap-0">
          {stages.map((stage, idx) => {
            const isCurrent  = stage.key === currentStage
            const isPast     = stages.indexOf(stages.find(s => s.key === currentStage)!) > idx
            const isSelected = stage.key === selectedStage

            return (
              <button
                key={stage.key}
                onClick={() => onStageSelect(stage.key)}
                className="flex-1 flex flex-col items-center gap-1 group"
              >
                {/* Connector line + dot */}
                <div className="flex items-center w-full">
                  <div className={`flex-1 h-0.5 ${idx === 0 ? 'opacity-0' : isPast || isCurrent ? 'bg-navy-800/30' : 'bg-navy-800/10'}`} />
                  <div className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 transition-all ${
                    isCurrent   ? 'border-navy-800 bg-navy-800 scale-125' :
                    isPast      ? 'border-forest-600 bg-forest-600' :
                    isSelected  ? 'border-navy-800 bg-white scale-110' :
                    'border-navy-800/20 bg-white group-hover:border-navy-800/50'
                  }`} />
                  <div className={`flex-1 h-0.5 ${
                    stages.indexOf(stages.find(s => s.key === currentStage)!) > idx + 1 || isCurrent
                      ? 'bg-navy-800/30' : 'bg-navy-800/10'
                  }`} />
                </div>
                <span className={`text-2xs text-center leading-tight transition-colors ${
                  isCurrent  ? 'text-navy-800 font-semibold' :
                  isSelected ? 'text-navy-800 font-medium' :
                  isPast     ? 'text-forest-700' :
                  'text-navy-800/35'
                }`}>
                  {stage.short}
                </span>
              </button>
            )
          })}
        </div>
        {/* Selected stage label */}
        <div className="text-center mt-2">
          <span className="text-xs font-medium text-navy-800">
            {stages.find(s => s.key === selectedStage)?.label || ''}
          </span>
          {selectedStage === currentStage && (
            <span className="ml-1.5 text-2xs text-navy-800/40">← current</span>
          )}
        </div>
      </div>

      {/* Stage summary */}
      {stageStakeholders.length > 0 ? (
        <div className="space-y-2">
          {/* Stage health */}
          {(nonResponsiveInStage.length > 0 || pendingStageConfs.length > 0) && (
            <div className={`rounded-2xl px-4 py-3 ${
              nonResponsiveInStage.length > 0 ? 'bg-red-50 border border-red-200/60' : 'bg-amber-50 border border-amber-200/60'
            }`}>
              {nonResponsiveInStage.length > 0 && (
                <p className="text-sm font-medium text-red-900">
                  ⚠ {nonResponsiveInStage.map(s => s.name).join(', ')} — no response. Chase up.
                </p>
              )}
              {pendingStageConfs.length > 0 && nonResponsiveInStage.length === 0 && (
                <p className="text-sm font-medium text-amber-900">
                  {pendingStageConfs.length} confirmation{pendingStageConfs.length > 1 ? 's' : ''} awaiting response at this stage.
                </p>
              )}
            </div>
          )}
          {nonResponsiveInStage.length === 0 && pendingStageConfs.length === 0 && confirmedInStage.length === stageStakeholders.length && (
            <div className="rounded-2xl px-4 py-3 bg-forest-50 border border-forest-200/40">
              <p className="text-sm font-medium text-forest-800">✓ All stakeholders confirmed at this stage</p>
            </div>
          )}

          {/* Stakeholders at this stage */}
          <div className="data-label px-1">
            {stageStakeholders.length} stakeholder{stageStakeholders.length > 1 ? 's' : ''} active at this stage
          </div>
          {stageStakeholders.map(s => {
            const role = ROLE_CONFIG[s.role] || ROLE_CONFIG.other_clinician
            const myConfs = confirmations.filter(c => c.stakeholder_id === s.id && CONF_STAGE_MAP[c.confirmation_type] === selectedStage)

            return (
              <div key={s.id} className="card-clinical">
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${STATUS_DOT[s.status] || 'bg-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-navy-800">{s.name}</span>
                      <span className={`text-2xs px-1.5 py-0.5 rounded-full ${role.bg} ${role.color}`}>
                        {role.icon} {role.label}
                      </span>
                    </div>
                    <div className={`text-xs mt-0.5 font-medium ${
                      s.status === 'confirmed'      ? 'text-forest-700' :
                      s.status === 'non_responsive' ? 'text-red-600' :
                      s.status === 'declined'       ? 'text-red-500' :
                      'text-navy-800/40'
                    }`}>
                      {STATUS_LABEL[s.status]}
                      {s.confirmed_at && s.status === 'confirmed' && (
                        <span className="font-normal text-navy-800/30 ml-1">— {fmtTime(s.confirmed_at)}</span>
                      )}
                    </div>

                    {/* Stage-specific confirmations */}
                    {myConfs.map(c => (
                      <div key={c.id} className="text-xs mt-1 text-navy-800/50">
                        <span className="capitalize">{c.confirmation_type.replace(/_/g,' ')}: </span>
                        {c.response === 'yes'
                          ? <span className="text-forest-700 font-medium">✓ Confirmed</span>
                          : c.response === 'no'
                          ? <span className="text-red-600 font-medium">✗ Declined</span>
                          : c.responded_at ? <span className="text-amber-600">{c.response}</span>
                          : <span className="text-amber-600">Awaiting response</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="card-clinical text-center py-6">
          <p className="text-sm text-navy-800/40">No stakeholders assigned to this stage</p>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function CommsJourneyClient({
  plan, specialist, stakeholders, confirmations, escalations, milestones,
}: {
  plan: Plan; specialist: any
  stakeholders: Stakeholder[]; confirmations: Confirmation[]
  escalations: Escalation[]; milestones: Milestone[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [activeTab, setActiveTab] = useState<'journey' | 'stakeholders' | 'confirmations' | 'escalations' | 'milestones'>('journey')
  const [selectedStage, setSelectedStage] = useState<Stage>(getCurrentStage(plan.scheduled_date))
  const [showAddStakeholder, setShowAddStakeholder] = useState(false)
  const [showMilestone, setShowMilestone] = useState(false)
  const [newStakeholder, setNewStakeholder] = useState({ role: 'anaesthesiologist', name: '', mobile: '', designation: '' })
  const [milestoneForm, setMilestoneForm] = useState({ preset: '', notes: '', notifyPatient: true, notifyReferrer: false })

  const currentStage = getCurrentStage(plan.scheduled_date)
  const days = daysUntil(plan.scheduled_date)

  // Analytics
  const totalStakeholders   = stakeholders.length
  const confirmedCount      = stakeholders.filter(s => s.status === 'confirmed').length
  const nonResponsiveCount  = stakeholders.filter(s => s.status === 'non_responsive').length
  const pendingConfs        = confirmations.filter(c => !c.is_resolved).length
  const overdueConfs        = confirmations.filter(c =>
    !c.is_resolved && c.response_required_by && new Date(c.response_required_by) < new Date()
  ).length
  const unresolvedEscalations = escalations.filter(e => !e.resolved).length

  function handleSend(s: Stakeholder) {
    startTransition(async () => {
      const r = await broadcastAction(plan.id, 'procedure_scheduled', [s.role])
      if (!r.ok) toast.error(r.error)
      else { toast.success(`Message sent to ${s.name}`); router.refresh() }
    })
  }

  function handleMarkConfirmed(s: Stakeholder) {
    startTransition(async () => {
      const r = await updateStakeholderAction(s.id, { status: 'confirmed', confirmed_at: new Date().toISOString() })
      if (!r.ok) toast.error(r.error)
      else { toast.success(`${s.name} marked as confirmed`); router.refresh() }
    })
  }

  function handleAddStakeholder(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const r = await addStakeholderAction(plan.id, newStakeholder.role, newStakeholder.name, newStakeholder.mobile, newStakeholder.designation || undefined)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success('Stakeholder added')
        setShowAddStakeholder(false)
        setNewStakeholder({ role: 'anaesthesiologist', name: '', mobile: '', designation: '' })
        router.refresh()
      }
    })
  }

  function handleMilestone(e: React.FormEvent) {
    e.preventDefault()
    const preset = MILESTONE_PRESETS.find(p => p.name === milestoneForm.preset)
    if (!preset) return
    startTransition(async () => {
      const r = await recordMilestoneAction(plan.id, preset.name, preset.label, preset.order, {
        clinicalNotes: milestoneForm.notes || undefined,
        notifyPatient: milestoneForm.notifyPatient,
        notifyReferrer: milestoneForm.notifyReferrer,
      })
      if (!r.ok) toast.error(r.error)
      else { toast.success(`Milestone recorded: ${preset.label}`); setShowMilestone(false); router.refresh() }
    })
  }

  const tabs = [
    { key: 'journey',       label: 'Journey' },
    { key: 'stakeholders',  label: `Stakeholders (${confirmedCount}/${totalStakeholders})` },
    { key: 'confirmations', label: `Confirmations${pendingConfs > 0 ? ` (${pendingConfs})` : ''}` },
    { key: 'escalations',   label: `Escalations${unresolvedEscalations > 0 ? ` ⚠${unresolvedEscalations}` : ''}` },
    { key: 'milestones',    label: 'Milestones' },
  ] as const

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Non-sticky inner nav */}
      <div className="bg-white border-b border-navy-800/8">
        <div className="px-5 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/communication')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <div className="flex-1 min-w-0">
            <div className="font-sans font-medium text-navy-800 truncate">{plan.procedure_name}</div>
            <div className="text-2xs text-navy-800/40 truncate">
              {plan.patient_name}
              {plan.scheduled_date && ` · ${new Date(plan.scheduled_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
              {days !== null && ` · ${days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days < 0 ? `${Math.abs(days)}d ago` : `In ${days}d`}`}
            </div>
          </div>
          <button
            onClick={() => setShowMilestone(true)}
            className="text-xs font-medium bg-navy-800 text-white px-3 py-2 rounded-xl hover:bg-navy-900 active:scale-95 transition-all flex-shrink-0"
          >
            + Milestone
          </button>
        </div>
      </div>

      <main className="px-5 py-4 space-y-4">

        {/* Analytics strip */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Confirmed',   value: `${confirmedCount}/${totalStakeholders}`, color: confirmedCount === totalStakeholders && totalStakeholders > 0 ? 'text-forest-700' : 'text-navy-800' },
            { label: 'No response', value: nonResponsiveCount,  color: nonResponsiveCount > 0  ? 'text-red-600'   : 'text-navy-800/30' },
            { label: 'Overdue',     value: overdueConfs,        color: overdueConfs > 0        ? 'text-red-600'   : 'text-navy-800/30' },
            { label: 'Escalations', value: unresolvedEscalations,color: unresolvedEscalations > 0? 'text-red-600'  : 'text-navy-800/30' },
          ].map(s => (
            <div key={s.label} className="card-clinical text-center p-2.5">
              <div className={`font-display text-xl font-medium ${s.color}`}>{s.value}</div>
              <div className="data-label leading-tight mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Urgent alert */}
        {(unresolvedEscalations > 0 || nonResponsiveCount > 0 || overdueConfs > 0) && (
          <div className="bg-red-50 border border-red-200/60 rounded-2xl p-4">
            <div className="data-label text-red-600/70 mb-1">Action required</div>
            <div className="space-y-1">
              {unresolvedEscalations > 0 && (
                <p className="text-sm font-medium text-red-900">
                  ⚠ {unresolvedEscalations} unresolved escalation{unresolvedEscalations > 1 ? 's' : ''} — review immediately
                </p>
              )}
              {nonResponsiveCount > 0 && (
                <p className="text-sm font-medium text-red-900">
                  {stakeholders.filter(s => s.status === 'non_responsive').map(s => s.name).join(', ')} — no response to communications
                </p>
              )}
              {overdueConfs > 0 && nonResponsiveCount === 0 && (
                <p className="text-sm font-medium text-red-900">
                  {overdueConfs} confirmation{overdueConfs > 1 ? 's' : ''} overdue — resend or override
                </p>
              )}
            </div>
          </div>
        )}

        {/* Tab navigation */}
        <div className="flex gap-0 overflow-x-auto bg-white rounded-xl border border-navy-800/8">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex-shrink-0 px-3 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors
                ${activeTab === t.key
                  ? 'text-navy-800 border-navy-800'
                  : 'text-navy-800/40 border-transparent hover:text-navy-800/70'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── JOURNEY TAB ───────────────────────────────────────────────────── */}
        {activeTab === 'journey' && (
          <JourneyView
            stages={STAGES}
            currentStage={currentStage}
            stakeholders={stakeholders}
            confirmations={confirmations}
            selectedStage={selectedStage}
            onStageSelect={setSelectedStage}
          />
        )}

        {/* ── STAKEHOLDERS TAB ──────────────────────────────────────────────── */}
        {activeTab === 'stakeholders' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-navy-800/50">
                {confirmedCount}/{totalStakeholders} confirmed
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => startTransition(async () => {
                    const r = await populateStakeholdersAction(plan.id)
                    if (!r.ok) toast.error(r.error)
                    else { toast.success(`${(r.value as any).count} stakeholders added`); router.refresh() }
                  })}
                  disabled={isPending}
                  className="text-xs text-navy-800/60 hover:text-navy-800 transition-colors"
                >
                  Auto-populate
                </button>
                <button
                  onClick={() => setShowAddStakeholder(true)}
                  className="text-xs font-medium text-forest-700 hover:text-forest-800"
                >
                  + Add
                </button>
              </div>
            </div>

            {stakeholders.length === 0 ? (
              <div className="card-clinical text-center py-8">
                <p className="text-sm text-navy-800/50 mb-3">No stakeholders added yet</p>
                <button
                  onClick={() => startTransition(async () => {
                    await populateStakeholdersAction(plan.id); router.refresh()
                  })}
                  className="btn-primary text-sm py-2 px-5"
                >
                  Auto-populate from procedure
                </button>
              </div>
            ) : (
              stakeholders.map(s => (
                <StakeholderCard
                  key={s.id}
                  s={s}
                  confirmations={confirmations}
                  onSend={handleSend}
                  onConfirm={handleMarkConfirmed}
                  isPending={isPending}
                />
              ))
            )}

            {/* Broadcast all button */}
            {stakeholders.length > 0 && (
              <button
                onClick={() => startTransition(async () => {
                  const r = await broadcastAction(plan.id, 'procedure_scheduled', undefined, undefined)
                  if (!r.ok) toast.error(r.error)
                  else { toast.success('Broadcast sent to all stakeholders'); router.refresh() }
                })}
                disabled={isPending}
                className="w-full text-xs text-center text-navy-800/40 hover:text-navy-800/60 transition-colors py-2"
              >
                Broadcast to all stakeholders →
              </button>
            )}
          </div>
        )}

        {/* ── CONFIRMATIONS TAB ─────────────────────────────────────────────── */}
        {activeTab === 'confirmations' && (
          <div className="space-y-2">
            {confirmations.length === 0 ? (
              <div className="card-clinical text-center py-8">
                <p className="text-sm text-navy-800/50">No confirmation requests sent yet</p>
              </div>
            ) : (
              <>
                {/* Group: overdue first */}
                {confirmations.filter(c => !c.is_resolved && c.response_required_by && new Date(c.response_required_by) < new Date()).length > 0 && (
                  <div className="data-label text-red-600 px-1">Overdue</div>
                )}
                {confirmations.map(c => {
                  const s = stakeholders.find(st => st.id === c.stakeholder_id)
                  const isOverdue = !c.is_resolved && c.response_required_by && new Date(c.response_required_by) < new Date()
                  const roleCfg = ROLE_CONFIG[s?.role || 'other_clinician'] || ROLE_CONFIG.other_clinician

                  return (
                    <div key={c.id} className={`card-clinical ${isOverdue ? 'border-red-200/60 bg-red-50/20' : c.is_resolved ? 'opacity-60' : ''}`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                          c.response === 'yes' ? 'bg-forest-600' :
                          c.response === 'no'  ? 'bg-red-500' :
                          isOverdue            ? 'bg-red-400 animate-pulse' : 'bg-amber-400'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-xs font-medium text-navy-800">{s?.name || 'Unknown'}</span>
                            <span className={`text-2xs px-1.5 py-0.5 rounded-full ${roleCfg.bg} ${roleCfg.color}`}>
                              {roleCfg.label}
                            </span>
                            <span className="text-2xs text-navy-800/40 capitalize">
                              {c.confirmation_type.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <p className="text-xs text-navy-800/60 mb-1">{c.question_text}</p>
                          {c.response ? (
                            <p className={`text-xs font-medium capitalize ${
                              c.response === 'yes' ? 'text-forest-700' : 'text-red-600'
                            }`}>
                              {c.response === 'yes' ? '✓ Confirmed' : `✗ ${c.response}`}
                              {c.responded_at && <span className="text-navy-800/30 font-normal ml-1">— {fmtTime(c.responded_at)}</span>}
                            </p>
                          ) : isOverdue ? (
                            <p className="text-xs text-red-600 font-medium">
                              ⚠ Overdue since {fmtTime(c.response_required_by)}
                            </p>
                          ) : (
                            <p className="text-xs text-amber-600">Sent {fmtTime(c.sent_at)} — awaiting response</p>
                          )}
                        </div>
                        {!c.is_resolved && (
                          <button
                            onClick={() => startTransition(async () => {
                              await overrideConfirmationAction(c.id, 'yes', 'Manually confirmed')
                              router.refresh()
                            })}
                            disabled={isPending}
                            className="text-2xs bg-forest-50 text-forest-700 px-2 py-1 rounded-lg hover:bg-forest-100 flex-shrink-0"
                          >
                            Override ✓
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}

        {/* ── ESCALATIONS TAB ───────────────────────────────────────────────── */}
        {activeTab === 'escalations' && (
          <div className="space-y-2">
            {escalations.length === 0 ? (
              <div className="card-clinical text-center py-8">
                <div className="text-forest-600 text-2xl mb-2">✓</div>
                <p className="text-sm text-navy-800/50">No escalations — communications on track</p>
              </div>
            ) : (
              escalations.map(esc => (
                <div key={esc.id} className={`card-clinical ${!esc.resolved ? 'border-red-200/60 bg-red-50/20' : 'opacity-70'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${esc.resolved ? 'bg-forest-600' : 'bg-red-500'}`} />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-navy-800 mb-0.5 capitalize">
                        {esc.trigger_event.replace(/_/g, ' ')}
                      </div>
                      {esc.description && (
                        <p className="text-xs text-navy-800/60 mb-1">{esc.description}</p>
                      )}
                      <div className="text-2xs text-navy-800/35">{fmtTime(esc.created_at)}</div>
                      {esc.resolved && esc.resolution_notes && (
                        <p className="text-xs text-forest-700 mt-1">Resolved: {esc.resolution_notes}</p>
                      )}
                    </div>
                    {!esc.resolved && (
                      <button
                        onClick={() => startTransition(async () => {
                          const r = await resolveEscalationAction(esc.id, 'Resolved by specialist')
                          if (!r.ok) toast.error(r.error)
                          else { toast.success('Escalation resolved'); router.refresh() }
                        })}
                        disabled={isPending}
                        className="text-2xs bg-navy-800 text-white px-2.5 py-1 rounded-lg hover:bg-navy-900 flex-shrink-0"
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── MILESTONES TAB ────────────────────────────────────────────────── */}
        {activeTab === 'milestones' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-navy-800/50">Post-procedure journey</span>
              <button onClick={() => setShowMilestone(true)}
                className="text-xs font-medium text-forest-700 hover:text-forest-800">
                + Record milestone
              </button>
            </div>

            {milestones.length === 0 ? (
              <div className="card-clinical text-center py-8">
                <p className="text-sm text-navy-800/50 mb-3">No milestones recorded yet</p>
                <p className="text-xs text-navy-800/30 max-w-xs mx-auto leading-relaxed">
                  Record milestones (procedure completed, ICU transfer, discharge) to automatically notify patient and referring doctor.
                </p>
              </div>
            ) : (
              milestones.map(m => (
                <div key={m.id} className={`card-clinical ${m.status === 'reached' ? 'border-forest-200/40' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      m.status === 'reached' ? 'bg-forest-600' :
                      m.status === 'delayed' ? 'bg-amber-500' :
                      m.status === 'skipped' ? 'bg-gray-400' :
                      'bg-gray-300'
                    }`} />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-navy-800">{m.milestone_label}</div>
                      {m.reached_at && (
                        <div className="text-xs text-navy-800/40">{fmtTime(m.reached_at)}</div>
                      )}
                      {m.clinical_notes && (
                        <p className="text-xs text-navy-800/60 mt-0.5">{m.clinical_notes}</p>
                      )}
                      <div className="flex gap-2 mt-0.5">
                        {m.notify_patient && <span className="text-2xs text-navy-800/30">Patient notified</span>}
                        {m.notify_referring_doctor && <span className="text-2xs text-navy-800/30">Referrer notified</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

      </main>

      {/* ── Add stakeholder modal ──────────────────────────────────────────── */}
      {showAddStakeholder && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-end sm:items-center justify-center px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-1">Add stakeholder</h2>
            <p className="text-sm text-navy-800/50 mb-4">Add a person who must be kept aligned for this procedure</p>
            <form onSubmit={handleAddStakeholder} className="space-y-3">
              <div>
                <label className="data-label block mb-1.5">Role</label>
                <select value={newStakeholder.role}
                  onChange={e => setNewStakeholder(p => ({ ...p, role: e.target.value }))}
                  className="input-clinical">
                  {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
                    <option key={key} value={key}>{cfg.icon} {cfg.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="data-label block mb-1.5">Name</label>
                <input type="text" value={newStakeholder.name}
                  onChange={e => setNewStakeholder(p => ({ ...p, name: e.target.value }))}
                  placeholder="Dr. Suresh / Sister Anita" className="input-clinical" autoFocus required />
              </div>
              <div>
                <label className="data-label block mb-1.5">WhatsApp number (optional)</label>
                <input type="tel" value={newStakeholder.mobile}
                  onChange={e => setNewStakeholder(p => ({ ...p, mobile: e.target.value }))}
                  placeholder="9876543210" className="input-clinical" />
              </div>
              <div>
                <label className="data-label block mb-1.5">Designation (optional)</label>
                <input type="text" value={newStakeholder.designation}
                  onChange={e => setNewStakeholder(p => ({ ...p, designation: e.target.value }))}
                  placeholder="Cardiac Anaesthesiologist, Apollo" className="input-clinical" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={isPending || !newStakeholder.name.trim()}
                  className="btn-primary flex-1">{isPending ? 'Adding...' : 'Add stakeholder'}</button>
                <button type="button" onClick={() => setShowAddStakeholder(false)}
                  className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Record milestone modal ─────────────────────────────────────────── */}
      {showMilestone && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-end sm:items-center justify-center px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-1">Record milestone</h2>
            <p className="text-sm text-navy-800/50 mb-4">Notifies patient and/or referring doctor automatically via WhatsApp</p>
            <form onSubmit={handleMilestone} className="space-y-3">
              <div>
                <label className="data-label block mb-1.5">Milestone</label>
                <select value={milestoneForm.preset}
                  onChange={e => setMilestoneForm(p => ({ ...p, preset: e.target.value }))}
                  className="input-clinical" required>
                  <option value="">Select milestone...</option>
                  {MILESTONE_PRESETS.map(m => (
                    <option key={m.name} value={m.name}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="data-label block mb-1.5">Clinical notes (optional)</label>
                <textarea value={milestoneForm.notes}
                  onChange={e => setMilestoneForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Procedure went well. Patient stable in recovery room."
                  className="input-clinical" rows={2} />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={milestoneForm.notifyPatient}
                    onChange={e => setMilestoneForm(p => ({ ...p, notifyPatient: e.target.checked }))}
                    className="rounded" />
                  <span className="text-xs text-navy-800/70">Notify patient</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={milestoneForm.notifyReferrer}
                    onChange={e => setMilestoneForm(p => ({ ...p, notifyReferrer: e.target.checked }))}
                    className="rounded" />
                  <span className="text-xs text-navy-800/70">Notify referring doctor</span>
                </label>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={isPending || !milestoneForm.preset}
                  className="btn-primary flex-1">{isPending ? 'Recording...' : 'Record milestone'}</button>
                <button type="button" onClick={() => setShowMilestone(false)}
                  className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
