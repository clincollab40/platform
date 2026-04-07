'use client'

import { useState, useMemo, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { generateReferralLinkAction } from '@/app/actions/referrals'

// ── Types ─────────────────────────────────────────────────────────────────────
type Case = {
  id: string
  reference_no: string
  patient_name: string
  patient_gender: string | null
  chief_complaint: string
  urgency: string
  status: string
  expected_visit_date: string | null
  submitted_at: string
  accepted_at: string | null
  updated_at: string
  referring_doctors: { name: string | null; specialty: string | null; city: string | null; clinic_name: string | null } | null
  referrers: { name: string | null; specialty: string | null } | null
}

type Analytics = {
  total_cases: number
  accepted_cases: number
  completed_cases: number
  cases_this_month: number
  cases_last_month: number
  avg_hours_to_accept: number | null
  unique_referrers: number
} | null

// ── Status config ──────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  submitted:         { label: 'New',              bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  queried:           { label: 'Queried',          bg: 'bg-purple-50',  text: 'text-purple-700',  dot: 'bg-purple-500' },
  info_provided:     { label: 'Info provided',    bg: 'bg-indigo-50',  text: 'text-indigo-700',  dot: 'bg-indigo-500' },
  accepted:          { label: 'Accepted',         bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  patient_arrived:   { label: 'Patient arrived',  bg: 'bg-teal-50',    text: 'text-teal-700',    dot: 'bg-teal-500' },
  procedure_planned: { label: 'Procedure planned',bg: 'bg-cyan-50',    text: 'text-cyan-700',    dot: 'bg-cyan-500' },
  completed:         { label: 'Completed',        bg: 'bg-green-50',   text: 'text-green-700',   dot: 'bg-green-500' },
  closed:            { label: 'Closed',           bg: 'bg-gray-100',   text: 'text-gray-500',    dot: 'bg-gray-400' },
  declined:          { label: 'Declined',         bg: 'bg-red-50',     text: 'text-red-600',     dot: 'bg-red-500' },
  cancelled:         { label: 'Cancelled',        bg: 'bg-red-50',     text: 'text-red-400',     dot: 'bg-red-400' },
}

const URGENCY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  routine:   { label: 'Routine',   color: 'text-navy-800/40', bg: '' },
  urgent:    { label: 'Urgent',    color: 'text-amber-600',   bg: 'bg-amber-50' },
  emergency: { label: 'Emergency', color: 'text-red-600',     bg: 'bg-red-50' },
}

// ── Filter groups ─────────────────────────────────────────────────────────────
// Action needed: cases where doctor needs to respond or decide
// Active: cases doctor has accepted and is managing
// Completed: terminal states (done, closed, declined, cancelled)
type FilterGroup = 'all' | 'action_needed' | 'active' | 'completed'

const FILTER_GROUPS: Record<FilterGroup, string[]> = {
  all:          [],
  action_needed: ['submitted', 'queried', 'info_provided'],
  active:        ['accepted', 'patient_arrived', 'procedure_planned'],
  completed:     ['completed', 'closed', 'declined', 'cancelled'],
}

// ── Flow explanation ──────────────────────────────────────────────────────────
const FLOW_STEPS = [
  {
    group: 'action_needed',
    label: 'Action needed',
    color: 'text-blue-700',
    bg: 'bg-blue-50/70',
    border: 'border-blue-200/60',
    dot: 'bg-blue-500',
    statuses: ['New referral submitted', 'You queried — awaiting reply', 'Info provided — awaiting your decision'],
    description: 'Cases that are waiting for your response or decision. Every new referral starts here.',
  },
  {
    group: 'active',
    label: 'Active',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50/70',
    border: 'border-emerald-200/60',
    dot: 'bg-emerald-500',
    statuses: ['Accepted', 'Patient arrived at clinic', 'Procedure scheduled/planned'],
    description: 'Cases you have formally accepted. Patient care is in progress.',
  },
  {
    group: 'completed',
    label: 'Completed',
    color: 'text-gray-600',
    bg: 'bg-gray-50',
    border: 'border-gray-200/60',
    dot: 'bg-gray-400',
    statuses: ['Procedure completed', 'Case closed', 'Declined (not suitable)', 'Cancelled by referrer'],
    description: 'Terminal states. Case is closed — either successfully treated, declined, or cancelled.',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysAgo(date: string) {
  const d = Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d}d ago`
}

function getReferrerName(c: Case) {
  return c.referring_doctors?.name || c.referrers?.name || 'Unknown'
}

function getReferrerSpecialty(c: Case) {
  return c.referring_doctors?.specialty || c.referrers?.specialty || ''
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ReferralsClient({
  specialist, cases, analytics, initialStatus, initialQuery,
}: {
  specialist: { id: string; name: string; specialty: string; city: string; role: string; whatsapp_number: string | null }
  cases: Case[]
  analytics: Analytics
  initialStatus: string
  initialQuery: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [filter, setFilter]         = useState<FilterGroup>(initialStatus as FilterGroup || 'all')
  const [query, setQuery]           = useState(initialQuery)
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [generatedLink, setGeneratedLink] = useState('')
  const [showFlow, setShowFlow]     = useState(false)

  // ── Counts ───────────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    all:          cases.length,
    action_needed: cases.filter(c => FILTER_GROUPS.action_needed.includes(c.status)).length,
    active:        cases.filter(c => FILTER_GROUPS.active.includes(c.status)).length,
    completed:     cases.filter(c => FILTER_GROUPS.completed.includes(c.status)).length,
    urgent:        cases.filter(c =>
      (c.urgency === 'urgent' || c.urgency === 'emergency') &&
      FILTER_GROUPS.action_needed.includes(c.status)
    ).length,
  }), [cases])

  // ── Priority queue: urgent/emergency cases still awaiting response ────────
  const priorityQueue = useMemo(() => {
    return cases
      .filter(c =>
        (c.urgency === 'urgent' || c.urgency === 'emergency') &&
        FILTER_GROUPS.action_needed.includes(c.status)
      )
      .sort((a, b) => {
        if (a.urgency === 'emergency' && b.urgency !== 'emergency') return -1
        if (b.urgency === 'emergency' && a.urgency !== 'emergency') return 1
        return new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime()
      })
  }, [cases])

  // ── Displayed list ────────────────────────────────────────────────────────
  const displayed = useMemo(() => {
    let list = [...cases]

    if (filter !== 'all' && FILTER_GROUPS[filter].length > 0) {
      list = list.filter(c => FILTER_GROUPS[filter].includes(c.status))
    }

    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(c =>
        c.patient_name.toLowerCase().includes(q) ||
        c.reference_no.toLowerCase().includes(q) ||
        getReferrerName(c).toLowerCase().includes(q) ||
        c.chief_complaint.toLowerCase().includes(q)
      )
    }

    return list.sort((a, b) => {
      const urgencyOrder = { emergency: 0, urgent: 1, routine: 2 }
      if (a.status === 'submitted' && b.status !== 'submitted') return -1
      if (b.status === 'submitted' && a.status !== 'submitted') return 1
      const uo = (urgencyOrder[a.urgency as keyof typeof urgencyOrder] ?? 2) -
                 (urgencyOrder[b.urgency as keyof typeof urgencyOrder] ?? 2)
      if (uo !== 0) return uo
      return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
    })
  }, [cases, filter, query])

  const monthTrend = analytics
    ? analytics.cases_this_month - analytics.cases_last_month
    : 0

  async function handleGenerateLink() {
    startTransition(async () => {
      const result = await generateReferralLinkAction()
      if (result.error) toast.error(result.error)
      else if (result.url) { setGeneratedLink(result.url); setShowLinkModal(true) }
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-clinical-light">

      {/* ── Page header (non-sticky — AppLayout TopNav handles sticky) ───── */}
      <div className="bg-white border-b border-navy-800/8">
        <div className="px-5 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors flex-shrink-0">
            <ChevronLeft />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-sans font-semibold text-navy-800 text-base leading-tight">Referral cases</h1>
            <p className="text-xs text-navy-800/40">{cases.length} total · {counts.action_needed} need your response</p>
          </div>
          <button
            onClick={handleGenerateLink}
            disabled={isPending}
            className="flex items-center gap-1.5 bg-navy-800 text-white text-xs
                       font-medium px-3 py-2 rounded-xl hover:bg-navy-900
                       active:scale-95 transition-all disabled:opacity-60 flex-shrink-0"
          >
            <PlusIcon /> New referral link
          </button>
        </div>
      </div>

      <main className="px-5 py-5 space-y-4">

        {/* ── Priority alert: urgent/emergency awaiting response ─────────── */}
        {priorityQueue.length > 0 && (
          <div className="bg-red-50 border border-red-200/70 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
              <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">
                Priority — respond now
              </span>
              <span className="ml-auto text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-medium">
                {priorityQueue.length} case{priorityQueue.length > 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-xs text-red-700/60 mb-3">
              These urgent or emergency referrals are in your queue and awaiting your response.
              Tap a case to review and act.
            </p>
            <div className="space-y-1.5">
              {priorityQueue.map(c => (
                <button
                  key={c.id}
                  onClick={() => router.push(`/referrals/${c.id}`)}
                  className="w-full flex items-center gap-3 bg-white rounded-xl px-3 py-2.5
                             hover:bg-red-50 border border-red-100 transition-colors text-left"
                >
                  <div className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                    c.urgency === 'emergency'
                      ? 'bg-red-500 text-white'
                      : 'bg-amber-500 text-white'
                  }`}>
                    {c.urgency === 'emergency' ? 'Emergency' : 'Urgent'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-navy-800 truncate">{c.patient_name}</div>
                    <div className="text-xs text-navy-800/50 truncate">{c.chief_complaint}</div>
                  </div>
                  <div className="text-xs text-navy-800/35 flex-shrink-0 text-right">
                    <div>{daysAgo(c.submitted_at)}</div>
                    <div className="text-2xs">From Dr. {getReferrerName(c).split(' ').slice(-1)[0]}</div>
                  </div>
                  <ChevronRight />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Pipeline stats (clickable to filter) ──────────────────────── */}
        <div className="grid grid-cols-2 gap-3">

          {/* Action needed */}
          <button
            onClick={() => setFilter(filter === 'action_needed' ? 'all' : 'action_needed')}
            className={`rounded-2xl p-4 text-left transition-all border-2 ${
              filter === 'action_needed'
                ? 'border-blue-500 bg-blue-50'
                : 'border-transparent bg-white hover:border-blue-200'
            }`}
          >
            <div className="flex items-start justify-between mb-1">
              <span className="data-label text-blue-700/70">Needs response</span>
              {counts.action_needed > 0 && (
                <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-2xs
                                 font-bold flex items-center justify-center flex-shrink-0">
                  {counts.action_needed}
                </span>
              )}
            </div>
            <div className="font-display text-3xl font-semibold text-blue-700">
              {counts.action_needed}
            </div>
            <div className="text-xs text-navy-800/50 mt-1">
              {counts.urgent > 0
                ? <span className="text-red-500 font-medium">{counts.urgent} urgent/emergency</span>
                : 'No urgent cases'}
            </div>
            <div className="text-2xs text-navy-800/30 mt-0.5">Tap to view · new / queried / info provided</div>
          </button>

          {/* Active */}
          <button
            onClick={() => setFilter(filter === 'active' ? 'all' : 'active')}
            className={`rounded-2xl p-4 text-left transition-all border-2 ${
              filter === 'active'
                ? 'border-emerald-500 bg-emerald-50'
                : 'border-transparent bg-white hover:border-emerald-200'
            }`}
          >
            <div className="flex items-start justify-between mb-1">
              <span className="data-label text-emerald-700/70">In progress</span>
            </div>
            <div className="font-display text-3xl font-semibold text-emerald-700">
              {counts.active}
            </div>
            <div className="text-xs text-navy-800/50 mt-1">
              Cases accepted, patient in care
            </div>
            <div className="text-2xs text-navy-800/30 mt-0.5">Tap to view · accepted / arrived / planned</div>
          </button>

          {/* This month */}
          <div className="rounded-2xl p-4 bg-white">
            <div className="data-label mb-1">This month</div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-semibold text-navy-800">
                {analytics?.cases_this_month ?? 0}
              </span>
              {monthTrend !== 0 && (
                <span className={`text-sm font-medium ${monthTrend > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {monthTrend > 0 ? `+${monthTrend}` : monthTrend} vs last month
                </span>
              )}
            </div>
            <div className="text-xs text-navy-800/40 mt-1">
              {analytics?.cases_last_month ?? 0} received last month
            </div>
          </div>

          {/* Completed all-time */}
          <button
            onClick={() => setFilter(filter === 'completed' ? 'all' : 'completed')}
            className={`rounded-2xl p-4 text-left transition-all border-2 ${
              filter === 'completed'
                ? 'border-gray-400 bg-gray-50'
                : 'border-transparent bg-white hover:border-gray-200'
            }`}
          >
            <div className="data-label mb-1">Completed</div>
            <div className="font-display text-3xl font-semibold text-navy-800">
              {counts.completed}
            </div>
            <div className="text-xs text-navy-800/40 mt-1">
              {analytics?.avg_hours_to_accept
                ? `Avg. ${analytics.avg_hours_to_accept}h response time`
                : 'Procedures done, closed & declined'}
            </div>
            <div className="text-2xs text-navy-800/30 mt-0.5">Tap to view full history</div>
          </button>
        </div>

        {/* ── Search ────────────────────────────────────────────────────── */}
        <div className="relative">
          <SearchIcon />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search patient name, doctor, reference no..."
            className="input-clinical pl-9"
          />
        </div>

        {/* ── Filter tabs + flow explainer toggle ─────────────────────── */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {(Object.keys(FILTER_GROUPS) as FilterGroup[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap
                transition-all border flex-shrink-0
                ${filter === f
                  ? 'bg-navy-800 text-white border-navy-800'
                  : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}
            >
              {f === 'all'           ? `All (${counts.all})` :
               f === 'action_needed' ? `Needs response (${counts.action_needed})` :
               f === 'active'        ? `In progress (${counts.active})` :
               `Completed (${counts.completed})`}
            </button>
          ))}
          <button
            onClick={() => setShowFlow(v => !v)}
            className="px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap
              transition-all border flex-shrink-0 bg-white text-navy-800/40
              border-navy-800/15 hover:border-navy-800/30 flex items-center gap-1"
          >
            <span className="font-bold">i</span> Status flow
          </button>
        </div>

        {/* ── Status flow explanation panel ─────────────────────────────── */}
        {showFlow && (
          <div className="bg-white border border-navy-800/10 rounded-2xl p-4 space-y-3">
            <p className="data-label mb-1">How referral cases move through stages</p>
            <p className="text-xs text-navy-800/50 mb-2">
              Every referral submitted by a colleague enters your queue as <strong>Needs response</strong>.
              You review, decide, and the case progresses to <strong>In progress</strong>, then <strong>Completed</strong>.
            </p>
            {/* Flow arrow diagram */}
            <div className="flex items-center gap-2 mb-3">
              {FLOW_STEPS.map((step, i) => (
                <div key={step.group} className="flex items-center gap-2 flex-1">
                  <div className={`flex-1 rounded-xl px-3 py-2 text-center border ${step.bg} ${step.border}`}>
                    <div className={`text-xs font-semibold ${step.color}`}>{step.label}</div>
                  </div>
                  {i < FLOW_STEPS.length - 1 && (
                    <span className="text-navy-800/20 text-sm flex-shrink-0">→</span>
                  )}
                </div>
              ))}
            </div>
            {FLOW_STEPS.map(step => (
              <div key={step.group} className={`rounded-xl p-3 border ${step.bg} ${step.border}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={`w-2 h-2 rounded-full ${step.dot} flex-shrink-0`} />
                  <span className={`text-xs font-semibold ${step.color}`}>{step.label}</span>
                </div>
                <p className="text-xs text-navy-800/60 mb-2">{step.description}</p>
                <div className="space-y-0.5">
                  {step.statuses.map(s => (
                    <div key={s} className="text-xs text-navy-800/50">· {s}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Cases list ─────────────────────────────────────────────────── */}
        {displayed.length > 0 ? (
          <div className="bg-white rounded-2xl overflow-hidden border border-navy-800/8">
            <div className="px-4 py-3 border-b border-navy-800/6 flex items-center justify-between">
              <span className="text-xs font-medium text-navy-800/60">
                {filter === 'all' ? 'All cases' :
                 filter === 'action_needed' ? 'Needs your response' :
                 filter === 'active' ? 'In progress' : 'Completed'}
                {query && ` · "${query}"`}
              </span>
              <span className="text-xs text-navy-800/35">{displayed.length} case{displayed.length !== 1 ? 's' : ''}</span>
            </div>
            {displayed.map((c, idx) => {
              const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.submitted
              const isUrgent = c.urgency === 'urgent' || c.urgency === 'emergency'
              return (
                <button
                  key={c.id}
                  onClick={() => router.push(`/referrals/${c.id}`)}
                  className={`w-full flex items-start gap-3 px-4 py-4 text-left
                    hover:bg-navy-50/60 active:bg-navy-50 transition-colors
                    ${idx < displayed.length - 1 ? 'border-b border-navy-800/5' : ''}`}
                >
                  {/* Urgency indicator */}
                  <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${
                    c.urgency === 'emergency' ? 'bg-red-500' :
                    c.urgency === 'urgent'    ? 'bg-amber-400' : 'bg-navy-800/10'
                  }`} />

                  <div className="flex-1 min-w-0">
                    {/* Row 1: Name + status badge + date */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-semibold text-navy-800 truncate flex-1">
                        {c.patient_name}
                        {c.patient_gender && (
                          <span className="text-navy-800/40 font-normal"> · {c.patient_gender === 'male' ? 'M' : c.patient_gender === 'female' ? 'F' : c.patient_gender}</span>
                        )}
                      </span>
                      <span className="text-2xs text-navy-800/35 flex-shrink-0">{daysAgo(c.submitted_at)}</span>
                    </div>

                    {/* Row 2: Status + urgency badges */}
                    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                      <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
                        {cfg.label}
                      </span>
                      {isUrgent && (
                        <span className={`text-2xs px-2 py-0.5 rounded-full font-semibold ${
                          c.urgency === 'emergency'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {c.urgency === 'emergency' ? '🔴 Emergency' : '🟡 Urgent'}
                        </span>
                      )}
                    </div>

                    {/* Row 3: Referring doctor */}
                    <div className="text-xs text-navy-800/60 mb-1">
                      From <span className="font-medium">Dr. {getReferrerName(c)}</span>
                      {getReferrerSpecialty(c) && (
                        <span className="text-navy-800/40"> · {getReferrerSpecialty(c)}</span>
                      )}
                    </div>

                    {/* Row 4: Chief complaint */}
                    <div className="text-xs text-navy-800/50 truncate">
                      {c.chief_complaint}
                    </div>

                    {/* Row 5: Reference */}
                    <div className="text-2xs text-navy-800/25 mt-1 font-mono">{c.reference_no}</div>
                  </div>

                  <ChevronRight />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl text-center py-10 border border-navy-800/8">
            {query || filter !== 'all' ? (
              <>
                <p className="text-sm text-navy-800/50 mb-3">No cases match your search or filter</p>
                <button
                  onClick={() => { setQuery(''); setFilter('all') }}
                  className="text-sm text-navy-800 font-medium hover:underline"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <div className="w-12 h-12 bg-navy-800/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <CaseIcon />
                </div>
                <h3 className="font-display text-xl text-navy-800 mb-2">No referrals yet</h3>
                <p className="text-sm text-navy-800/50 mb-5 max-w-xs mx-auto">
                  Generate a referral link and share it with your clinical colleagues via WhatsApp.
                  They can submit a case without installing any app.
                </p>
                <button onClick={handleGenerateLink} disabled={isPending} className="btn-primary">
                  Generate referral link
                </button>
              </>
            )}
          </div>
        )}

        <div className="pb-8" />
      </main>

      {/* ── Generated link modal ──────────────────────────────────────────── */}
      {showLinkModal && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center
                        px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-2">Referral link ready</h2>
            <p className="text-sm text-navy-800/60 mb-4 leading-relaxed">
              Share this with your referring colleague via WhatsApp.
              They can submit a referral without installing any app.
            </p>

            <div className="bg-navy-50 rounded-xl p-3 mb-4 break-all">
              <p className="text-xs font-mono text-navy-800/70">{generatedLink}</p>
            </div>

            <div className="flex gap-2">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  `Referral form — Dr. ${specialist.name} (${specialist.specialty.replace(/_/g, ' ')})\n\n${generatedLink}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 bg-green-500
                           text-white rounded-xl py-3 text-sm font-medium
                           hover:bg-green-600 active:scale-95 transition-all"
              >
                <WhatsAppIcon />
                Share on WhatsApp
              </a>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedLink)
                  toast.success('Link copied')
                }}
                className="btn-secondary px-4 text-sm py-3"
              >
                Copy
              </button>
            </div>

            <button
              onClick={() => setShowLinkModal(false)}
              className="w-full text-center text-xs text-navy-800/40 mt-3 py-2 hover:text-navy-800/60 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function ChevronLeft() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-navy-800/20 flex-shrink-0 mt-1">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  )
}
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
         className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-800/30">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M10.5 10.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}
function CaseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-navy-800/40">
      <path d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}
function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}
