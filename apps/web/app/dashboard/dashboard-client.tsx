'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, FileText, Calendar, AlertTriangle,
  ArrowRight, Plus, Activity, Clock, ChevronRight,
  TrendingUp, Bell,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
type Specialist = {
  id: string; name: string; specialty: string; city: string
  status: string; role: string; last_active_at: string | null; created_at: string
  specialist_profiles?: { completeness_pct: number; photo_url?: string } | null
}

type Referrer = {
  id: string; name: string; specialty: string | null; status: string
  total_referrals: number; last_referral_at: string | null; days_since_last: number | null
  whatsapp: string | null; clinic_name: string | null; city: string
}

type Case = {
  id: string; reference_no: string; patient_name: string; status: string
  urgency: string; submitted_at: string
  referring_doctors: { name: string | null; specialty: string | null } | null
}

type Props = {
  specialist: Specialist
  referrers: Referrer[]
  cases: Case[]
  healthScore: number
  cityBenchmark: number
  isNewlyOnboarded: boolean
  userPhoto?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────
const SPECIALTY_LABEL: Record<string, string> = {
  interventional_cardiology: 'Interventional Cardiology',
  cardiac_surgery: 'Cardiac Surgery', cardiology: 'Cardiology',
  orthopedics: 'Orthopaedics', spine_surgery: 'Spine Surgery',
  neurology: 'Neurology', neurosurgery: 'Neurosurgery',
  gi_surgery: 'GI Surgery', urology: 'Urology', oncology: 'Oncology',
  reproductive_medicine: 'Reproductive Medicine', dermatology: 'Dermatology',
  ophthalmology: 'Ophthalmology', internal_medicine: 'Internal Medicine',
  electrophysiology: 'Electrophysiology', vascular_surgery: 'Vascular Surgery',
  endocrinology: 'Endocrinology', nephrology: 'Nephrology',
  pulmonology: 'Pulmonology', pediatrics: 'Paediatrics',
  radiology: 'Radiology', anesthesiology: 'Anaesthesiology',
  rheumatology: 'Rheumatology', ent: 'ENT', other: 'Specialist',
}

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  submitted:         { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  queried:           { bg: 'bg-purple-50',  text: 'text-purple-700',  dot: 'bg-purple-500' },
  info_provided:     { bg: 'bg-indigo-50',  text: 'text-indigo-700',  dot: 'bg-indigo-500' },
  accepted:          { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  patient_arrived:   { bg: 'bg-teal-50',    text: 'text-teal-700',    dot: 'bg-teal-500' },
  procedure_planned: { bg: 'bg-cyan-50',    text: 'text-cyan-700',    dot: 'bg-cyan-500' },
  completed:         { bg: 'bg-green-50',   text: 'text-green-700',   dot: 'bg-green-500' },
  declined:          { bg: 'bg-red-50',     text: 'text-red-600',     dot: 'bg-red-500' },
  cancelled:         { bg: 'bg-gray-100',   text: 'text-gray-500',    dot: 'bg-gray-400' },
}

const REFERRER_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  active:   { label: 'Active',   bg: 'bg-emerald-50', text: 'text-emerald-700' },
  drifting: { label: 'Drifting', bg: 'bg-amber-50',   text: 'text-amber-700' },
  silent:   { label: 'Silent',   bg: 'bg-red-50',     text: 'text-red-600' },
  new:      { label: 'New',      bg: 'bg-blue-50',    text: 'text-blue-700' },
}

const MODULES = [
  { label: 'Referrals',     path: '/referrals',       color: 'bg-blue-50 text-blue-700',     icon: <FileText size={18} /> },
  { label: 'Triage',        path: '/triage/sessions', color: 'bg-teal-50 text-teal-700',     icon: <Activity size={18} /> },
  { label: 'Appointments',  path: '/appointments',    color: 'bg-emerald-50 text-emerald-700',icon: <Calendar size={18} /> },
  { label: 'Synthesis',     path: '/synthesis',       color: 'bg-purple-50 text-purple-700', icon: <TrendingUp size={18} /> },
  { label: 'Transcription', path: '/transcription',   color: 'bg-amber-50 text-amber-700',   icon: <Clock size={18} /> },
  { label: 'Network',       path: '/network',         color: 'bg-navy-50 text-navy-800',     icon: <Users size={18} /> },
]

function daysAgo(date: string) {
  const d = Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d}d ago`
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, highlight, highlightColor, cta, onClick,
}: {
  label: string
  value: string | number
  sub?: string
  highlight?: string
  highlightColor?: string
  cta: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-2xl border border-navy-800/8 p-4 text-left
                 hover:shadow-md hover:border-navy-800/15 active:scale-[0.98]
                 transition-all group w-full"
    >
      <div className="mb-3">
        <div className="text-xs font-semibold text-navy-800/50 uppercase tracking-wide mb-2">{label}</div>
        <div className="font-display text-4xl font-bold text-navy-800 leading-none">{value}</div>
        {sub && <div className="text-xs text-navy-800/45 mt-1.5">{sub}</div>}
        {highlight && (
          <div className={`text-xs font-semibold mt-1 ${highlightColor ?? 'text-amber-600'}`}>
            {highlight}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs font-bold text-navy-800
                      group-hover:gap-2.5 transition-all">
        {cta} <ArrowRight size={13} />
      </div>
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DashboardClient({
  specialist, referrers, cases, healthScore, cityBenchmark, isNewlyOnboarded, userPhoto,
}: Props) {
  const router = useRouter()
  const [dismissedBanner, setDismissedBanner] = useState(false)

  // Derived
  const activeReferrers   = referrers.filter(r => r.status === 'active')
  const driftingReferrers = referrers.filter(r => r.status === 'drifting')
  const silentReferrers   = referrers.filter(r => r.status === 'silent')
  const atRisk            = driftingReferrers.length + silentReferrers.length

  const pendingCases = cases.filter(c => ['submitted', 'queried', 'info_provided'].includes(c.status))
  const urgentCases  = pendingCases.filter(c => c.urgency === 'urgent' || c.urgency === 'emergency')

  const firstName = specialist.name.split(' ').find(p => p.length > 1) ?? specialist.name.split(' ')[0]
  const greeting  = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()

  const profile      = (specialist.specialist_profiles as any)?.[0]
                     ?? (specialist.specialist_profiles as any) ?? null
  const completeness = profile?.completeness_pct ?? 0

  return (
    <div className="space-y-5 pb-10">

      {/* ── Greeting header ───────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-navy-800 leading-tight">
            {greeting}, Dr. {firstName}
          </h1>
          <p className="text-sm text-navy-800/50 mt-0.5">
            {SPECIALTY_LABEL[specialist.specialty] ?? specialist.specialty} · {specialist.city}
          </p>
        </div>
        <button
          onClick={() => router.push('/network/add')}
          className="flex items-center gap-2 bg-navy-800 text-white text-xs font-bold
                     px-4 py-2.5 rounded-xl hover:bg-navy-900 active:scale-95
                     transition-all flex-shrink-0"
        >
          <Plus size={14} /> Add colleague
        </button>
      </div>

      {/* ── Urgent referrals banner ────────────────────────────────────── */}
      {urgentCases.length > 0 && (
        <div className="rounded-2xl p-4 border-2 border-red-200"
             style={{ background: 'linear-gradient(135deg, #fef2f2 0%, #fff5f5 100%)' }}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500 flex items-center justify-center flex-shrink-0">
              <Bell size={16} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-bold text-red-700">Priority attention required</span>
              </div>
              <p className="text-xs text-red-700/80 leading-relaxed mb-3">
                {urgentCases.length} urgent/emergency referral{urgentCases.length > 1 ? 's' : ''} awaiting
                your response. These cases have been flagged by referring doctors as time-sensitive.
              </p>
              <button
                onClick={() => router.push('/referrals?status=action_needed')}
                className="inline-flex items-center gap-2 bg-red-600 text-white text-xs font-bold
                           px-4 py-2 rounded-xl hover:bg-red-700 active:scale-95 transition-all"
              >
                Review urgent cases now <ArrowRight size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Welcome banner (newly onboarded) ─────────────────────────── */}
      {isNewlyOnboarded && !dismissedBanner && (
        <div className="rounded-2xl p-5 relative overflow-hidden"
             style={{ background: 'linear-gradient(135deg, #0A1628 0%, #1A5276 100%)' }}>
          <div className="relative">
            <div className="text-2xs font-mono uppercase tracking-widest text-white/40 mb-2">
              Welcome to ClinCollab
            </div>
            <p className="text-sm text-white leading-relaxed mb-3 max-w-lg">
              Your practice intelligence is now active. Add your referring colleagues to unlock
              network analytics, referral tracking, and re-engagement alerts.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/network/add')}
                className="text-xs font-bold text-white bg-white/15 hover:bg-white/25
                           px-4 py-2 rounded-xl transition-colors flex items-center gap-1.5"
              >
                Add first colleague <ArrowRight size={12} />
              </button>
              <button onClick={() => setDismissedBanner(true)}
                className="text-xs text-white/35 hover:text-white/60 transition-colors">
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 4 Strategic KPI cards ─────────────────────────────────────── */}
      <div>
        <div className="text-xs font-bold text-navy-800/40 uppercase tracking-widest mb-3">
          Your practice at a glance
        </div>
        <div className="grid grid-cols-2 gap-3">
          <KpiCard
            label="Needs Response"
            value={pendingCases.length}
            sub={`referral${pendingCases.length !== 1 ? 's' : ''} awaiting your decision`}
            highlight={urgentCases.length > 0 ? `${urgentCases.length} urgent/emergency` : undefined}
            highlightColor="text-red-600"
            cta="Review referrals"
            onClick={() => router.push('/referrals?status=action_needed')}
          />
          <KpiCard
            label="Active Referrers"
            value={activeReferrers.length}
            sub={`of ${referrers.length} total · ${cityBenchmark} is ${specialist.city} avg`}
            highlight={activeReferrers.length < cityBenchmark
              ? `${cityBenchmark - activeReferrers.length} below city average`
              : `${activeReferrers.length - cityBenchmark} above city average`}
            highlightColor={activeReferrers.length >= cityBenchmark ? 'text-emerald-600' : 'text-amber-600'}
            cta="View network"
            onClick={() => router.push('/network?filter=active')}
          />
          <KpiCard
            label="Network Health"
            value={healthScore}
            sub="out of 100 · based on engagement + volume"
            highlight={healthScore >= 70 ? 'Strong network' : healthScore >= 40 ? 'Needs attention' : 'At risk'}
            highlightColor={healthScore >= 70 ? 'text-emerald-600' : healthScore >= 40 ? 'text-amber-600' : 'text-red-600'}
            cta="See full network analytics"
            onClick={() => router.push('/network')}
          />
          <KpiCard
            label="Relationships at Risk"
            value={atRisk}
            sub={`${driftingReferrers.length} drifting · ${silentReferrers.length} silent (90d+)`}
            highlight={atRisk > 0 ? 'Re-engage before they go quiet' : 'All relationships healthy'}
            highlightColor={atRisk > 0 ? 'text-amber-600' : 'text-emerald-600'}
            cta={atRisk > 0 ? 'Re-engage now' : 'View network'}
            onClick={() => router.push(atRisk > 0 ? '/network?filter=silent' : '/network')}
          />
        </div>
      </div>

      {/* ── Recent referral cases ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold text-navy-800/40 uppercase tracking-widest">
            Recent referral cases
          </div>
          <button
            onClick={() => router.push('/referrals')}
            className="text-xs font-semibold text-navy-800/60 hover:text-navy-800
                       flex items-center gap-1 transition-colors"
          >
            All cases <ChevronRight size={13} />
          </button>
        </div>
        {cases.length > 0 ? (
          <div className="bg-white rounded-2xl border border-navy-800/8 overflow-hidden">
            {cases.slice(0, 5).map((c, idx) => {
              const st     = STATUS_COLORS[c.status] || STATUS_COLORS.submitted
              const isUrg  = c.urgency === 'urgent' || c.urgency === 'emergency'
              const refName = c.referring_doctors?.name || 'Unknown'
              return (
                <button
                  key={c.id}
                  onClick={() => router.push(`/referrals/${c.id}`)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left
                    hover:bg-navy-50/60 active:bg-navy-50 transition-colors
                    ${idx < Math.min(cases.length, 5) - 1 ? 'border-b border-navy-800/5' : ''}`}
                >
                  <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${
                    c.urgency === 'emergency' ? 'bg-red-500' :
                    c.urgency === 'urgent'    ? 'bg-amber-400' : 'bg-navy-800/10'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-navy-800 truncate flex-1">
                        {c.patient_name}
                      </span>
                      <span className={`text-2xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${st.bg} ${st.text}`}>
                        {c.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </span>
                    </div>
                    <div className="text-xs text-navy-800/45">
                      From Dr. {refName}
                      {isUrg && (
                        <span className={`ml-2 font-semibold ${c.urgency === 'emergency' ? 'text-red-600' : 'text-amber-600'}`}>
                          · {c.urgency === 'emergency' ? '🔴 Emergency' : '🟡 Urgent'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-navy-800/30 flex-shrink-0 text-right">
                    {daysAgo(c.submitted_at)}
                  </div>
                  <ChevronRight size={14} className="text-navy-800/20 flex-shrink-0" />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-navy-800/8 p-6 text-center">
            <p className="text-sm text-navy-800/40 mb-3">No referral cases yet</p>
            <button
              onClick={() => router.push('/referrals')}
              className="inline-flex items-center gap-2 bg-navy-800 text-white text-xs font-bold
                         px-4 py-2 rounded-xl hover:bg-navy-900 transition-all"
            >
              Generate referral link <ArrowRight size={12} />
            </button>
          </div>
        )}
      </div>

      {/* ── Active referrers needing attention ────────────────────────── */}
      {silentReferrers.length > 0 && (
        <div className="bg-amber-50 border border-amber-200/70 rounded-2xl p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <AlertTriangle size={15} className="text-amber-600 flex-shrink-0" />
                <span className="text-sm font-bold text-amber-900">
                  {silentReferrers.length} silent referrer{silentReferrers.length > 1 ? 's' : ''} — act now
                </span>
              </div>
              <p className="text-xs text-amber-800/70">
                These colleagues have not referred in 90+ days. Re-engage before the relationship is lost.
              </p>
            </div>
          </div>
          <div className="space-y-1.5 mb-3">
            {silentReferrers.slice(0, 3).map(r => (
              <button
                key={r.id}
                onClick={() => router.push(`/network/${r.id}`)}
                className="w-full flex items-center gap-3 bg-white rounded-xl px-3 py-2.5
                           hover:bg-amber-50 border border-amber-100/80 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-amber-700">{initials(r.name)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-amber-900 truncate">{r.name}</div>
                  <div className="text-xs text-amber-700/60">
                    {r.total_referrals} total referrals · silent {r.days_since_last}d
                  </div>
                </div>
                <ChevronRight size={14} className="text-amber-600/40 flex-shrink-0" />
              </button>
            ))}
          </div>
          <button
            onClick={() => router.push('/network?filter=silent')}
            className="w-full flex items-center justify-center gap-2 bg-amber-500
                       text-white text-xs font-bold px-4 py-2.5 rounded-xl
                       hover:bg-amber-600 active:scale-95 transition-all"
          >
            Re-engage all silent referrers <ArrowRight size={13} />
          </button>
        </div>
      )}

      {/* ── Profile completeness nudge ─────────────────────────────────── */}
      {completeness < 70 && (
        <button
          onClick={() => router.push('/profile')}
          className="w-full bg-white rounded-2xl border border-navy-800/8 p-4 text-left
                     hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-navy-800">Complete your profile</span>
            <span className="text-xs font-bold text-navy-800/40">{completeness}% done</span>
          </div>
          <div className="h-2 bg-navy-800/8 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-navy-800 rounded-full transition-all duration-700"
                 style={{ width: `${completeness}%` }} />
          </div>
          <p className="text-xs text-navy-800/50 leading-relaxed">
            Complete profiles receive more direct referrals. Add MCI number, hospitals, and bio.
          </p>
          <div className="flex items-center gap-1.5 text-xs font-bold text-navy-800 mt-2
                          group-hover:gap-2.5 transition-all">
            Complete profile <ArrowRight size={12} />
          </div>
        </button>
      )}

      {/* ── Module quick access ────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-bold text-navy-800/40 uppercase tracking-widest mb-3">Quick access</div>
        <div className="grid grid-cols-3 gap-2.5">
          {MODULES.map(m => (
            <button
              key={m.path}
              onClick={() => router.push(m.path)}
              className="bg-white rounded-2xl border border-navy-800/8 p-3.5 flex flex-col
                         items-center gap-2 hover:shadow-md hover:border-navy-800/15
                         active:scale-95 transition-all"
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${m.color}`}>
                {m.icon}
              </div>
              <span className="text-xs font-semibold text-navy-800/65 text-center leading-tight">
                {m.label}
              </span>
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}
