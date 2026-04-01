'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { useConfig } from '@/hooks/useConfig'

// ── Types ──────────────────────────────────────────
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

// ── Helpers ────────────────────────────────────────
function getSpecialtyLabel(val: string) {
  const map: Record<string, string> = {
    interventional_cardiology: 'Interventional Cardiology',
    cardiac_surgery: 'Cardiac Surgery',
    cardiology: 'Cardiology',
    orthopedics: 'Orthopaedics',
    spine_surgery: 'Spine Surgery',
    neurology: 'Neurology',
    neurosurgery: 'Neurosurgery',
    gi_surgery: 'GI Surgery',
    urology: 'Urology',
    oncology: 'Oncology',
    reproductive_medicine: 'Reproductive Medicine',
    dermatology: 'Dermatology',
    ophthalmology: 'Ophthalmology',
    internal_medicine: 'Internal Medicine',
    other: 'Other',
  }
  return map[val] || val
}

function getPeerStatus(peer: Peer): 'new' | 'active' | 'drifting' | 'silent' {
  if (!peer.last_referral_at) return 'new'
  const days = peer.days_since_last ?? 999
  if (days < 30) return 'active'
  if (days < 90) return 'drifting'
  return 'silent'
}

function getPeerStatusLabel(status: string) {
  const map: Record<string, string> = {
    new: 'New', active: 'Active', drifting: 'Drifting', silent: 'Silent',
  }
  return map[status] || status
}

function getPeerStatusColor(status: string) {
  const map: Record<string, string> = {
    new:      'bg-clinical-blue/20 text-blue-700',
    active:   'bg-forest-50 text-forest-700',
    drifting: 'bg-amber-50 text-amber-700',
    silent:   'bg-red-50 text-red-600',
  }
  return map[status] || 'bg-gray-100 text-gray-600'
}

function getDaysSinceLabel(peer: Peer) {
  if (!peer.last_referral_at) return 'No referrals recorded yet'
  const days = peer.days_since_last ?? 0
  if (days === 0) return 'Active today'
  if (days === 1) return 'Last active yesterday'
  return `Last referral ${days} days ago`
}

// City benchmarks — will come from DB in Module 2
const CITY_BENCHMARKS: Record<string, number> = {
  Hyderabad: 14, Bengaluru: 16, Mumbai: 18, Delhi: 17, Chennai: 13,
  default: 12,
}

export default function DashboardClient({ specialist, peers, isNewlyOnboarded, userPhoto }: Props) {
  const router = useRouter()
  const [showAha, setShowAha] = useState(isNewlyOnboarded && peers.length > 0)
  const [menuOpen, setMenuOpen] = useState(false)

  const activePeers   = peers.filter(p => getPeerStatus(p) === 'active')
  const driftingPeers = peers.filter(p => getPeerStatus(p) === 'drifting')
  const silentPeers   = peers.filter(p => getPeerStatus(p) === 'silent')
  const newPeers      = peers.filter(p => getPeerStatus(p) === 'new')

  const cityBenchmark = CITY_BENCHMARKS[specialist.city] ?? CITY_BENCHMARKS.default
  const networkGap    = Math.max(0, cityBenchmark - peers.length)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  // Dismiss aha after 8 seconds
  useEffect(() => {
    if (showAha) {
      const t = setTimeout(() => setShowAha(false), 8000)
      return () => clearTimeout(t)
    }
  }, [showAha])

  return (
    <div className="min-h-screen bg-clinical-light">

      {/* ── Nav ── */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="ClinCollab" width={28} height={28} />
            <span className="font-display text-lg text-navy-800">ClinCollab</span>
          </div>

          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 hover:bg-navy-50 rounded-xl px-3 py-1.5 transition-colors"
            >
              {userPhoto ? (
                <Image src={userPhoto} alt="" width={28} height={28} className="rounded-full" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-navy-800 flex items-center justify-center">
                  <span className="text-white text-xs font-medium">
                    {specialist.name.charAt(0)}
                  </span>
                </div>
              )}
              <span className="text-sm text-navy-800/70 hidden sm:block">
                {specialist.name.split(' ')[0]}
              </span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-12 bg-white border border-navy-800/10 rounded-xl shadow-clinical-md py-1 w-44 z-50 animate-fade-in">
                <button
                  onClick={() => router.push('/profile')}
                  className="w-full text-left px-4 py-2.5 text-sm text-navy-800 hover:bg-navy-50 transition-colors"
                >
                  My profile
                </button>
                {specialist.role === 'admin' && (
                  <button
                    onClick={() => router.push('/admin')}
                    className="w-full text-left px-4 py-2.5 text-sm text-navy-800 hover:bg-navy-50 transition-colors"
                  >
                    Admin panel
                  </button>
                )}
                <div className="border-t border-navy-800/8 my-1" />
                <button
                  onClick={handleSignOut}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* ── Aha moment banner ── */}
        {showAha && peers.length > 0 && (
          <div className="bg-navy-800 rounded-2xl p-5 text-white animate-slide-up relative overflow-hidden">
            <div className="absolute inset-0 opacity-5"
              style={{ backgroundImage: `radial-gradient(circle at 80% 20%, rgba(93,173,226,0.4), transparent 60%)` }}
            />
            <div className="relative">
              <div className="data-label text-white/50 mb-2">Practice intelligence</div>
              <p className="text-sm leading-relaxed mb-3">
                {silentPeers.length > 0 && (
                  <><strong>{silentPeers[0].peer_name}</strong> has not referred a case in{' '}
                  {silentPeers[0].days_since_last ?? '90'}+ days. </>
                )}
                Specialists in {specialist.city} manage{' '}
                <strong>{cityBenchmark} active referring colleagues</strong> on average.
                Structured engagement typically results in{' '}
                <strong>20–35% higher procedural volume</strong>.
              </p>
              {networkGap > 0 && (
                <p className="text-xs text-white/70">
                  You have {peers.length} colleague{peers.length !== 1 ? 's' : ''} seeded.
                  Adding {networkGap} more puts you at the {specialist.city} benchmark.
                </p>
              )}
              <button
                onClick={() => setShowAha(false)}
                className="mt-3 text-xs text-white/50 hover:text-white/80 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* ── Welcome / header ── */}
        <div>
          <h1 className="font-display text-2xl text-navy-800">
            {isNewlyOnboarded ? `Welcome, ${specialist.name.split(' ')[0]}` : `Good morning, ${specialist.name.split(' ')[0]}`}
          </h1>
          <p className="text-sm text-navy-800/50 mt-0.5">
            {getSpecialtyLabel(specialist.specialty)} · {specialist.city}
          </p>
        </div>

        {/* ── Network health summary ── */}
        <div className="card-clinical">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="data-label mb-0.5">Peer network health</div>
              <div className="text-xs text-navy-800/50">{peers.length} colleague{peers.length !== 1 ? 's' : ''} in your network</div>
            </div>
            <button
              onClick={() => router.push('/network')}
              className="text-xs text-navy-800/60 hover:text-navy-800 transition-colors font-medium"
            >
              View all
            </button>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Active',   count: activePeers.length,   color: 'text-forest-700',   dot: 'bg-forest-700' },
              { label: 'New',      count: newPeers.length,      color: 'text-blue-600',     dot: 'bg-blue-400' },
              { label: 'Drifting', count: driftingPeers.length, color: 'text-amber-600',    dot: 'bg-amber-400' },
              { label: 'Silent',   count: silentPeers.length,   color: 'text-red-500',      dot: 'bg-red-400' },
            ].map(item => (
              <div key={item.label} className="text-center">
                <div className={`font-display text-2xl font-medium ${item.color}`}>
                  {item.count}
                </div>
                <div className="flex items-center justify-center gap-1 mt-0.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${item.dot}`} />
                  <span className="data-label">{item.label}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Benchmark bar */}
          {peers.length > 0 && (
            <div className="mt-4 pt-4 border-t border-navy-800/8">
              <div className="flex justify-between text-xs text-navy-800/50 mb-1.5">
                <span>Your network vs {specialist.city} average</span>
                <span>{peers.length} / {cityBenchmark}</span>
              </div>
              <div className="h-1.5 bg-navy-800/8 rounded-full overflow-hidden">
                <div
                  className="h-full bg-navy-800 rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(100, (peers.length / cityBenchmark) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Peer list ── */}
        {peers.length > 0 ? (
          <div className="card-clinical">
            <div className="flex items-center justify-between mb-4">
              <div className="data-label">Clinical colleagues</div>
              <button
                onClick={() => router.push('/network/add')}
                className="text-xs font-medium text-forest-700 hover:text-forest-800 transition-colors"
              >
                + Add colleague
              </button>
            </div>

            <div className="space-y-3">
              {peers.slice(0, 5).map(peer => {
                const status = getPeerStatus(peer)
                return (
                  <div
                    key={peer.id}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-navy-50/50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/network/${peer.id}`)}
                  >
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-xl bg-navy-800/8 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-medium text-navy-800">
                        {peer.peer_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-navy-800 truncate">
                          {peer.peer_name}
                        </span>
                        <span className={`text-2xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${getPeerStatusColor(status)}`}>
                          {getPeerStatusLabel(status)}
                        </span>
                      </div>
                      <div className="text-xs text-navy-800/40 mt-0.5 truncate">
                        {peer.peer_specialty ? `${peer.peer_specialty} · ` : ''}{peer.peer_city}
                      </div>
                      <div className="text-xs text-navy-800/40">
                        {getDaysSinceLabel(peer)}
                      </div>
                    </div>

                    <ChevronRight />
                  </div>
                )
              })}

              {peers.length > 5 && (
                <button
                  onClick={() => router.push('/network')}
                  className="w-full text-center text-xs text-navy-800/40 hover:text-navy-800/60 py-2 transition-colors"
                >
                  View all {peers.length} colleagues
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Empty state — not empty, actionable */
          <div className="card-clinical text-center py-8">
            <div className="w-12 h-12 bg-navy-800/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <NetworkIcon />
            </div>
            <h3 className="font-display text-xl text-navy-800 mb-2">
              Build your peer network
            </h3>
            <p className="text-sm text-navy-800/50 mb-5 max-w-xs mx-auto leading-relaxed">
              Add your referring colleagues to see your practice intelligence map
            </p>
            <button
              onClick={() => router.push('/network/add')}
              className="btn-primary"
            >
              Add first colleague
            </button>
          </div>
        )}

        {/* ── Primary insight card ── */}
        {peers.length > 0 && silentPeers.length > 0 && (
          <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4">
            <div className="data-label text-amber-700/70 mb-2">Attention needed</div>
            <p className="text-sm text-amber-900 leading-relaxed">
              <strong>{silentPeers.length} colleague{silentPeers.length !== 1 ? 's' : ''}</strong>{' '}
              {silentPeers.length === 1 ? 'has' : 'have'} not referred a case in 90+ days.
              Structured re-engagement typically restores referral flow within 3–4 weeks.
            </p>
            <button
              onClick={() => router.push('/network?filter=silent')}
              className="mt-3 text-sm font-medium text-amber-800 hover:text-amber-900 transition-colors"
            >
              Review silent colleagues →
            </button>
          </div>
        )}

        {/* ── Profile completeness nudge (contextual) ── */}
        {(specialist.specialist_profiles?.completeness_pct ?? 0) < 60 && (
          <div className="bg-clinical-blue/8 border border-clinical-blue/20 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-clinical-blue/15 rounded-xl flex items-center justify-center flex-shrink-0">
                <ProfileIcon />
              </div>
              <div>
                <p className="text-sm text-navy-800 font-medium mb-0.5">
                  Complete your clinical profile
                </p>
                <p className="text-xs text-navy-800/50 leading-relaxed">
                  Specialists with complete profiles receive 34% more direct referrals
                  from colleagues. Add your hospital affiliation to get started.
                </p>
                <button
                  onClick={() => router.push('/profile')}
                  className="mt-2 text-xs font-medium text-navy-800 hover:text-navy-900 transition-colors"
                >
                  Complete profile →
                </button>
              </div>
            </div>
          </div>
        )}



        {/* ── Clinical Content Engine card ── */}
        <div
          className="card-clinical cursor-pointer hover:shadow-clinical-md transition-all"
          onClick={() => router.push('/content')}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-teal-600">
                <path d="M9 12h6M9 16h6M9 8h6M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-navy-800 mb-0.5">Clinical Content Engine</div>
              <div className="text-xs text-navy-800/50 leading-relaxed">
                Generate CME presentations, grand rounds, referral guides and protocols — 
                sourced from live medical literature and cited in Vancouver format.
              </div>
            </div>
            <ChevronRight />
          </div>
        </div>

        {/* ── 360° Synthesis quick-access card ── */
        <div
          className="card-clinical cursor-pointer hover:shadow-clinical-md transition-all"
          onClick={() => router.push('/synthesis')}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-purple-600">
                <path d="M12 2a10 10 0 110 20A10 10 0 0112 2z" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M8 12l2.5 2.5L16 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-navy-800 mb-0.5">360° Clinical synthesis</div>
              <div className="text-xs text-navy-800/50 leading-relaxed">
                Pre-consultation briefs generated automatically from triage, referral,
                appointment, and chatbot data. Ready before the patient walks in.
              </div>
            </div>
            <ChevronRight />
          </div>
        </div>

        {/* ── Module navigation strip ── */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Referrals',    path: '/referrals',       color: 'text-navy-800',   module: 'm3_referrals' },
            { label: 'Triage',       path: '/triage/sessions', color: 'text-teal-700',   module: 'm5_triage' },
            { label: 'Appointments', path: '/appointments', color: 'text-forest-700' },
            { label: 'Chatbot',      path: '/chatbot/config', color: 'text-amber-700',  module: 'm4_chatbot' },
            { label: 'Transcription', path: '/transcription',   color: 'text-purple-700', module: 'm7_transcription' },
            { label: 'Procedures',   path: '/procedures',       color: 'text-red-700',    module: 'm8_procedure_planner' },
            { label: 'Content',      path: '/content',          color: 'text-teal-700',   module: 'm10_content' },
          ].map(m => (
            <button
              key={m.label}
              onClick={() => router.push(m.path)}
              style={{ display: m.module && !checkModule(m.module) ? 'none' : undefined }}
              className="card-clinical text-center py-3 hover:bg-navy-50 transition-colors"
            >
              <div className={`text-xs font-medium ${m.color}`}>{m.label}</div>
            </button>
          ))}
        </div>

      </main>
    </div>
  )
}

// ── Icon components ────────────────────────────────
function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-navy-800/20 flex-shrink-0">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function NetworkIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-navy-800/40">
      <circle cx="12" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="5" cy="17" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="19" cy="17" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M12 7.5v4M12 11.5l-5 3.5M12 11.5l5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-clinical-blue">
      <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M2.5 13c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}
