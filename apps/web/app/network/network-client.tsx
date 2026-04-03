'use client'

import { useState, useMemo } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

// ── Classification criteria (days since last referral) ───────────────────────
const CRITERIA_INFO = [
  { status: 'active',   label: 'Active',   dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50/60',
    rule: 'Referred a case within the last 30 days.' },
  { status: 'new',      label: 'New',      dot: 'bg-blue-500',    text: 'text-blue-700',    bg: 'bg-blue-50/60',
    rule: 'Recently added colleague; no referral recorded yet.' },
  { status: 'drifting', label: 'Drifting', dot: 'bg-amber-500',   text: 'text-amber-700',  bg: 'bg-amber-50/60',
    rule: 'Last referral was 31–90 days ago. Relationship at risk of lapsing.' },
  { status: 'silent',   label: 'Silent',   dot: 'bg-red-500',     text: 'text-red-600',    bg: 'bg-red-50/60',
    rule: 'No referral in 90+ days despite a prior referral history. High re-engagement priority.' },
]

type Referrer = {
  id: string
  name: string
  clinic_name: string | null
  clinic_area: string | null
  city: string
  mobile: string | null
  whatsapp: string | null
  specialty: string | null
  status: string
  total_referrals: number
  last_referral_at: string | null
  days_since_last: number | null
  created_at: string
}

type Specialist = {
  id: string; name: string; specialty: string; city: string; role: string
}

type Filter = 'all' | 'active' | 'drifting' | 'silent' | 'new'

const STATUS_CONFIG = {
  active:   { label: 'Active',   bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  drifting: { label: 'Drifting', bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
  silent:   { label: 'Silent',   bg: 'bg-red-50',     text: 'text-red-600',     dot: 'bg-red-500'     },
  new:      { label: 'New',      bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500'    },
  inactive: { label: 'Inactive', bg: 'bg-gray-100',   text: 'text-gray-500',    dot: 'bg-gray-400'    },
}

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.inactive
}

function relativeDate(last: string | null, days: number | null) {
  if (!last) return 'No referrals recorded'
  if (days === 0) return 'Referred today'
  if (days === 1) return 'Referred yesterday'
  if ((days ?? 0) < 30) return `${days} days ago`
  if ((days ?? 0) < 365) return `${Math.floor((days ?? 0) / 30)} months ago`
  return `${Math.floor((days ?? 0) / 365)} year${Math.floor((days ?? 0) / 365) > 1 ? 's' : ''} ago`
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

export default function NetworkClient({
  specialist, referrers, healthScore, cityBenchmark, initialFilter, initialQuery,
}: {
  specialist: Specialist
  referrers: Referrer[]
  healthScore: number
  cityBenchmark: number
  initialFilter: Filter
  initialQuery: string
}) {
  const router = useRouter()
  const [filter, setFilter]       = useState<Filter>(initialFilter)
  const [query, setQuery]         = useState(initialQuery)
  const [sort, setSort]           = useState<'status' | 'name' | 'last_referral' | 'volume'>('status')
  const [showCriteria, setShowCriteria] = useState(false)
  const [showScoreInfo, setShowScoreInfo] = useState(false)

  // ── Computed counts ──────────────────────────────
  const counts = useMemo(() => ({
    all:      referrers.length,
    active:   referrers.filter(r => r.status === 'active').length,
    drifting: referrers.filter(r => r.status === 'drifting').length,
    silent:   referrers.filter(r => r.status === 'silent').length,
    new:      referrers.filter(r => r.status === 'new').length,
  }), [referrers])

  // ── At-risk: were top referrers, now silent ──────
  const atRisk = useMemo(() => {
    return referrers
      .filter(r => r.status === 'silent' && r.total_referrals >= 3)
      .sort((a, b) => b.total_referrals - a.total_referrals)
      .slice(0, 3)
  }, [referrers])

  // ── Top referrers (last 90 days) ─────────────────
  const topReferrers = useMemo(() => {
    return [...referrers]
      .filter(r => r.status === 'active')
      .sort((a, b) => b.total_referrals - a.total_referrals)
      .slice(0, 5)
  }, [referrers])

  // ── Filtered + searched + sorted list ───────────
  const displayed = useMemo(() => {
    let list = [...referrers]

    if (filter !== 'all') list = list.filter(r => r.status === filter)

    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.specialty?.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q) ||
        r.clinic_name?.toLowerCase().includes(q)
      )
    }

    list.sort((a, b) => {
      if (sort === 'name')          return a.name.localeCompare(b.name)
      if (sort === 'volume')        return b.total_referrals - a.total_referrals
      if (sort === 'last_referral') {
        if (!a.last_referral_at) return 1
        if (!b.last_referral_at) return -1
        return new Date(b.last_referral_at).getTime() - new Date(a.last_referral_at).getTime()
      }
      // Default: status order
      const order = { active: 0, new: 1, drifting: 2, silent: 3, inactive: 4 }
      return (order[a.status as keyof typeof order] ?? 5) - (order[b.status as keyof typeof order] ?? 5)
    })

    return list
  }, [referrers, filter, query, sort])

  // ── Health score colour ──────────────────────────
  const healthColor = healthScore >= 70 ? 'text-emerald-700' :
                      healthScore >= 40 ? 'text-amber-600' : 'text-red-600'
  const healthBg    = healthScore >= 70 ? 'bg-emerald-500' :
                      healthScore >= 40 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="min-h-screen bg-clinical-light">

      {/* ── Nav ─────────────────────────────────── */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <ChevronLeft />
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1">Peer network</span>
          <button
            onClick={() => router.push('/network/add')}
            className="flex items-center gap-1.5 bg-navy-800 text-white text-xs font-medium
                       px-3 py-2 rounded-xl hover:bg-navy-900 active:scale-95 transition-all">
            <Plus /> Add colleague
          </button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* ── Intelligence summary ─────────────── */}
        <div className="card-clinical">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="data-label">Network health score</span>
                <button
                  onClick={() => setShowScoreInfo(v => !v)}
                  className="w-4 h-4 rounded-full bg-navy-800/10 text-navy-800/40
                             hover:bg-navy-800/15 hover:text-navy-800/70 transition-colors
                             flex items-center justify-center text-xs font-bold leading-none"
                  title="How is this calculated?"
                >
                  i
                </button>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`font-display text-3xl font-medium ${healthColor}`}>
                  {healthScore}
                </span>
                <span className="text-xs text-navy-800/40">/ 100</span>
              </div>
            </div>
            <div className="text-right">
              <div className="data-label mb-0.5">{specialist.city} platform avg.</div>
              <div className="font-display text-xl text-navy-800/50">{cityBenchmark}</div>
              <div className="text-xs text-navy-800/40">active referrers</div>
            </div>
          </div>

          {/* Score methodology tooltip */}
          {showScoreInfo && (
            <div className="bg-navy-800/4 rounded-xl p-3 mb-4 text-xs text-navy-800/60 space-y-1.5">
              <p className="font-medium text-navy-800/80">How the score is calculated</p>
              <p>· <strong>Active referrer ratio</strong> (50 pts) — share of your network actively sending cases</p>
              <p>· <strong>Engagement trend</strong> (30 pts) — whether referral frequency is growing or declining</p>
              <p>· <strong>Network size vs benchmark</strong> (20 pts) — how your total active referrers compare to peers in {specialist.city}</p>
              <p className="text-navy-800/40 pt-1 border-t border-navy-800/8">
                Benchmark figures are derived from anonymised ClinCollab platform data across specialists in {specialist.city}.
              </p>
            </div>
          )}

          {/* Health bar */}
          <div className="h-1.5 bg-navy-800/8 rounded-full overflow-hidden mb-4">
            <div
              className={`h-full rounded-full transition-all duration-700 ${healthBg}`}
              style={{ width: `${healthScore}%` }}
            />
          </div>

          {/* Status breakdown */}
          <div className="grid grid-cols-4 gap-2">
            {(['active', 'new', 'drifting', 'silent'] as const).map(s => {
              const cfg = getStatusConfig(s)
              return (
                <button
                  key={s}
                  onClick={() => setFilter(filter === s ? 'all' : s)}
                  className={`rounded-xl p-2.5 text-center transition-all border
                    ${filter === s
                      ? `${cfg.bg} border-current ${cfg.text}`
                      : 'border-transparent hover:bg-navy-50'}`}
                >
                  <div className={`font-display text-xl font-medium ${cfg.text}`}>
                    {counts[s]}
                  </div>
                  <div className="flex items-center justify-center gap-1 mt-0.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                    <span className="data-label">{cfg.label}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── At-risk alert ────────────────────── */}
        {atRisk.length > 0 && (
          <div className="bg-amber-50 border border-amber-200/70 rounded-2xl p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="data-label text-amber-700/70">Silent — high-value relationships at risk</div>
                <div className="text-xs text-amber-700/50 mt-0.5">
                  These were active referral sources now silent for 90+ days
                </div>
              </div>
              <span className="text-2xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-2">
                Silent
              </span>
            </div>
            {atRisk.map(r => (
              <button
                key={r.id}
                onClick={() => router.push(`/network/${r.id}`)}
                className="w-full flex items-center justify-between py-2 text-left
                           hover:bg-amber-100/50 rounded-lg px-1 transition-colors"
              >
                <div>
                  <span className="text-sm font-medium text-amber-900">{r.name}</span>
                  {r.specialty && (
                    <span className="text-xs text-amber-700/60 ml-1.5">· {r.specialty}</span>
                  )}
                </div>
                <span className="text-xs text-amber-700 font-medium flex-shrink-0">
                  {r.total_referrals} cases · {r.days_since_last}d silent
                </span>
              </button>
            ))}
            <p className="text-xs text-amber-700/70 mt-2 pt-2 border-t border-amber-200/50">
              Structured re-engagement (WhatsApp check-in + case update) typically
              restores referral flow within 3–4 weeks.
            </p>
          </div>
        )}

        {/* ── Search + sort ────────────────────── */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <SearchIcon />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name, specialty, clinic..."
              className="input-clinical pl-9 text-sm"
            />
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as any)}
            className="input-clinical text-sm w-auto px-3 flex-shrink-0"
          >
            <option value="status">By status</option>
            <option value="last_referral">By last referral</option>
            <option value="volume">By volume</option>
            <option value="name">By name</option>
          </select>
        </div>

        {/* ── Filter tabs ─────────────────────── */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {(['all', 'active', 'drifting', 'silent', 'new'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap
                transition-all border flex-shrink-0
                ${filter === f
                  ? 'bg-navy-800 text-white border-navy-800'
                  : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}
            >
              {f === 'all' ? `All (${counts.all})` : `${getStatusConfig(f).label} (${counts[f]})`}
            </button>
          ))}
          <button
            onClick={() => setShowCriteria(v => !v)}
            className="px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap
              transition-all border flex-shrink-0 bg-white text-navy-800/40
              border-navy-800/15 hover:border-navy-800/30 flex items-center gap-1"
          >
            <span className="font-bold">i</span> How statuses work
          </button>
        </div>

        {/* ── Classification criteria panel ────── */}
        {showCriteria && (
          <div className="bg-white border border-navy-800/10 rounded-2xl p-4 space-y-3">
            <div className="data-label mb-1">Status classification criteria</div>
            <p className="text-xs text-navy-800/50 mb-3">
              Each colleague is automatically classified based on their referral recency.
              Status updates daily.
            </p>
            {CRITERIA_INFO.map(c => (
              <div key={c.status} className={`flex items-start gap-3 rounded-xl px-3 py-2.5 ${c.bg}`}>
                <div className={`w-2 h-2 rounded-full ${c.dot} mt-1 flex-shrink-0`} />
                <div>
                  <span className={`text-xs font-semibold ${c.text}`}>{c.label}</span>
                  <p className="text-xs text-navy-800/60 mt-0.5">{c.rule}</p>
                </div>
              </div>
            ))}
            <p className="text-xs text-navy-800/35 pt-1">
              Thresholds: Active ≤30 days · Drifting 31–90 days · Silent &gt;90 days
            </p>
          </div>
        )}

        {/* ── Referrer list ────────────────────── */}
        {displayed.length > 0 ? (
          <div className="card-clinical p-0 overflow-hidden">
            {displayed.map((r, idx) => {
              const cfg = getStatusConfig(r.status)
              return (
                <button
                  key={r.id}
                  onClick={() => router.push(`/network/${r.id}`)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left
                    hover:bg-navy-50/60 active:bg-navy-50 transition-colors
                    ${idx < displayed.length - 1 ? 'border-b border-navy-800/5' : ''}`}
                >
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-xl bg-navy-800/8 flex items-center
                                  justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-navy-800">
                      {initials(r.name)}
                    </span>
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-navy-800 truncate">
                        {r.name}
                      </span>
                      <span className={`text-2xs px-2 py-0.5 rounded-full font-medium
                        flex-shrink-0 ${cfg.bg} ${cfg.text}`}>
                        {cfg.label}
                      </span>
                    </div>
                    <div className="text-xs text-navy-800/40 truncate">
                      {[r.specialty, r.clinic_name, r.clinic_area || r.city]
                        .filter(Boolean).join(' · ')}
                    </div>
                    <div className="text-xs text-navy-800/35 mt-0.5">
                      {relativeDate(r.last_referral_at, r.days_since_last)}
                      {r.total_referrals > 0 && (
                        <span className="ml-2">· {r.total_referrals} total</span>
                      )}
                    </div>
                  </div>

                  {/* Quick actions */}
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    {r.whatsapp && (
                      <a
                        href={`https://wa.me/91${r.whatsapp.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-8 h-8 rounded-lg bg-green-50 flex items-center
                                   justify-center hover:bg-green-100 transition-colors"
                        title="Open WhatsApp"
                      >
                        <WhatsAppIcon />
                      </a>
                    )}
                    <ChevronRight />
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="card-clinical text-center py-10">
            {query || filter !== 'all' ? (
              <>
                <p className="text-sm text-navy-800/50 mb-3">No colleagues match your search</p>
                <button
                  onClick={() => { setQuery(''); setFilter('all') }}
                  className="text-sm text-navy-800 font-medium hover:underline"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <div className="w-12 h-12 bg-navy-800/5 rounded-2xl flex items-center
                                justify-center mx-auto mb-4">
                  <NetworkIcon />
                </div>
                <h3 className="font-display text-xl text-navy-800 mb-2">
                  Build your peer network
                </h3>
                <p className="text-sm text-navy-800/50 mb-5 max-w-xs mx-auto">
                  Add colleagues who refer cases to you
                </p>
                <button
                  onClick={() => router.push('/network/add')}
                  className="btn-primary"
                >
                  Add first colleague
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Import CSV link ───────────────────── */}
        {referrers.length > 0 && (
          <button
            onClick={() => router.push('/network/import')}
            className="w-full text-center text-xs text-navy-800/40
                       hover:text-navy-800/60 transition-colors py-2"
          >
            Import colleagues via CSV
          </button>
        )}

      </main>
    </div>
  )
}

// ── Micro icons ────────────────────────────────────
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
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-navy-800/20">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function Plus() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round"/>
    </svg>
  )
}
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
         className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-800/30">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M10.5 10.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3"
            strokeLinecap="round"/>
    </svg>
  )
}
function WhatsAppIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="#25D366">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}
function NetworkIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-navy-800/40">
      <circle cx="12" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="5" cy="17" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="19" cy="17" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M12 7.5v4M12 11.5l-5 3.5M12 11.5l5 3.5" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}
