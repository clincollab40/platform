'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Info, ArrowRight, Zap, TrendingUp } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
export type InsightItem = {
  text: string
  severity: 'positive' | 'warning' | 'critical' | 'info'
  cta?: { label: string; href: string }   // per-insight action button
}

export type InsightData = {
  moduleTitle: string
  score: number
  scoreLabel: string
  scoreColor: 'green' | 'amber' | 'red' | 'blue' | 'purple'
  insights: InsightItem[]
  benchmark?: string
  cta?: { label: string; href: string }
  secondaryCta?: { label: string; href: string }
}

// ── Score ring colour map ─────────────────────────────────────────────────────
const COLOR_MAP = {
  green:  { stroke: '#16a34a', textColor: 'text-emerald-700', panelBg: 'bg-emerald-50'  },
  amber:  { stroke: '#d97706', textColor: 'text-amber-700',   panelBg: 'bg-amber-50'    },
  red:    { stroke: '#dc2626', textColor: 'text-red-600',     panelBg: 'bg-red-50'       },
  blue:   { stroke: '#1A5276', textColor: 'text-navy-800',    panelBg: 'bg-navy-50'      },
  purple: { stroke: '#7c3aed', textColor: 'text-purple-700',  panelBg: 'bg-purple-50'   },
}

// ── Per-severity card styles ───────────────────────────────────────────────────
const SEVERITY_STYLE = {
  critical: {
    border: 'border-l-4 border-l-red-500',
    bg: 'bg-red-50',
    labelColor: 'text-red-600',
    labelText: '🔴 CRITICAL',
    textColor: 'text-red-900',
    ctaClass: 'bg-red-600 hover:bg-red-700 text-white',
    icon: <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />,
  },
  warning: {
    border: 'border-l-4 border-l-amber-500',
    bg: 'bg-amber-50',
    labelColor: 'text-amber-700',
    labelText: '⚠️ ACTION NEEDED',
    textColor: 'text-amber-900',
    ctaClass: 'bg-amber-500 hover:bg-amber-600 text-white',
    icon: <AlertCircle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />,
  },
  positive: {
    border: 'border-l-4 border-l-emerald-500',
    bg: 'bg-emerald-50',
    labelColor: 'text-emerald-700',
    labelText: '✅ ON TRACK',
    textColor: 'text-emerald-900',
    ctaClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    icon: <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />,
  },
  info: {
    border: 'border-l-4 border-l-navy-800/30',
    bg: 'bg-navy-800/5',
    labelColor: 'text-navy-800/60',
    labelText: '💡 INSIGHT',
    textColor: 'text-navy-800/80',
    ctaClass: 'bg-navy-800 hover:bg-navy-900 text-white',
    icon: <Info size={14} className="text-navy-800/40 flex-shrink-0 mt-0.5" />,
  },
}

// ── Animated score ring ───────────────────────────────────────────────────────
function ScoreRing({ score, color }: { score: number; color: keyof typeof COLOR_MAP }) {
  const circleRef     = useRef<SVGCircleElement>(null)
  const radius        = 38
  const circumference = 2 * Math.PI * radius
  const offset        = circumference - (score / 100) * circumference

  useEffect(() => {
    if (!circleRef.current) return
    circleRef.current.style.strokeDashoffset = String(circumference)
    const frame = requestAnimationFrame(() => {
      if (!circleRef.current) return
      circleRef.current.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)'
      circleRef.current.style.strokeDashoffset = String(offset)
    })
    return () => cancelAnimationFrame(frame)
  }, [score, offset, circumference])

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
        <circle cx="44" cy="44" r={radius} fill="none"
          stroke="rgba(26,82,118,0.10)" strokeWidth="8" />
        <circle ref={circleRef} cx="44" cy="44" r={radius}
          fill="none" stroke={COLOR_MAP[color].stroke} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={circumference}
          strokeDashoffset={circumference} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-bold text-navy-800 leading-none">{score}</span>
        <span className="text-2xs text-navy-800/40">/100</span>
      </div>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────
export default function InsightPanel({ data }: { data: InsightData }) {
  const router = useRouter()
  const colors = COLOR_MAP[data.scoreColor]

  // Critical and warning always surface first
  const severityOrder = { critical: 0, warning: 1, positive: 2, info: 3 }
  const sorted = [...data.insights].sort(
    (a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4)
  )

  return (
    <aside className="insight-panel flex flex-col overflow-hidden">

      {/* ── Branded header ─────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 flex-shrink-0"
           style={{ background: 'linear-gradient(135deg, #0A1628 0%, #1A3A5C 100%)' }}>
        <div className="flex items-center gap-2 mb-0.5">
          <Zap size={13} className="text-amber-400 flex-shrink-0" />
          <span className="text-xs font-bold text-white tracking-wide">
            Actionable Insights
          </span>
        </div>
        <div className="text-2xs text-white/45 font-mono uppercase tracking-widest">
          Powered by AI · {data.moduleTitle}
        </div>
      </div>

      {/* ── Score band ─────────────────────────────────────────────────── */}
      <div className={`${colors.panelBg} px-4 py-4 flex items-center gap-4 border-b border-navy-800/8 flex-shrink-0`}>
        <ScoreRing score={data.score} color={data.scoreColor} />
        <div>
          <div className={`font-display text-3xl font-bold ${colors.textColor} leading-none`}>
            {data.score}
          </div>
          <div className="text-sm font-semibold text-navy-800/70 mt-0.5 leading-tight">
            {data.scoreLabel}
          </div>
          <div className="text-2xs text-navy-800/35 mt-0.5">out of 100</div>
        </div>
      </div>

      {/* ── Insight cards (scrollable) ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 pt-3 space-y-2.5">
          {sorted.map((item, i) => {
            const s = SEVERITY_STYLE[item.severity]
            return (
              <div key={i} className={`rounded-xl ${s.bg} ${s.border} p-3`}>
                <div className={`text-2xs font-bold uppercase tracking-wide ${s.labelColor} mb-1.5 flex items-center gap-1.5`}>
                  {s.icon}
                  {s.labelText}
                </div>
                <p className={`text-xs font-medium leading-relaxed ${s.textColor} mb-2`}>
                  {item.text}
                </p>
                {item.cta && (
                  <button
                    onClick={() => router.push(item.cta!.href)}
                    className={`w-full flex items-center justify-center gap-1.5 text-xs font-bold
                                px-3 py-2 rounded-lg transition-colors active:scale-95 ${s.ctaClass}`}
                  >
                    {item.cta.label} <ArrowRight size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Benchmark */}
        {data.benchmark && (
          <div className="mx-3 mt-2.5 mb-1 rounded-xl bg-navy-800/5 border border-navy-800/8 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp size={11} className="text-navy-800/40" />
              <span className="text-2xs font-bold text-navy-800/40 uppercase tracking-widest">Platform Benchmark</span>
            </div>
            <p className="text-xs text-navy-800/55 leading-relaxed">{data.benchmark}</p>
          </div>
        )}

        {/* Primary module-level CTAs */}
        {(data.cta || data.secondaryCta) && (
          <div className="px-3 pt-2.5 pb-4 space-y-2">
            {data.cta && (
              <button
                onClick={() => router.push(data.cta!.href)}
                className="w-full flex items-center justify-center gap-2 bg-navy-800
                           text-white rounded-xl px-4 py-3 text-sm font-bold
                           hover:bg-navy-900 active:scale-95 transition-all shadow-sm"
              >
                {data.cta.label} <ArrowRight size={14} />
              </button>
            )}
            {data.secondaryCta && (
              <button
                onClick={() => router.push(data.secondaryCta!.href)}
                className="w-full flex items-center justify-center gap-2
                           border-2 border-navy-800/25 text-navy-800 rounded-xl
                           px-4 py-2.5 text-sm font-semibold
                           hover:bg-navy-50 hover:border-navy-800/50 transition-all"
              >
                {data.secondaryCta.label} <ArrowRight size={14} />
              </button>
            )}
          </div>
        )}
      </div>

    </aside>
  )
}
