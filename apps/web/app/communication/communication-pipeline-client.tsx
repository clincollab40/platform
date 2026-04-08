'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

// ── Types ──────────────────────────────────────────────────────────────────
type PipelinePlan = {
  plan_id: string
  patient_name: string
  procedure_name: string
  urgency: string
  plan_status: string
  scheduled_date: string | null
  scheduled_time: string | null
  consent_status: string
  workup_complete: boolean
  total_stakeholders: number
  confirmed_count: number
  pending_count: number
  notified_count: number
  non_responsive_count: number
  declined_count: number
  pending_confirmations: number
  overdue_confirmations: number
  unresolved_escalations: number
  total_unread: number
  schedule_bucket: string
  days_until_procedure: number | null
  comms_health: 'critical' | 'warning' | 'attention' | 'ready' | 'draft'
}

type Buckets = {
  today: PipelinePlan[]
  tomorrow: PipelinePlan[]
  thisWeek: PipelinePlan[]
  upcoming: PipelinePlan[]
  unscheduled: PipelinePlan[]
}

// ── Config ─────────────────────────────────────────────────────────────────
const HEALTH_CONFIG: Record<string, { dot: string; badge: string; badgeText: string; label: string }> = {
  critical:  { dot: 'bg-red-500 animate-pulse', badge: 'bg-red-50 border-red-200/60',   badgeText: 'text-red-700',   label: '🔴 Action needed' },
  warning:   { dot: 'bg-amber-500',             badge: 'bg-amber-50 border-amber-200/60', badgeText: 'text-amber-700', label: '⚡ Pending' },
  attention: { dot: 'bg-blue-400',              badge: 'bg-blue-50 border-blue-200/60',  badgeText: 'text-blue-700',  label: '● In progress' },
  ready:     { dot: 'bg-forest-600',            badge: 'bg-forest-50 border-forest-200/60', badgeText: 'text-forest-700', label: '✓ Ready' },
  draft:     { dot: 'bg-gray-300',              badge: 'bg-gray-50 border-gray-200/60',  badgeText: 'text-gray-500',  label: '○ Not started' },
}

const URGENCY_DOT: Record<string, string> = {
  routine:   'bg-gray-400',
  urgent:    'bg-amber-500',
  emergency: 'bg-red-500',
}

function fmtDate(d: string | null): string {
  if (!d) return 'Unscheduled'
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

function daysLabel(days: number | null): string {
  if (days === null) return ''
  if (days === 0)    return 'Today'
  if (days === 1)    return 'Tomorrow'
  if (days < 0)      return `${Math.abs(days)}d ago`
  return `In ${days}d`
}

// ── Stakeholder progress dots ──────────────────────────────────────────────
function StakeholderDots({ plan }: { plan: PipelinePlan }) {
  if (plan.total_stakeholders === 0) {
    return <span className="text-2xs text-navy-800/30">No stakeholders</span>
  }
  const dots = []
  for (let i = 0; i < Math.min(plan.confirmed_count, 8); i++)
    dots.push(<span key={`c${i}`} className="w-2 h-2 rounded-full bg-forest-600 flex-shrink-0" />)
  for (let i = 0; i < Math.min(plan.notified_count, 8 - dots.length); i++)
    dots.push(<span key={`n${i}`} className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />)
  for (let i = 0; i < Math.min(plan.non_responsive_count, 8 - dots.length); i++)
    dots.push(<span key={`r${i}`} className="w-2 h-2 rounded-full bg-red-400 animate-pulse flex-shrink-0" />)
  for (let i = 0; i < Math.min(plan.pending_count, 8 - dots.length); i++)
    dots.push(<span key={`p${i}`} className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />)

  return (
    <div className="flex items-center gap-1">
      {dots}
      <span className="text-2xs text-navy-800/40 ml-0.5">
        {plan.confirmed_count}/{plan.total_stakeholders}
      </span>
    </div>
  )
}

// ── Plan card ──────────────────────────────────────────────────────────────
function PlanCard({ plan, onClick }: { plan: PipelinePlan; onClick: () => void }) {
  const health = HEALTH_CONFIG[plan.comms_health] || HEALTH_CONFIG.draft
  const hasAlerts = plan.non_responsive_count > 0 || plan.overdue_confirmations > 0 || plan.unresolved_escalations > 0

  return (
    <button
      onClick={onClick}
      className={`w-full text-left card-clinical border p-0 overflow-hidden hover:shadow-md transition-all active:scale-[0.99]
        ${plan.comms_health === 'critical' ? 'border-red-200/60' : 'border-navy-800/8'}`}
    >
      {/* Top strip: urgency color */}
      <div className={`h-0.5 w-full ${
        plan.urgency === 'emergency' ? 'bg-red-500' :
        plan.urgency === 'urgent'    ? 'bg-amber-500' :
        'bg-navy-800/10'
      }`} />

      <div className="px-4 py-3">
        {/* Row 1: procedure + patient */}
        <div className="flex items-start gap-2 mb-1.5">
          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${health.dot}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-navy-800 truncate">{plan.procedure_name}</span>
              <span className="text-xs text-navy-800/50 truncate">{plan.patient_name}</span>
            </div>

            {/* Row 2: date + days label */}
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-navy-800/60">
                {fmtDate(plan.scheduled_date)}
              </span>
              {plan.days_until_procedure !== null && (
                <span className={`text-2xs font-medium px-1.5 py-0.5 rounded-full ${
                  plan.days_until_procedure === 0  ? 'bg-red-50 text-red-700' :
                  plan.days_until_procedure === 1  ? 'bg-amber-50 text-amber-700' :
                  plan.days_until_procedure <= 3   ? 'bg-amber-50 text-amber-700' :
                  'bg-navy-800/5 text-navy-800/50'
                }`}>
                  {daysLabel(plan.days_until_procedure)}
                </span>
              )}
            </div>
          </div>

          {/* Right: comms health badge */}
          <span className={`text-2xs px-2 py-0.5 rounded-full font-medium border flex-shrink-0 ${health.badge} ${health.badgeText}`}>
            {health.label}
          </span>
        </div>

        {/* Row 3: stakeholder progress */}
        <div className="ml-4 mb-2">
          <StakeholderDots plan={plan} />
        </div>

        {/* Row 4: alert chips */}
        {(hasAlerts || plan.pending_confirmations > 0 || plan.total_unread > 0) && (
          <div className="ml-4 flex gap-1.5 flex-wrap">
            {plan.non_responsive_count > 0 && (
              <span className="text-2xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">
                {plan.non_responsive_count} no response
              </span>
            )}
            {plan.overdue_confirmations > 0 && (
              <span className="text-2xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">
                {plan.overdue_confirmations} overdue
              </span>
            )}
            {plan.unresolved_escalations > 0 && (
              <span className="text-2xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">
                ⚠ {plan.unresolved_escalations} escalation{plan.unresolved_escalations > 1 ? 's' : ''}
              </span>
            )}
            {plan.pending_confirmations > 0 && plan.overdue_confirmations === 0 && (
              <span className="text-2xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
                {plan.pending_confirmations} awaiting reply
              </span>
            )}
            {plan.total_unread > 0 && (
              <span className="text-2xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                {plan.total_unread} unread
              </span>
            )}
          </div>
        )}

        {/* Row 5: checklist flags */}
        {(!plan.workup_complete || plan.consent_status !== 'signed') && plan.comms_health !== 'draft' && (
          <div className="ml-4 flex gap-1.5 mt-1.5">
            {!plan.workup_complete && (
              <span className="text-2xs text-navy-800/35">Workup pending</span>
            )}
            {plan.consent_status !== 'signed' && (
              <span className="text-2xs text-navy-800/35">Consent pending</span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}

// ── Bucket section ─────────────────────────────────────────────────────────
function BucketSection({
  title, plans, accent, onPlanClick,
}: {
  title: string; plans: PipelinePlan[]; accent: string; onPlanClick: (id: string) => void
}) {
  if (plans.length === 0) return null
  return (
    <div>
      <div className={`flex items-center gap-2 mb-2`}>
        <div className={`text-xs font-semibold ${accent}`}>{title}</div>
        <div className="flex-1 h-px bg-navy-800/8" />
        <span className="text-2xs text-navy-800/40">{plans.length}</span>
      </div>
      <div className="space-y-2">
        {plans.map(p => (
          <PlanCard key={p.plan_id} plan={p} onClick={() => onPlanClick(p.plan_id)} />
        ))}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function CommunicationPipelineClient({
  specialist, plans, analytics, buckets,
}: {
  specialist: { id: string; name: string; specialty: string }
  plans: PipelinePlan[]
  analytics: {
    total: number; today: number; thisWeek: number; critical: number
    pendingConfs: number; escalations: number; nonResponsive: number; unread: number
  }
  buckets: Buckets
}) {
  const router = useRouter()
  const [filterHealth, setFilterHealth] = useState<string>('all')

  // Apply health filter across all buckets
  function filtered(list: PipelinePlan[]) {
    if (filterHealth === 'all') return list
    return list.filter(p => p.comms_health === filterHealth)
  }

  const allBucketPlans = [
    ...buckets.today,
    ...buckets.tomorrow,
    ...buckets.thisWeek,
    ...buckets.upcoming,
    ...buckets.unscheduled,
  ]

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Non-sticky inner nav */}
      <div className="bg-white border-b border-navy-800/8">
        <div className="px-5 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1">Procedure communications</span>
          <button
            onClick={() => router.push('/procedures')}
            className="text-xs font-medium text-navy-800/60 hover:text-navy-800 transition-colors"
          >
            Procedure planner
          </button>
        </div>
      </div>

      <main className="px-5 py-5 space-y-4">

        {/* Analytics strip */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'In pipeline',  value: analytics.total,       color: 'text-navy-800' },
            { label: 'Today',        value: analytics.today,       color: analytics.today > 0 ? 'text-red-600' : 'text-navy-800/40' },
            { label: 'Pending confs',value: analytics.pendingConfs,color: analytics.pendingConfs > 0 ? 'text-amber-600' : 'text-navy-800/40' },
            { label: 'Escalations',  value: analytics.escalations, color: analytics.escalations > 0 ? 'text-red-600' : 'text-navy-800/40' },
          ].map(s => (
            <div key={s.label} className="card-clinical text-center p-2.5">
              <div className={`font-display text-xl font-medium ${s.color}`}>{s.value}</div>
              <div className="data-label leading-tight mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Critical alert banner */}
        {analytics.critical > 0 && (
          <div
            className="bg-red-50 border border-red-200/60 rounded-2xl p-4 cursor-pointer"
            onClick={() => setFilterHealth(filterHealth === 'critical' ? 'all' : 'critical')}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="data-label text-red-600/70 mb-1">Urgent attention needed</div>
                <p className="text-sm font-medium text-red-900 leading-relaxed">
                  {analytics.critical} procedure{analytics.critical > 1 ? 's' : ''} with gaps —
                  {analytics.nonResponsive > 0 ? ` ${analytics.nonResponsive} stakeholder${analytics.nonResponsive > 1 ? 's' : ''} not responding,` : ''}
                  {analytics.escalations > 0 ? ` ${analytics.escalations} escalation${analytics.escalations > 1 ? 's' : ''} unresolved` : ''}
                </p>
              </div>
              <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center text-white font-semibold flex-shrink-0 ml-3">
                {analytics.critical}
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-4 overflow-x-auto pb-0.5">
          <span className="text-2xs text-navy-800/40 flex-shrink-0">Stakeholders:</span>
          {[
            { dot: 'bg-forest-600', label: 'Confirmed' },
            { dot: 'bg-amber-400',  label: 'Notified' },
            { dot: 'bg-red-400',    label: 'No response' },
            { dot: 'bg-gray-300',   label: 'Pending' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1 flex-shrink-0">
              <div className={`w-2 h-2 rounded-full ${l.dot}`} />
              <span className="text-2xs text-navy-800/50">{l.label}</span>
            </div>
          ))}
        </div>

        {/* Health filter chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[
            { key: 'all',       label: `All (${plans.length})` },
            { key: 'critical',  label: `🔴 Action needed (${plans.filter(p=>p.comms_health==='critical').length})` },
            { key: 'warning',   label: `⚡ Pending (${plans.filter(p=>p.comms_health==='warning').length})` },
            { key: 'ready',     label: `✓ Ready (${plans.filter(p=>p.comms_health==='ready').length})` },
            { key: 'draft',     label: `○ Not started (${plans.filter(p=>p.comms_health==='draft').length})` },
          ].map(f => (
            <button key={f.key} onClick={() => setFilterHealth(f.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all border
                ${filterHealth === f.key
                  ? 'bg-navy-800 text-white border-navy-800'
                  : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Procedure pipeline — by time bucket */}
        {plans.length === 0 ? (
          <div className="card-clinical text-center py-10">
            <div className="w-12 h-12 bg-navy-800/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-navy-800/40">
                <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="font-display text-xl text-navy-800 mb-2">No procedures in pipeline</h3>
            <p className="text-sm text-navy-800/50 mb-5 max-w-xs mx-auto leading-relaxed">
              Plan a procedure first. Once planned, add stakeholders and begin coordinated communications.
            </p>
            <button onClick={() => router.push('/procedures')} className="btn-primary">
              Go to procedure planner
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <BucketSection
              title="TODAY"
              plans={filtered(buckets.today)}
              accent="text-red-600"
              onPlanClick={id => router.push(`/communication/${id}`)}
            />
            <BucketSection
              title="TOMORROW"
              plans={filtered(buckets.tomorrow)}
              accent="text-amber-600"
              onPlanClick={id => router.push(`/communication/${id}`)}
            />
            <BucketSection
              title="THIS WEEK"
              plans={filtered(buckets.thisWeek)}
              accent="text-navy-800/70"
              onPlanClick={id => router.push(`/communication/${id}`)}
            />
            <BucketSection
              title="UPCOMING"
              plans={filtered(buckets.upcoming)}
              accent="text-navy-800/50"
              onPlanClick={id => router.push(`/communication/${id}`)}
            />
            <BucketSection
              title="UNSCHEDULED"
              plans={filtered(buckets.unscheduled)}
              accent="text-navy-800/35"
              onPlanClick={id => router.push(`/communication/${id}`)}
            />

            {/* Empty state if all filtered out */}
            {filtered(allBucketPlans).length === 0 && plans.length > 0 && (
              <div className="card-clinical text-center py-8">
                <p className="text-sm text-navy-800/50">No procedures match this filter.</p>
                <button onClick={() => setFilterHealth('all')} className="btn-secondary mt-3">
                  Clear filter
                </button>
              </div>
            )}
          </div>
        )}

        {/* Quick guide */}
        {plans.length > 0 && (
          <div className="bg-navy-800/3 rounded-2xl px-4 py-3">
            <p className="text-xs text-navy-800/50 leading-relaxed">
              <span className="font-medium text-navy-800/70">How to use:</span> Each card shows the comms health of a procedure.
              Click any card to open the full stakeholder journey — see who's confirmed, who needs chasing, and send targeted messages.
              Alerts surface automatically when confirmations are overdue or stakeholders stop responding.
            </p>
          </div>
        )}

      </main>
    </div>
  )
}
