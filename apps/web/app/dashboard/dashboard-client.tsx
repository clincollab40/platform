'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight, Plus, ChevronRight, AlertTriangle, TrendingUp, TrendingDown,
  Clock, CheckCircle2, Users, Activity, Zap, BarChart3,
  Bell, Calendar, FileText, Mic, FlaskConical, MessageSquare,
} from 'lucide-react'

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
  return (
    <div className="flex items-end gap-1.5 h-16 w-full">
      {data.map((d, i) => {
        const isCurrentMonth = i === data.length - 1
        const pct = Math.max(6, Math.round((d.count / max) * 100))
        return (
          <div key={i} className="flex flex-col items-center gap-1 flex-1">
            <div className="relative w-full flex flex-col items-center justify-end" style={{ height: '52px' }}>
              {isCurrentMonth && d.count > 0 && (
                <span className="absolute -top-4 text-2xs font-bold text-navy-800">{d.count}</span>
              )}
              <div
                className={`w-full rounded-t-md transition-all duration-700 ${
                  isCurrentMonth ? 'bg-navy-800' : 'bg-navy-800/18'
                }`}
                style={{ height: `${pct}%` }}
              />
            </div>
            <span className={`text-2xs font-mono leading-none ${
              isCurrentMonth ? 'text-navy-800/80 font-bold' : 'text-navy-800/30'
            }`}>
              {d.month}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Metric bar (for acceptance rate, etc.) ────────────────────────────────────
function MetricBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="w-full h-1.5 bg-navy-800/8 rounded-full overflow-hidden mt-1.5">
      <div className={`h-full rounded-full transition-all duration-1000 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({
  label, sub, cta, href, accent,
}: {
  label: string; sub?: string; cta?: string; href?: string; accent?: string
}) {
  const router = useRouter()
  return (
    <div className="flex items-center justify-between mb-3">
      <div>
        <div className="flex items-center gap-2">
          {accent && <div className={`w-1 h-4 rounded-full ${accent}`} />}
          <span className="text-sm font-bold text-navy-800">{label}</span>
        </div>
        {sub && <p className="text-2xs text-navy-800/40 mt-0.5 ml-3">{sub}</p>}
      </div>
      {cta && href && (
        <button
          onClick={() => router.push(href)}
          className="text-xs font-semibold text-navy-800/50 hover:text-navy-800 flex items-center gap-1 transition-colors"
        >
          {cta} <ChevronRight size={12} />
        </button>
      )}
    </div>
  )
}

// ── Pipeline action tile ──────────────────────────────────────────────────────
function PipelineTile({
  count, label, meaning, implication, ctaLabel, href, variant,
}: {
  count: number; label: string; meaning: string; implication: string
  ctaLabel: string; href: string; variant: 'urgent' | 'pending' | 'active' | 'empty'
}) {
  const router = useRouter()
  const cfg = {
    urgent:  { top: 'bg-red-600',     num: 'text-red-600',     btn: 'bg-red-600 hover:bg-red-700', badge: 'bg-red-100 text-red-700', border: 'border-red-200 ring-1 ring-red-300' },
    pending: { top: 'bg-amber-500',   num: 'text-amber-600',   btn: 'bg-amber-500 hover:bg-amber-600', badge: 'bg-amber-100 text-amber-700', border: 'border-amber-200' },
    active:  { top: 'bg-emerald-600', num: 'text-emerald-600', btn: 'bg-emerald-600 hover:bg-emerald-700', badge: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-200' },
    empty:   { top: 'bg-navy-800/20', num: 'text-navy-800/30', btn: 'bg-navy-800/60 hover:bg-navy-800', badge: 'bg-navy-50 text-navy-800/40', border: 'border-navy-800/8' },
  }[variant]

  return (
    <button
      onClick={() => router.push(href)}
      className={`bg-white rounded-2xl border ${cfg.border} overflow-hidden text-left w-full
                 hover:shadow-clinical-md active:scale-[0.98] transition-all group`}
    >
      {/* Colored top band */}
      <div className={`h-1.5 w-full ${cfg.top}`} />
      <div className="p-4">
        {/* Number */}
        <div className={`font-display text-5xl font-bold leading-none mb-1 ${cfg.num}`}>
          {count}
        </div>
        {/* Label */}
        <div className="text-sm font-bold text-navy-800 mt-1">{label}</div>
        {/* What it means */}
        <div className="text-xs text-navy-800/50 mt-1 leading-snug">{meaning}</div>
        {/* Clinical implication */}
        {count > 0 && (
          <div className={`mt-3 text-2xs font-semibold px-2 py-1.5 rounded-lg leading-snug ${cfg.badge}`}>
            {implication}
          </div>
        )}
        {/* CTA */}
        <div className={`mt-3 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white
                         transition-all ${cfg.btn}`}>
          {ctaLabel} <ArrowRight size={12} className="flex-shrink-0" />
        </div>
      </div>
    </button>
  )
}

// ── Network status bucket ─────────────────────────────────────────────────────
function NetworkBucket({
  count, label, sub, bg, text, href,
}: {
  count: number; label: string; sub: string; bg: string; text: string; href: string
}) {
  const router = useRouter()
  return (
    <button
      onClick={() => router.push(href)}
      className={`flex flex-col rounded-xl px-3 py-3 border border-transparent
                  hover:shadow-sm active:scale-95 transition-all ${bg} flex-1 text-left`}
    >
      <span className={`font-display text-3xl font-bold leading-none ${text}`}>{count}</span>
      <span className={`text-xs font-bold mt-1 ${text}`}>{label}</span>
      <span className={`text-2xs mt-0.5 leading-tight ${text} opacity-60`}>{sub}</span>
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
  const monthTrend    = volume.thisMonth - volume.lastMonth
  const ytdTrend      = volume.ytd - volume.lastYearYtd
  const pipelineTotal = pipeline.needsResponse + pipeline.inProgress

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

      {/* ── Urgent flash banner ────────────────────────────────────────── */}
      {pipeline.urgent > 0 && (
        <div className="rounded-2xl border-2 border-red-300 bg-red-50 overflow-hidden">
          <div className="bg-red-600 px-4 py-2 flex items-center gap-2">
            <Bell size={13} className="text-white animate-pulse" />
            <span className="text-xs font-bold text-white tracking-wide uppercase">
              Immediate action required
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-bold text-red-800">
                {pipeline.urgent} urgent/emergency case{pipeline.urgent > 1 ? 's' : ''} waiting for your response
              </p>
              <p className="text-xs text-red-700/70 mt-0.5">
                Every hour of delay significantly reduces referrer retention
              </p>
            </div>
            <button
              onClick={() => router.push('/referrals?status=action_needed')}
              className="flex items-center gap-1.5 bg-red-600 text-white text-xs font-bold
                         px-4 py-2.5 rounded-xl hover:bg-red-700 active:scale-95
                         transition-all flex-shrink-0 ml-4"
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
          SECTION 1 — LIVE PIPELINE
          Most actionable items first — requires doctor's decision
      ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionHeader
          label="Your Referral Pipeline"
          sub={pipelineTotal > 0
            ? `${pipelineTotal} active case${pipelineTotal > 1 ? 's' : ''} require your attention`
            : 'No open cases right now'}
          cta="All cases"
          href="/referrals"
          accent="bg-blue-500"
        />
        <div className="grid grid-cols-3 gap-3">
          <PipelineTile
            count={pipeline.urgent}
            label="Urgent / Emergency"
            meaning="Cases flagged as time-critical by the referring doctor"
            implication="Respond within 1 hour — every delay risks losing the referrer"
            ctaLabel={pipeline.urgent > 0 ? 'Respond now' : 'No urgent cases'}
            href="/referrals?status=action_needed&urgency=urgent"
            variant={pipeline.urgent > 0 ? 'urgent' : 'empty'}
          />
          <PipelineTile
            count={pipeline.needsResponse}
            label="Awaiting Your Response"
            meaning="Submitted cases where the referrer is waiting to hear back from you"
            implication="Respond within 2 hours to retain referrer trust"
            ctaLabel={pipeline.needsResponse > 0 ? 'Review & respond' : 'Pipeline clear'}
            href="/referrals?status=action_needed"
            variant={pipeline.needsResponse > 0 ? 'pending' : 'empty'}
          />
          <PipelineTile
            count={pipeline.inProgress}
            label="Active Cases"
            meaning="Accepted referrals currently being managed — patient arrived or procedure planned"
            implication="Keep referrers updated at each milestone to build loyalty"
            ctaLabel="View active cases"
            href="/referrals?status=active"
            variant={pipeline.inProgress > 0 ? 'active' : 'empty'}
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 2 — REFERRAL VOLUME
          Practice growth metrics with trend context
      ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionHeader
          label="Referral Volume"
          sub="Monthly case flow — your practice growth at a glance"
          cta="View all cases"
          href="/referrals"
          accent="bg-navy-800"
        />
        <div className="bg-white rounded-2xl border border-navy-800/8 overflow-hidden">

          {/* Top stats row */}
          <div className="grid grid-cols-4 divide-x divide-navy-800/8">

            {/* This month */}
            <div className="p-4">
              <div className="text-2xs text-navy-800/40 font-mono uppercase tracking-widest mb-2">This month</div>
              <div className="font-display text-4xl font-bold text-navy-800 leading-none">
                {volume.thisMonth}
              </div>
              <div className="text-xs text-navy-800/50 mt-1">cases received</div>
              <div className={`flex items-center gap-1 text-xs font-bold mt-2 ${
                monthTrend > 0 ? 'text-emerald-600' : monthTrend < 0 ? 'text-red-500' : 'text-navy-800/30'
              }`}>
                {monthTrend > 0 ? <TrendingUp size={11} /> : monthTrend < 0 ? <TrendingDown size={11} /> : null}
                <span>
                  {monthTrend > 0 ? `+${monthTrend} vs last month` :
                   monthTrend < 0 ? `${monthTrend} vs last month` : 'Same as last month'}
                </span>
              </div>
            </div>

            {/* Last month */}
            <div className="p-4">
              <div className="text-2xs text-navy-800/40 font-mono uppercase tracking-widest mb-2">Last month</div>
              <div className="font-display text-4xl font-bold text-navy-800/35 leading-none">
                {volume.lastMonth}
              </div>
              <div className="text-xs text-navy-800/30 mt-1">cases received</div>
              <div className="text-2xs text-navy-800/25 mt-2">Previous period baseline</div>
            </div>

            {/* YTD */}
            <div className="p-4">
              <div className="text-2xs text-navy-800/40 font-mono uppercase tracking-widest mb-2">
                YTD {new Date().getFullYear()}
              </div>
              <div className="font-display text-4xl font-bold text-navy-800 leading-none">
                {volume.ytd}
              </div>
              <div className="text-xs text-navy-800/50 mt-1">{volume.ytdLabel}</div>
              <div className={`flex items-center gap-1 text-xs font-bold mt-2 ${
                ytdTrend > 0 ? 'text-emerald-600' : ytdTrend < 0 ? 'text-red-500' : 'text-navy-800/30'
              }`}>
                {ytdTrend > 0 ? <TrendingUp size={11} /> : ytdTrend < 0 ? <TrendingDown size={11} /> : null}
                <span>
                  {ytdTrend > 0 ? `+${ytdTrend} vs last year` :
                   ytdTrend < 0 ? `${ytdTrend} vs last year` : 'Same as last year'}
                </span>
              </div>
            </div>

            {/* Acceptance rate */}
            <div className="p-4">
              <div className="text-2xs text-navy-800/40 font-mono uppercase tracking-widest mb-2">
                Acceptance rate
              </div>
              <div className={`font-display text-4xl font-bold leading-none ${
                volume.acceptanceRate >= 60 ? 'text-emerald-600' :
                volume.acceptanceRate >= 35 ? 'text-amber-600' : 'text-red-600'
              }`}>
                {volume.acceptanceRate > 0 ? `${volume.acceptanceRate}%` : '—'}
              </div>
              <div className="text-xs text-navy-800/50 mt-1">cases accepted</div>
              {volume.acceptanceRate > 0 && (
                <MetricBar
                  value={volume.acceptanceRate}
                  color={volume.acceptanceRate >= 60 ? 'bg-emerald-500' : volume.acceptanceRate >= 35 ? 'bg-amber-500' : 'bg-red-500'}
                />
              )}
            </div>
          </div>

          {/* 6-month sparkline */}
          <div className="px-5 pb-4 pt-2 border-t border-navy-800/6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-2xs text-navy-800/35 font-mono uppercase tracking-widest">
                6-month case flow
              </span>
              <span className="text-2xs text-navy-800/35">
                {volume.completedAllTime} completed all-time
              </span>
            </div>
            <SparkBars data={volume.trend} />
          </div>

          {/* Footer metrics */}
          <div className="flex items-center gap-0 border-t border-navy-800/6 divide-x divide-navy-800/6">
            <div className="flex items-center gap-3 px-5 py-3 flex-1">
              <Clock size={14} className="text-navy-800/30 flex-shrink-0" />
              <div>
                <div className="text-xs font-bold text-navy-800">
                  {volume.avgHoursToAccept ? `${volume.avgHoursToAccept}h` : '—'}
                </div>
                <div className="text-2xs text-navy-800/40">Avg. response time</div>
                <div className="text-2xs text-navy-800/30">Target: under 2 hours</div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-3 flex-1">
              <Activity size={14} className="text-navy-800/30 flex-shrink-0" />
              <div>
                <div className="text-xs font-bold text-navy-800">{volume.totalAllTime} total</div>
                <div className="text-2xs text-navy-800/40">Cases all time</div>
                <div className="text-2xs text-navy-800/30">{volume.completedAllTime} completed</div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-3 flex-1">
              <BarChart3 size={14} className="text-navy-800/30 flex-shrink-0" />
              <div>
                <div className="text-xs font-bold text-navy-800">{volume.lastYearYtd} last year</div>
                <div className="text-2xs text-navy-800/40">Same period comparison</div>
                <div className={`text-2xs font-semibold ${ytdTrend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {ytdTrend >= 0 ? `↑ Growing ${ytdTrend > 0 ? `+${ytdTrend}` : '(flat)'} YoY` : `↓ Down ${Math.abs(ytdTrend)} YoY`}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3 — REFERRER NETWORK
          Relationship health — most valuable long-term asset
      ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionHeader
          label="Referrer Network"
          sub="Your referring colleagues — the source of all new cases"
          cta="Manage network"
          href="/network"
          accent="bg-emerald-500"
        />
        <div className="bg-white rounded-2xl border border-navy-800/8 overflow-hidden">

          {/* Health score hero */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-navy-800/6">
            <div>
              <div className="text-2xs text-navy-800/40 font-mono uppercase tracking-widest mb-1">
                Network Health Score
              </div>
              <div className="flex items-end gap-2">
                <div className={`font-display text-5xl font-bold leading-none ${
                  network.healthScore >= 70 ? 'text-emerald-600' :
                  network.healthScore >= 40 ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {network.healthScore}
                </div>
                <div className="pb-1">
                  <span className="text-base text-navy-800/30 font-normal">/100</span>
                </div>
              </div>
              <div className={`inline-flex items-center gap-1.5 mt-2 text-xs font-semibold px-2.5 py-1 rounded-full ${
                network.healthScore >= 70 ? 'bg-emerald-100 text-emerald-700' :
                network.healthScore >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
              }`}>
                {network.healthScore >= 70 ? '✅ Healthy network' :
                 network.healthScore >= 40 ? '⚠️ Needs attention' : '🚨 At risk'}
              </div>
            </div>
            <div className="text-right pr-2">
              <div className="text-2xs text-navy-800/40 mb-1">
                {specialist.city} platform avg.
              </div>
              <div className="font-display text-3xl font-bold text-navy-800/35">
                {network.cityBenchmark}
              </div>
              <div className="text-2xs text-navy-800/30">active referrers benchmark</div>
              {network.active < network.cityBenchmark && (
                <div className="text-2xs text-amber-600 font-semibold mt-1">
                  {network.cityBenchmark - network.active} more needed to hit avg
                </div>
              )}
            </div>
          </div>

          {/* 5 status buckets */}
          <div className="flex gap-2 px-4 py-4">
            <NetworkBucket
              count={network.total}
              label="Total"
              sub="all colleagues"
              bg="bg-navy-800/5"
              text="text-navy-800"
              href="/network"
            />
            <NetworkBucket
              count={network.active}
              label="Active"
              sub="sending cases"
              bg="bg-emerald-50"
              text="text-emerald-700"
              href="/network?filter=active"
            />
            <NetworkBucket
              count={network.drifting}
              label="Drifting"
              sub="needs outreach"
              bg="bg-amber-50"
              text="text-amber-700"
              href="/network?filter=drifting"
            />
            <NetworkBucket
              count={network.silent}
              label="Silent"
              sub="at risk of loss"
              bg="bg-red-50"
              text="text-red-600"
              href="/network?filter=silent"
            />
            <NetworkBucket
              count={network.newReferrers}
              label="New"
              sub="recently added"
              bg="bg-blue-50"
              text="text-blue-700"
              href="/network?filter=new"
            />
          </div>

          {/* Engagement action row */}
          {network.plannedForEngagement > 0 ? (
            <div className="mx-4 mb-4 flex items-start justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-amber-900">
                    {network.plannedForEngagement} referrer{network.plannedForEngagement > 1 ? 's are' : ' is'} drifting or silent
                  </p>
                  <p className="text-xs text-amber-700/70 mt-0.5">
                    These colleagues have stopped sending cases — without outreach, they may disengage permanently and send cases to a competitor
                  </p>
                </div>
              </div>
              <button
                onClick={() => router.push('/network?filter=drifting')}
                className="flex items-center gap-1.5 bg-amber-500 text-white text-xs font-bold
                           px-3 py-2 rounded-xl hover:bg-amber-600 active:scale-95
                           transition-all flex-shrink-0 ml-3 mt-0.5"
              >
                Plan outreach <ArrowRight size={12} />
              </button>
            </div>
          ) : network.total > 0 ? (
            <div className="mx-4 mb-4 flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-600" />
                <span className="text-sm font-semibold text-emerald-800">
                  All referrer relationships are healthy
                </span>
              </div>
              <button
                onClick={() => router.push('/network/add')}
                className="flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-bold
                           px-3 py-2 rounded-xl hover:bg-emerald-700 active:scale-95 transition-all"
              >
                <Plus size={12} /> Grow network
              </button>
            </div>
          ) : (
            <div className="mx-4 mb-4 flex items-center justify-between bg-navy-50 border border-navy-800/10 rounded-xl px-4 py-3">
              <div>
                <p className="text-sm font-bold text-navy-800">Start building your referral network</p>
                <p className="text-xs text-navy-800/50 mt-0.5">Add colleagues who refer patients to you — track relationships and prevent drop-offs</p>
              </div>
              <button
                onClick={() => router.push('/network/add')}
                className="flex items-center gap-1.5 bg-navy-800 text-white text-xs font-bold
                           px-3 py-2 rounded-xl hover:bg-navy-900 active:scale-95 transition-all ml-3"
              >
                <Plus size={12} /> Add colleague
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4 — QUICK ACCESS
          One-click access to all clinical tools
      ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionHeader
          label="Clinical Tools"
          sub="Access your full suite of AI-powered modules"
          accent="bg-purple-500"
        />
        <div className="grid grid-cols-3 gap-2.5">
          {[
            {
              label:   'Referrals',
              sub:     'Manage all incoming cases',
              path:    '/referrals',
              icon:    FileText,
              color:   'bg-blue-50 text-blue-600',
              badge:   pipeline.needsResponse > 0 ? pipeline.needsResponse : null,
              badgeCl: 'bg-blue-600 text-white',
            },
            {
              label:   'Network',
              sub:     'Referrer relationships',
              path:    '/network',
              icon:    Users,
              color:   'bg-emerald-50 text-emerald-600',
              badge:   network.plannedForEngagement > 0 ? network.plannedForEngagement : null,
              badgeCl: 'bg-amber-500 text-white',
            },
            {
              label:   'Triage AI',
              sub:     'Smart patient triage',
              path:    '/triage/sessions',
              icon:    Zap,
              color:   'bg-teal-50 text-teal-600',
              badge:   null,
              badgeCl: '',
            },
            {
              label:   'Appointments',
              sub:     'Scheduling & calendar',
              path:    '/appointments',
              icon:    Calendar,
              color:   'bg-purple-50 text-purple-600',
              badge:   null,
              badgeCl: '',
            },
            {
              label:   'Synthesis',
              sub:     'AI case summaries',
              path:    '/synthesis',
              icon:    FlaskConical,
              color:   'bg-amber-50 text-amber-600',
              badge:   null,
              badgeCl: '',
            },
            {
              label:   'Transcription',
              sub:     'Voice-to-clinical notes',
              path:    '/transcription',
              icon:    Mic,
              color:   'bg-navy-50 text-navy-700',
              badge:   null,
              badgeCl: '',
            },
          ].map(m => (
            <button key={m.path} onClick={() => router.push(m.path)}
              className="bg-white rounded-2xl border border-navy-800/8 p-4 flex items-start gap-3
                         hover:shadow-clinical-md hover:border-navy-800/15
                         active:scale-95 transition-all text-left relative overflow-hidden">
              {/* Badge */}
              {m.badge !== null && (
                <div className={`absolute top-3 right-3 w-5 h-5 rounded-full text-2xs font-bold
                                flex items-center justify-center ${m.badgeCl}`}>
                  {m.badge}
                </div>
              )}
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${m.color}`}>
                <m.icon size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-navy-800 leading-tight">{m.label}</div>
                <div className="text-2xs text-navy-800/45 mt-0.5 leading-tight">{m.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}
