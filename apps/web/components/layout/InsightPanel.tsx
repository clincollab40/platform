'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Info, ArrowRight, Zap } from 'lucide-react'

export type InsightItem = {
  text: string
  severity: 'positive' | 'warning' | 'critical' | 'info'
}

export type InsightData = {
  moduleTitle: string
  score: number          // 0–100
  scoreLabel: string     // e.g. "Network Health"
  scoreColor: 'green' | 'amber' | 'red' | 'blue' | 'purple'
  insights: InsightItem[]
  benchmark?: string
  cta?: { label: string; href: string }
  secondaryCta?: { label: string; href: string }
}

const COLOR_MAP = {
  green:  { stroke: '#1E8449', bg: 'bg-forest-50',  text: 'text-forest-700',  ring: '#1E8449' },
  amber:  { stroke: '#D97706', bg: 'bg-amber-50',   text: 'text-amber-700',   ring: '#D97706' },
  red:    { stroke: '#DC2626', bg: 'bg-red-50',      text: 'text-red-600',     ring: '#DC2626' },
  blue:   { stroke: '#1A5276', bg: 'bg-navy-50',     text: 'text-navy-800',    ring: '#1A5276' },
  purple: { stroke: '#7C3AED', bg: 'bg-purple-50',   text: 'text-purple-700',  ring: '#7C3AED' },
}

const SEVERITY_ICON = {
  positive: <CheckCircle2 size={14} className="text-forest-700 flex-shrink-0" />,
  warning:  <AlertCircle  size={14} className="text-amber-500 flex-shrink-0" />,
  critical: <AlertCircle  size={14} className="text-red-500 flex-shrink-0" />,
  info:     <Info         size={14} className="text-navy-800/40 flex-shrink-0" />,
}

const SEVERITY_TEXT = {
  positive: 'text-forest-800',
  warning:  'text-amber-900',
  critical: 'text-red-800',
  info:     'text-ink/70',
}

function ScoreRing({ score, color }: { score: number; color: keyof typeof COLOR_MAP }) {
  const circleRef = useRef<SVGCircleElement>(null)
  const radius    = 40
  const circumference = 2 * Math.PI * radius
  const offset   = circumference - (score / 100) * circumference

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

  const { stroke } = COLOR_MAP[color]

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
        {/* Track */}
        <circle cx="48" cy="48" r={radius}
          fill="none" stroke="rgba(26,82,118,0.08)" strokeWidth="8" />
        {/* Progress */}
        <circle ref={circleRef} cx="48" cy="48" r={radius}
          fill="none" stroke={stroke} strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-medium text-ink leading-none">{score}</span>
        <span className="text-2xs text-ink/40 font-mono">/100</span>
      </div>
    </div>
  )
}

export default function InsightPanel({ data }: { data: InsightData }) {
  const router = useRouter()
  const colors = COLOR_MAP[data.scoreColor]

  return (
    <aside className="insight-panel">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-navy-800/6">
        <div className="flex items-center gap-2 mb-1">
          <Zap size={13} className="text-amber-500" />
          <span className="text-2xs font-mono uppercase tracking-widest text-ink/40">AI Insight</span>
        </div>
        <div className="text-sm font-semibold text-ink">{data.moduleTitle}</div>
      </div>

      {/* Score ring */}
      <div className={`${colors.bg} px-5 py-5 flex flex-col items-center gap-2`}>
        <ScoreRing score={data.score} color={data.scoreColor} />
        <div className={`text-xs font-medium ${colors.text} text-center`}>{data.scoreLabel}</div>
      </div>

      {/* Insights list */}
      <div className="px-5 py-4 space-y-3 border-b border-navy-800/6">
        {data.insights.map((item, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <div className="mt-0.5">{SEVERITY_ICON[item.severity]}</div>
            <p className={`text-xs leading-relaxed ${SEVERITY_TEXT[item.severity]}`}>{item.text}</p>
          </div>
        ))}
      </div>

      {/* Benchmark */}
      {data.benchmark && (
        <div className="px-5 py-4 border-b border-navy-800/6">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp size={12} className="text-navy-800/40" />
            <span className="text-2xs font-mono uppercase tracking-widest text-ink/40">Peer Benchmark</span>
          </div>
          <p className="text-xs text-ink/60 leading-relaxed">{data.benchmark}</p>
        </div>
      )}

      {/* CTAs */}
      {(data.cta || data.secondaryCta) && (
        <div className="px-5 py-4 space-y-2">
          {data.cta && (
            <button
              onClick={() => router.push(data.cta!.href)}
              className="w-full flex items-center justify-center gap-2 bg-navy-800 text-white
                         rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-navy-900 transition-colors"
            >
              {data.cta.label}
              <ArrowRight size={14} />
            </button>
          )}
          {data.secondaryCta && (
            <button
              onClick={() => router.push(data.secondaryCta!.href)}
              className="w-full flex items-center justify-center gap-2 border border-navy-800/15
                         text-navy-800 rounded-xl px-4 py-2.5 text-sm font-medium
                         hover:bg-navy-50 transition-colors"
            >
              {data.secondaryCta.label}
            </button>
          )}
        </div>
      )}

      {/* Footer note */}
      <div className="px-5 pb-5 mt-auto">
        <p className="text-2xs text-ink/25 leading-relaxed font-mono">
          Insights refreshed on each visit. Powered by ClinCollab AI.
        </p>
      </div>
    </aside>
  )
}
