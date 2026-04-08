'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Plus, ChevronRight, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
type Specialist = {
  id: string; name: string; specialty: string; city: string
  role: string; specialist_profiles?: { completeness_pct: number } | null
}

type VolumeData = {
  thisMonth: number; lastMonth: number
  ytd: number; lastYearYtd: number; ytdLabel: string
  trend: { month: string; count: number }[]
  totalAllTime: number; completedAllTime: number
  acceptanceRate: number; avgHoursToAccept: number | null
}

type NetworkData = {
  total: number; active: number; drifting: number; silent: number; newReferrers: number
  healthScore: number; cityBenchmark: number; plannedForEngagement: number
}

type PipelineData = { needsResponse: number; urgent: number; inProgress: number }

type Props = {
  specialist: Specialist
  volume: VolumeData
  network: NetworkData
  pipeline: PipelineData
  isNewlyOnboarded: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const SPECIALTY_LABEL: Record<string, string> = {
  interventional_cardiology: 'Interventional Cardiology', cardiac_surgery: 'Cardiac Surgery',
  cardiology: 'Cardiology', orthopedics: 'Orthopaedics', spine_surgery: 'Spine Surgery',
  neurology: 'Neurology', neurosurgery: 'Neurosurgery', gi_surgery: 'GI Surgery',
  urology: 'Urology', oncology: 'Oncology', reproductive_medicine: 'Reproductive Medicine',
  dermatology: 'Dermatology', ophthalmology: 'Ophthalmology',
  internal_medicine: 'Internal Medicine', electrophysiology: 'Electrophysiology',
  vascular_surgery: 'Vascular Surgery', endocrinology: 'Endocrinology',
  nephrology: 'Nephrology', pulmonology: 'Pulmonology', pediatrics: 'Paediatrics',
  radiology: 'Radiology', anesthesiology: 'Anaesthesiology',
  rheumatology: 'Rheumatology', ent: 'ENT', other: 'Specialist',
}

// ── Trend sparkline ───────────────────────────────────────────────────────────
function SparkBars({ data }: { data: { month: string; count: number }[] }) {
  const max = Math.max(...data.map(d => d.count), 1)
  const current = data[data.length - 1]?.count ?? 0
  return (
    <div className="flex items-end gap-1.5 h-14 w-full">
      {data.map((d, i) => {
        const isCurrentMonth = i === data.length - 1
        const pct = Math.max(8, Math.round((d.count / max) * 100))
        return (
          <div key={i} className="flex flex-col items-center gap-1 flex-1">
            <div
              className={`w-full rounded-t-sm transition-all duration-700 ${
                isCurrentMonth ? 'bg-navy-800' : 'bg-navy-800/20'
              }`}
              style={{ height: `${pct}%` }}
            />
            <span className={`text-2xs font-mono leading-none ${
              isCurrentMonth ? 'text-navy-800/70 font-bold' : 'text-navy-800/30'
            }`}>
              {d.month}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ label, cta, href }: { label: string; cta?: string; href?: string }) {
  const router = useRouter()
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="text-xs font-bold text-navy-800/50 uppercase tracking-widest">{label}</span>
      {cta && href && (
        <button
          onClick={() => router.push(href)}
          className="text-xs font-semibold text-navy-800/60 hover:text-navy-800 flex items-center gap-1 transition-colors"
        >
          {cta} <ChevronRight size={12} />
        </button>
      )}
    </div>
  )
}

// ── Clickable stat tile ───────────────────────────────────────────────────────
function StatTile({
  label, value, valueColor, sub, href,
}: {
  label: string; value: string | number; valueColor?: string; sub?: string; href: string
}) {
  const router = useRouter()
  return (
    <button
      onClick={() => router.push(href)}
      className="bg-white rounded-2xl border border-navy-800/8 p-4 text-left w-full
                 hover:shadow-md hover:border-navy-800/15 active:scale-[0.98] transition-all group"
    >
      <div className={`font-display text-3xl font-bold leading-none mb-1 ${valueColor ?? 'text-navy-800'}`}>
        {value}
      </div>
      <div className="text-xs font-semibold text-navy-800/60">{label}</div>
      {sub && <div className="text-2xs text-navy-800/35 mt-0.5">{sub}</div>}
      <div className="flex items-center gap-1 text-2xs font-bold text-navy-800/30
                      group-hover:text-navy-800/60 mt-2 transition-colors">
        View details <ArrowRight size={11} />
      </div>
    </button>
  )
}

// ── Network status pill ───────────────────────────────────────────────────────
function NetworkPill({
  label, count, bg, text, href,
}: {
  label: string; count: number; bg: string; text: string; href: string
}) {
  const router = useRouter()
  return (
    <button
      onClick={() => router.push(href)}
      className={`flex flex-col items-center rounded-2xl px-3 py-3 border-2 border-transparent
                  hover:border-current active:scale-95 transition-all ${bg} ${text} flex-1`}
    >
      <span className="font-display text-2xl font-bold leading-none">{count}</span>
      <span className="text-2xs font-semibold mt-1 text-center leading-tight">{label}</span>
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DashboardClient({
  specialist, volume, network, pipeline, isNewlyOnboarded,
}: Props) {
  const router = useRouter()
  const [dismissedBanner, setDismissedBanner] = useState(false)

  const firstName  = specialist.name.split(' ').find(p => p.length > 1) ?? specialist.name.split(' ')[0]
  const greeting   = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()
  const monthTrend = volume.thisMonth - volume.lastMonth
  const ytdTrend   = volume.ytd - volume.lastYearYtd

  return (
    <div className="space-y-6 pb-10">

      {/* ── Greeting ──────────────────────────────────────────────────── */}
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
                     transition-all flex-shrink-0 shadow-sm"
        >
          <Plus size={14} /> Add colleague
        </button>
      </div>

      {/* ── Urgent alert banner ────────────────────────────────────────── */}
      {pipeline.urgent > 0 && (
        <div className="rounded-2xl p-4 border-2 border-red-300 bg-red-50">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            <div className="flex-1">
              <span className="text-sm font-bold text-red-700">
                {pipeline.urgent} urgent/emergency referral{pipeline.urgent > 1 ? 's' : ''} need immediate attention
              </span>
            </div>
            <button
              onClick={() => router.push('/referrals?status=action_needed')}
              className="flex items-center gap-1.5 bg-red-600 text-white text-xs font-bold
                         px-3 py-2 rounded-xl hover:bg-red-700 active:scale-95
                         transition-all flex-shrink-0"
            >
              Review now <ArrowRight size={12} />
            </button>
          </div>
        </div>
      )}

      {/* ── Welcome banner ────────────────────────────────────────────── */}
      {isNewlyOnboarded && !dismissedBanner && (
        <div className="rounded-2xl p-5 relative overflow-hidden"
             style={{ background: 'linear-gradient(135deg, #0A1628 0%, #1A5276 100%)' }}>
          <p className="text-sm text-white leading-relaxed mb-3">
            Welcome to ClinCollab. Add your referring colleagues to activate network intelligence,
            referral tracking, and re-engagement alerts.
          </p>
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/network/add')}
              className="text-xs font-bold text-white bg-white/15 hover:bg-white/25
                         px-4 py-2 rounded-xl transition-colors flex items-center gap-1.5">
              Add first colleague <ArrowRight size={12} />
            </button>
            <button onClick={() => setDismissedBanner(true)} className="text-xs text-white/35 hover:text-white/60">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1 — REFERRAL VOLUME
          What matters: case flow trends for practice planning
      ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionHeader label="Referral Volume" cta="All cases" href="/referrals" />
        <div className="bg-white rounded-2xl border border-navy-800/8 p-5">

          {/* 4 volume stats */}
          <div className="grid grid-cols-4 gap-0 mb-5 divide-x divide-navy-800/8">
            {/* This month */}
            <div className="pr-4">
              <div className="font-display text-3xl font-bold text-navy-800 leading-none">
                {volume.thisMonth}
              </div>
              <div className="text-xs font-semibold text-navy-800/55 mt-1">This month</div>
              <div className={`flex items-center gap-1 text-xs font-semibold mt-1 ${
                monthTrend > 0 ? 'text-emerald-600' : monthTrend < 0 ? 'text-red-500' : 'text-navy-800/35'
              }`}>
                {monthTrend > 0 ? <TrendingUp size={12} /> : monthTrend < 0 ? <TrendingDown size={12} /> : null}
                {monthTrend > 0 ? `+${monthTrend}` : monthTrend < 0 ? `${monthTrend}` : '—'} vs last month
              </div>
            </div>

            {/* Last month */}
            <div className="px-4">
              <div className="font-display text-3xl font-bold text-navy-800/50 leading-none">
                {volume.lastMonth}
              </div>
              <div className="text-xs font-semibold text-navy-800/40 mt-1">Last month</div>
              <div className="text-2xs text-navy-800/30 mt-1">cases received</div>
            </div>

            {/* YTD */}
            <div className="px-4">
              <div className="font-display text-3xl font-bold text-navy-800 leading-none">
                {volume.ytd}
              </div>
              <div className="text-xs font-semibold text-navy-800/55 mt-1">YTD</div>
              <div className={`flex items-center gap-1 text-xs font-semibold mt-1 ${
                ytdTrend > 0 ? 'text-emerald-600' : ytdTrend < 0 ? 'text-red-500' : 'text-navy-800/35'
              }`}>
                {ytdTrend > 0 ? <TrendingUp size={12} /> : ytdTrend < 0 ? <TrendingDown size={12} /> : null}
                {ytdTrend > 0 ? `+${ytdTrend}` : ytdTrend < 0 ? `${ytdTrend}` : '—'} vs last yr
              </div>
            </div>

            {/* Last year YTD */}
            <div className="pl-4">
              <div className="font-display text-3xl font-bold text-navy-800/50 leading-none">
                {volume.lastYearYtd}
              </div>
              <div className="text-xs font-semibold text-navy-800/40 mt-1">Last year YTD</div>
              <div className="text-2xs text-navy-800/30 mt-1">{volume.ytdLabel}</div>
            </div>
          </div>

          {/* 6-month sparkline */}
          <div className="mb-4">
            <div className="text-2xs text-navy-800/35 font-mono uppercase tracking-widest mb-2">
              6-month trend
            </div>
            <SparkBars data={volume.trend} />
          </div>

          {/* Acceptance rate + avg response */}
          <div className="flex items-center gap-4 pt-4 border-t border-navy-800/6">
            <div className="flex-1">
              <div className="text-2xs text-navy-800/40 font-mono uppercase tracking-widest mb-1">
                Acceptance rate
              </div>
              <div className={`font-display text-xl font-bold ${
                volume.acceptanceRate >= 60 ? 'text-emerald-700' :
                volume.acceptanceRate >= 35 ? 'text-amber-600' : 'text-red-600'
              }`}>
                {volume.acceptanceRate > 0 ? `${volume.acceptanceRate}%` : '—'}
              </div>
            </div>
            <div className="w-px h-10 bg-navy-800/8" />
            <div className="flex-1">
              <div className="text-2xs text-navy-800/40 font-mono uppercase tracking-widest mb-1">
                Avg. response time
              </div>
              <div className="font-display text-xl font-bold text-navy-800">
                {volume.avgHoursToAccept ? `${volume.avgHoursToAccept}h` : '—'}
              </div>
            </div>
            <div className="w-px h-10 bg-navy-800/8" />
            <div className="flex-1">
              <div className="text-2xs text-navy-800/40 font-mono uppercase tracking-widest mb-1">
                Completed all-time
              </div>
              <div className="font-display text-xl font-bold text-navy-800">
                {volume.completedAllTime}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 2 — REFERRER NETWORK
          Summary only — full detail in Network module
      ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionHeader label="Referrer Network" cta="Manage network" href="/network" />
        <div className="bg-white rounded-2xl border border-navy-800/8 p-5">

          {/* Health score row */}
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-navy-800/6">
            <div>
              <div className="text-2xs text-navy-800/40 font-mono uppercase tracking-widest mb-1">
                Network Health Score
              </div>
              <div className={`font-display text-3xl font-bold ${
                network.healthScore >= 70 ? 'text-emerald-700' :
                network.healthScore >= 40 ? 'text-amber-600' : 'text-red-600'
              }`}>
                {network.healthScore}<span className="text-base text-navy-800/30 font-normal">/100</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xs text-navy-800/40 mb-1">{specialist.city} platform avg.</div>
              <div className="font-display text-2xl font-bold text-navy-800/40">{network.cityBenchmark}</div>
              <div className="text-2xs text-navy-800/30">active referrers</div>
            </div>
          </div>

          {/* 5 status buckets — all clickable to Network module with correct filter */}
          <div className="flex gap-2 mb-4">
            <NetworkPill label="Total" count={network.total}
              bg="bg-navy-800/5" text="text-navy-800"
              href="/network" />
            <NetworkPill label="Active" count={network.active}
              bg="bg-emerald-50" text="text-emerald-700"
              href="/network?filter=active" />
            <NetworkPill label="Drifting" count={network.drifting}
              bg="bg-amber-50" text="text-amber-700"
              href="/network?filter=drifting" />
            <NetworkPill label="Silent" count={network.silent}
              bg="bg-red-50" text="text-red-600"
              href="/network?filter=silent" />
            <NetworkPill label="New" count={network.newReferrers}
              bg="bg-blue-50" text="text-blue-700"
              href="/network?filter=new" />
          </div>

          {/* Planned for engagement */}
          {network.plannedForEngagement > 0 ? (
            <div className="flex items-center justify-between bg-amber-50 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2.5">
                <AlertTriangle size={15} className="text-amber-500 flex-shrink-0" />
                <div>
                  <span className="text-sm font-bold text-amber-900">
                    {network.plannedForEngagement} planned for re-engagement
                  </span>
                  <div className="text-xs text-amber-700/70">
                    {network.drifting} drifting · {network.silent} silent — at risk of permanent dropout
                  </div>
                </div>
              </div>
              <button
                onClick={() => router.push('/network?filter=drifting')}
                className="flex items-center gap-1.5 bg-amber-500 text-white text-xs font-bold
                           px-3 py-2 rounded-xl hover:bg-amber-600 active:scale-95
                           transition-all flex-shrink-0 ml-3"
              >
                Plan outreach <ArrowRight size={12} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-emerald-50 rounded-xl px-4 py-3">
              <span className="text-sm font-semibold text-emerald-800">
                All referrer relationships are healthy
              </span>
              <button
                onClick={() => router.push('/network/add')}
                className="flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-bold
                           px-3 py-2 rounded-xl hover:bg-emerald-700 active:scale-95 transition-all"
              >
                <Plus size={12} /> Add colleague
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3 — LIVE PIPELINE
          Summary counts only — detail in Referrals module
      ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionHeader label="Referral Pipeline" cta="All cases" href="/referrals" />
        <div className="grid grid-cols-2 gap-3">
          <StatTile
            label="Needs your response"
            value={pipeline.needsResponse}
            valueColor={pipeline.needsResponse > 0 ? 'text-blue-700' : 'text-navy-800/40'}
            sub={pipeline.urgent > 0 ? `${pipeline.urgent} urgent/emergency` : 'submitted · queried · info provided'}
            href="/referrals?status=action_needed"
          />
          <StatTile
            label="In progress"
            value={pipeline.inProgress}
            valueColor={pipeline.inProgress > 0 ? 'text-emerald-700' : 'text-navy-800/40'}
            sub="accepted · patient arrived · procedure planned"
            href="/referrals?status=active"
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4 — QUICK ACCESS
      ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionHeader label="Quick access" />
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
          {[
            { label: 'Referrals',     path: '/referrals',       color: 'bg-blue-50 text-blue-700',      emoji: '📋' },
            { label: 'Network',       path: '/network',         color: 'bg-emerald-50 text-emerald-700', emoji: '🔗' },
            { label: 'Triage',        path: '/triage/sessions', color: 'bg-teal-50 text-teal-700',      emoji: '🏥' },
            { label: 'Appointments',  path: '/appointments',    color: 'bg-purple-50 text-purple-700',  emoji: '📅' },
            { label: 'Synthesis',     path: '/synthesis',       color: 'bg-amber-50 text-amber-700',    emoji: '🔬' },
            { label: 'Transcription', path: '/transcription',   color: 'bg-navy-50 text-navy-800',      emoji: '🎙️' },
          ].map(m => (
            <button key={m.path} onClick={() => router.push(m.path)}
              className="bg-white rounded-2xl border border-navy-800/8 p-3.5 flex flex-col
                         items-center gap-2 hover:shadow-md hover:border-navy-800/15
                         active:scale-95 transition-all">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${m.color}`}>
                {m.emoji}
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
