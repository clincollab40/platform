'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle, CheckCircle2, Info, ArrowRight,
  TrendingUp, Bell, ChevronRight,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
export type InsightItem = {
  text:     string
  severity: 'positive' | 'warning' | 'critical' | 'info'
  cta?:     { label: string; href: string }
}

export type InsightData = {
  moduleTitle:    string
  score:          number
  scoreLabel:     string
  scoreColor:     'green' | 'amber' | 'red' | 'blue' | 'purple'
  insights:       InsightItem[]
  benchmark?:     string
  cta?:           { label: string; href: string }
  secondaryCta?:  { label: string; href: string }
}

// ── Color config ──────────────────────────────────────────────────────────────
const SCORE_COLOR = {
  green:  { ring: '#16a34a', bg: 'bg-emerald-50',  text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-800', label: 'Excellent'  },
  amber:  { ring: '#d97706', bg: 'bg-amber-50',    text: 'text-amber-700',   badge: 'bg-amber-100  text-amber-800',  label: 'Needs work' },
  red:    { ring: '#dc2626', bg: 'bg-red-50',       text: 'text-red-600',     badge: 'bg-red-100    text-red-800',    label: 'Critical'   },
  blue:   { ring: '#1A5276', bg: 'bg-blue-50',      text: 'text-navy-800',    badge: 'bg-navy-50    text-navy-800',   label: 'Active'     },
  purple: { ring: '#7c3aed', bg: 'bg-purple-50',   text: 'text-purple-700',  badge: 'bg-purple-100 text-purple-800', label: 'Building'   },
}

// ── Severity config ───────────────────────────────────────────────────────────
const SEV = {
  critical: {
    wrap:   'bg-red-50 border border-red-200 rounded-xl',
    header: 'bg-red-600 text-white rounded-t-xl px-3 py-1.5 flex items-center gap-1.5',
    tag:    '🚨 Urgent action needed',
    body:   'text-red-900 font-medium',
    cta:    'w-full bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold rounded-lg px-4 py-2.5 text-sm flex items-center justify-center gap-2 transition-all mt-3',
    icon:   <AlertCircle size={13} className="flex-shrink-0" />,
  },
  warning: {
    wrap:   'bg-amber-50 border border-amber-200 rounded-xl',
    header: 'bg-amber-500 text-white rounded-t-xl px-3 py-1.5 flex items-center gap-1.5',
    tag:    '⚠️  Action needed',
    body:   'text-amber-900 font-medium',
    cta:    'w-full bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold rounded-lg px-4 py-2.5 text-sm flex items-center justify-center gap-2 transition-all mt-3',
    icon:   <AlertCircle size={13} className="flex-shrink-0" />,
  },
  positive: {
    wrap:   'bg-emerald-50 border border-emerald-200 rounded-xl',
    header: 'bg-emerald-600 text-white rounded-t-xl px-3 py-1.5 flex items-center gap-1.5',
    tag:    '✅ On track',
    body:   'text-emerald-900 font-medium',
    cta:    'w-full bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-lg px-4 py-2.5 text-sm flex items-center justify-center gap-2 transition-all mt-3',
    icon:   <CheckCircle2 size={13} className="flex-shrink-0" />,
  },
  info: {
    wrap:   'bg-navy-50 border border-navy-800/12 rounded-xl',
    header: 'bg-navy-800 text-white rounded-t-xl px-3 py-1.5 flex items-center gap-1.5',
    tag:    '💡 Insight',
    body:   'text-navy-800/80 font-medium',
    cta:    'w-full bg-navy-800 hover:bg-navy-900 active:scale-95 text-white font-bold rounded-lg px-4 py-2.5 text-sm flex items-center justify-center gap-2 transition-all mt-3',
    icon:   <Info size={13} className="flex-shrink-0" />,
  },
}

// ── Animated score ring ───────────────────────────────────────────────────────
function ScoreRing({ score, color }: { score: number; color: keyof typeof SCORE_COLOR }) {
  const ref   = useRef<SVGCircleElement>(null)
  const r     = 30
  const circ  = 2 * Math.PI * r
  const off   = circ - (score / 100) * circ
  const cfg   = SCORE_COLOR[color]

  useEffect(() => {
    if (!ref.current) return
    ref.current.style.strokeDashoffset = String(circ)
    const f = requestAnimationFrame(() => {
      if (!ref.current) return
      ref.current.style.transition = 'stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)'
      ref.current.style.strokeDashoffset = String(off)
    })
    return () => cancelAnimationFrame(f)
  }, [score, off, circ])

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(26,82,118,0.10)" strokeWidth="6" />
        <circle ref={ref} cx="36" cy="36" r={r} fill="none"
          stroke={cfg.ring} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-display text-xl font-bold leading-none ${cfg.text}`}>{score}</span>
        <span className="text-2xs text-navy-800/35 leading-none mt-0.5">/100</span>
      </div>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────
export default function InsightPanel({ data }: { data: InsightData }) {
  const router = useRouter()
  const cfg    = SCORE_COLOR[data.scoreColor]

  // Show max 3 insights, critical first
  const ORDER   = { critical: 0, warning: 1, positive: 2, info: 3 }
  const sorted  = [...data.insights]
    .sort((a, b) => (ORDER[a.severity] ?? 4) - (ORDER[b.severity] ?? 4))
    .slice(0, 3)

  const hasCritical = sorted.some(i => i.severity === 'critical')
  const hasWarning  = sorted.some(i => i.severity === 'warning')

  return (
    <aside className="insight-panel flex flex-col overflow-hidden select-none">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3"
           style={{ background: 'linear-gradient(160deg,#07111F 0%,#0F2744 100%)' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Bell size={14} className={hasCritical ? 'text-red-400 animate-pulse' : hasWarning ? 'text-amber-400' : 'text-emerald-400'} />
            <span className="text-xs font-bold text-white tracking-wide">AI Practice Advisor</span>
          </div>
          <span className="text-2xs text-white/35 font-mono">{data.moduleTitle}</span>
        </div>
        <p className="text-xs text-white/45 leading-relaxed">
          {hasCritical
            ? 'Urgent items require your attention right now.'
            : hasWarning
            ? 'A few things need your attention today.'
            : 'Your practice looks healthy. Here\'s what to do next.'}
        </p>
      </div>

      {/* ── Score summary ─────────────────────────────────────────────── */}
      <div className={`flex-shrink-0 ${cfg.bg} px-4 py-3 flex items-center gap-4 border-b border-navy-800/8`}>
        <ScoreRing score={data.score} color={data.scoreColor} />
        <div className="flex-1 min-w-0">
          <div className={`text-2xl font-display font-bold leading-none ${cfg.text}`}>
            {data.scoreLabel}
          </div>
          <div className="text-xs text-navy-800/50 mt-1 leading-tight">
            Practice health score
          </div>
          <span className={`inline-block mt-1.5 text-2xs font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>
            {cfg.label}
          </span>
        </div>
      </div>

      {/* ── Insight cards ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 space-y-3 pb-2">

        {sorted.length === 0 ? (
          <div className="text-center py-8 text-sm text-navy-800/40">
            No insights available yet
          </div>
        ) : (
          sorted.map((item, i) => {
            const s = SEV[item.severity]
            return (
              <div key={i} className={s.wrap}>
                {/* Card header band */}
                <div className={s.header}>
                  {s.icon}
                  <span className="text-xs font-bold tracking-wide">{s.tag}</span>
                </div>

                {/* Card body */}
                <div className="px-3 py-3">
                  <p className={`text-sm leading-snug ${s.body}`}>{item.text}</p>

                  {item.cta && (
                    <button
                      onClick={() => router.push(item.cta!.href)}
                      className={s.cta}
                    >
                      {item.cta.label}
                      <ArrowRight size={14} className="flex-shrink-0" />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}

        {/* Platform benchmark */}
        {data.benchmark && (
          <div className="rounded-xl bg-navy-800/4 border border-navy-800/10 px-3 py-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp size={12} className="text-navy-800/40 flex-shrink-0" />
              <span className="text-2xs font-bold text-navy-800/40 uppercase tracking-widest">
                Platform benchmark
              </span>
            </div>
            <p className="text-xs text-navy-800/60 leading-relaxed">{data.benchmark}</p>
          </div>
        )}
      </div>

      {/* ── Primary CTAs ─────────────────────────────────────────────── */}
      {(data.cta || data.secondaryCta) && (
        <div className="flex-shrink-0 px-3 pb-4 pt-2 space-y-2 border-t border-navy-800/8">
          {data.cta && (
            <button
              onClick={() => router.push(data.cta!.href)}
              className="w-full flex items-center justify-center gap-2 bg-navy-800
                         text-white rounded-xl px-4 py-3 text-sm font-bold
                         hover:bg-navy-900 active:scale-95 transition-all shadow-sm"
            >
              {data.cta.label} <ArrowRight size={15} />
            </button>
          )}
          {data.secondaryCta && (
            <button
              onClick={() => router.push(data.secondaryCta!.href)}
              className="w-full flex items-center justify-center gap-2
                         border-2 border-navy-800/20 text-navy-800 rounded-xl
                         px-4 py-2.5 text-sm font-semibold
                         hover:bg-navy-50 hover:border-navy-800/40 transition-all"
            >
              {data.secondaryCta.label} <ChevronRight size={15} />
            </button>
          )}
        </div>
      )}

    </aside>
  )
}
