'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  TrendingUp, Users, FileText, Calendar, AlertTriangle,
  ArrowRight, Plus, Activity, Clock, ChevronRight,
} from 'lucide-react'

type Specialist = {
  id: string
  name: string
  specialty: string
  city: string
  status: string
  role: string
  last_active_at: string | null
  created_at: string
  specialist_profiles?: {
    designation?: string
    sub_specialty?: string
    hospitals?: string[]
    years_experience?: number
    photo_url?: string
    completeness_pct: number
  } | null
}

type Peer = {
  id: string
  peer_name: string
  peer_city: string
  peer_specialty?: string | null
  status: string
  last_referral_at: string | null
  days_since_last?: number | null
  seeded_at: string
}

type Props = {
  specialist: Specialist
  peers: Peer[]
  isNewlyOnboarded: boolean
  userPhoto?: string
}

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

const CITY_BENCHMARK: Record<string, number> = {
  Hyderabad: 14, Bengaluru: 16, Mumbai: 18, 'Delhi / NCR': 17,
  Chennai: 13, Kolkata: 12, Pune: 14, Ahmedabad: 12, default: 11,
}

function peerStatus(p: Peer): 'new' | 'active' | 'drifting' | 'silent' {
  if (!p.last_referral_at) return 'new'
  const d = p.days_since_last ?? 999
  if (d < 30) return 'active'
  if (d < 90) return 'drifting'
  return 'silent'
}

const STATUS_PILL: Record<string, string> = {
  active:   'bg-forest-50 text-forest-700',
  new:      'bg-blue-50 text-blue-700',
  drifting: 'bg-amber-50 text-amber-700',
  silent:   'bg-red-50 text-red-600',
}

function MetricCard({
  label, value, sub, delta, deltaUp, icon, color, onClick
}: {
  label: string; value: string | number; sub?: string
  delta?: string; deltaUp?: boolean
  icon: React.ReactNode; color: string; onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`metric-card text-left hover:shadow-clinical-md transition-all ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
        {icon}
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
      {sub && <div className="text-xs text-ink/35">{sub}</div>}
      {delta && (
        <div className={deltaUp ? 'metric-delta-up' : 'metric-delta-down'}>
          {deltaUp ? '↑' : '↓'} {delta}
        </div>
      )}
    </button>
  )
}

function PeerRow({ peer, onClick }: { peer: Peer; onClick: () => void }) {
  const status = peerStatus(peer)
  const daysSince = peer.days_since_last
  const lastLabel = !peer.last_referral_at
    ? 'No referral recorded yet'
    : daysSince === 0 ? 'Active today'
    : daysSince === 1 ? 'Active yesterday'
    : `${daysSince}d ago`

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-navy-50/60 transition-colors text-left group"
    >
      <div className="w-9 h-9 rounded-xl bg-navy-800/6 flex items-center justify-center flex-shrink-0">
        <span className="text-sm font-semibold text-navy-800">
          {peer.peer_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink truncate">{peer.peer_name}</span>
          <span className={`text-2xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_PILL[status]}`}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </div>
        <div className="text-xs text-ink/40 truncate mt-0.5">
          {peer.peer_specialty ? `${peer.peer_specialty} · ` : ''}{peer.peer_city} · {lastLabel}
        </div>
      </div>
      <ChevronRight size={15} className="text-ink/20 flex-shrink-0 group-hover:text-ink/40 transition-colors" />
    </button>
  )
}

// Module quick access cards
const MODULES = [
  { label: 'Referrals',     path: '/referrals',             color: 'bg-navy-50 text-navy-800',    icon: <FileText size={18} /> },
  { label: 'Triage',        path: '/triage/sessions',       color: 'bg-teal-50 text-teal-700',    icon: <Activity size={18} /> },
  { label: 'Appointments',  path: '/appointments',          color: 'bg-forest-50 text-forest-700',icon: <Calendar size={18} /> },
  { label: 'Synthesis',     path: '/synthesis',             color: 'bg-purple-50 text-purple-700',icon: <TrendingUp size={18} /> },
  { label: 'Transcription', path: '/transcription',         color: 'bg-amber-50 text-amber-700',  icon: <Clock size={18} /> },
  { label: 'Chatbot',       path: '/chatbot/config',        color: 'bg-blue-50 text-blue-700',    icon: <Activity size={18} /> },
]

export default function DashboardClient({ specialist, peers, isNewlyOnboarded, userPhoto }: Props) {
  const router = useRouter()
  const [dismissedAha, setDismissedAha] = useState(false)

  const activePeers   = peers.filter(p => peerStatus(p) === 'active')
  const driftingPeers = peers.filter(p => peerStatus(p) === 'drifting')
  const silentPeers   = peers.filter(p => peerStatus(p) === 'silent')
  const newPeers      = peers.filter(p => peerStatus(p) === 'new')

  const benchmark  = CITY_BENCHMARK[specialist.city] ?? CITY_BENCHMARK.default
  const networkGap = Math.max(0, benchmark - peers.length)
  const firstName  = specialist.name.split(' ').find(p => p.length > 1) ?? specialist.name.split(' ')[0]

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })()

  return (
    <div className="space-y-6 max-w-4xl">

      {/* ── Page header ─────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">
            {isNewlyOnboarded ? `Welcome to ClinCollab, ${firstName}` : `${greeting}, ${firstName}`}
          </h1>
          <p className="page-subtitle">
            {SPECIALTY_LABEL[specialist.specialty] ?? specialist.specialty} · {specialist.city}
            {specialist.role === 'admin' && (
              <span className="ml-2 text-2xs font-mono uppercase tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Admin</span>
            )}
          </p>
        </div>
        <button
          onClick={() => router.push('/network/add')}
          className="hidden sm:flex items-center gap-2 btn-secondary text-sm py-2 px-4"
        >
          <Plus size={15} /> Add colleague
        </button>
      </div>

      {/* ── Aha moment banner ───────────────────────── */}
      {isNewlyOnboarded && !dismissedAha && peers.length > 0 && (
        <div
          className="rounded-2xl p-5 relative overflow-hidden animate-slide-up"
          style={{ background: 'linear-gradient(135deg, #0A1628 0%, #1A5276 100%)' }}
        >
          <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10"
            style={{ background: 'radial-gradient(ellipse at right, rgba(93,173,226,0.6), transparent)' }} />
          <div className="relative">
            <div className="text-2xs font-mono uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.40)' }}>
              Practice Intelligence
            </div>
            <p className="text-sm text-white leading-relaxed mb-3 max-w-lg">
              You've seeded <strong>{peers.length} colleague{peers.length !== 1 ? 's' : ''}</strong> into your network.
              {networkGap > 0 && <> Adding <strong>{networkGap} more</strong> reaches the {specialist.city} benchmark of {benchmark} active referrers.</>}
              {' '}Specialists with mapped networks see <strong>34% higher referral growth</strong>.
            </p>
            <div className="flex items-center gap-3">
              <button onClick={() => router.push('/network')}
                className="text-xs font-medium text-white bg-white/15 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                View network <ArrowRight size={12} />
              </button>
              <button onClick={() => setDismissedAha(true)}
                className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI metric cards ─────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Active Referrers"
          value={activePeers.length}
          sub={`of ${peers.length} total`}
          icon={<Users size={18} />}
          color="bg-forest-50 text-forest-700"
          onClick={() => router.push('/network?filter=active')}
        />
        <MetricCard
          label="Network Score"
          value={peers.length === 0 ? '—' : Math.round((activePeers.length / Math.max(peers.length, 1)) * 100)}
          sub={peers.length > 0 ? '% active' : 'Add colleagues'}
          icon={<Activity size={18} />}
          color="bg-navy-50 text-navy-800"
        />
        <MetricCard
          label="Need Attention"
          value={driftingPeers.length + silentPeers.length}
          sub="drifting or silent"
          icon={<AlertTriangle size={18} />}
          color={driftingPeers.length + silentPeers.length > 0 ? 'bg-amber-50 text-amber-600' : 'bg-forest-50 text-forest-700'}
          onClick={() => router.push('/network?filter=drifting')}
        />
        <MetricCard
          label="vs. City Avg"
          value={peers.length === 0 ? '—' : peers.length >= benchmark ? `+${peers.length - benchmark}` : `-${benchmark - peers.length}`}
          sub={`${specialist.city} avg: ${benchmark}`}
          deltaUp={peers.length >= benchmark}
          delta={peers.length > 0 ? `vs ${benchmark} avg` : undefined}
          icon={<TrendingUp size={18} />}
          color="bg-clinical-blue/10 text-navy-800"
        />
      </div>

      {/* ── Main content grid ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Peer network — wider column */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-navy-800/8 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-navy-800/6">
            <div>
              <div className="data-label mb-0.5">Clinical Colleagues</div>
              <div className="text-xs text-ink/40">{peers.length} in your network</div>
            </div>
            <div className="flex items-center gap-2">
              {/* Benchmark bar */}
              {peers.length > 0 && (
                <div className="flex items-center gap-2 mr-2">
                  <div className="w-20 h-1.5 bg-navy-800/8 rounded-full overflow-hidden">
                    <div className="h-full bg-navy-800 rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(100, (peers.length / benchmark) * 100)}%` }} />
                  </div>
                  <span className="text-2xs text-ink/35 font-mono">{peers.length}/{benchmark}</span>
                </div>
              )}
              <button onClick={() => router.push('/network')}
                className="text-xs font-medium text-navy-800/60 hover:text-navy-800 transition-colors flex items-center gap-1">
                All <ChevronRight size={13} />
              </button>
            </div>
          </div>

          {peers.length > 0 ? (
            <div className="p-2">
              {peers.slice(0, 6).map(peer => (
                <PeerRow key={peer.id} peer={peer}
                  onClick={() => router.push(`/network/${peer.id}`)} />
              ))}
              {peers.length > 6 && (
                <button onClick={() => router.push('/network')}
                  className="w-full text-center text-xs py-3 transition-colors"
                  style={{ color: 'rgba(13,27,42,0.35)' }}>
                  View all {peers.length} colleagues
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-navy-800/5 flex items-center justify-center mb-4">
                <Users size={24} className="text-navy-800/30" />
              </div>
              <h3 className="font-display text-lg text-ink mb-2">Build your peer network</h3>
              <p className="text-sm text-ink/45 mb-5 max-w-xs leading-relaxed">
                Add the colleagues who refer cases to you. ClinCollab will track engagement and alert you when relationships drift.
              </p>
              <button onClick={() => router.push('/network/add')} className="btn-primary text-sm py-2.5 px-5">
                Add first colleague
              </button>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-4">

          {/* Alert card */}
          {silentPeers.length > 0 && (
            <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-amber-900 mb-1">
                    {silentPeers.length} silent referrer{silentPeers.length !== 1 ? 's' : ''}
                  </div>
                  <p className="text-xs text-amber-800/70 leading-relaxed mb-2">
                    {silentPeers[0].peer_name}{silentPeers.length > 1 ? ` and ${silentPeers.length - 1} other${silentPeers.length > 2 ? 's' : ''}` : ''}{' '}
                    {silentPeers.length === 1 ? 'has' : 'have'} not referred in 90+ days.
                  </p>
                  <button onClick={() => router.push('/network?filter=silent')}
                    className="text-xs font-medium text-amber-800 hover:text-amber-900 transition-colors flex items-center gap-1">
                    Re-engage now <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Synthesis quick-access */}
          <button
            onClick={() => router.push('/synthesis')}
            className="w-full bg-white rounded-2xl border border-navy-800/8 p-4 text-left hover:shadow-clinical-md transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <TrendingUp size={18} className="text-purple-600" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-ink mb-0.5">360° Synthesis</div>
                <div className="text-xs text-ink/45 leading-relaxed">Pre-consultation briefs from all patient data. Ready before they walk in.</div>
              </div>
              <ChevronRight size={15} className="text-ink/20 group-hover:text-ink/40 mt-0.5 flex-shrink-0 transition-colors" />
            </div>
          </button>

          {/* Profile completeness */}
          {(specialist.specialist_profiles?.completeness_pct ?? 0) < 70 && (
            <button
              onClick={() => router.push('/profile')}
              className="w-full bg-white rounded-2xl border border-navy-800/8 p-4 text-left hover:shadow-clinical-md transition-all group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-ink">Complete your profile</div>
                <span className="text-xs font-mono text-ink/40">
                  {specialist.specialist_profiles?.completeness_pct ?? 0}%
                </span>
              </div>
              <div className="h-1.5 bg-navy-800/8 rounded-full overflow-hidden mb-2">
                <div className="h-full bg-navy-800 rounded-full transition-all duration-700"
                  style={{ width: `${specialist.specialist_profiles?.completeness_pct ?? 0}%` }} />
              </div>
              <p className="text-xs text-ink/45 leading-relaxed">
                Complete profiles receive 34% more direct referrals. Add hospital affiliation to unlock.
              </p>
            </button>
          )}
        </div>
      </div>

      {/* ── Module quick access ───────────────────────── */}
      <div>
        <div className="data-label mb-3">Quick Access</div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {MODULES.map(m => (
            <button
              key={m.path}
              onClick={() => router.push(m.path)}
              className="bg-white rounded-2xl border border-navy-800/8 p-4 flex flex-col items-center gap-2
                         hover:shadow-clinical-md transition-all group"
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${m.color}`}>
                {m.icon}
              </div>
              <span className="text-xs font-medium text-ink/70 group-hover:text-ink transition-colors text-center leading-tight">
                {m.label}
              </span>
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}
