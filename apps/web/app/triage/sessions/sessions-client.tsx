'use client'

import { useState, useMemo, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createTriageSessionAction } from '@/app/actions/triage'

type Session = {
  id: string
  patient_name: string
  patient_mobile: string | null
  patient_age: number | null
  patient_gender: string | null
  status: string
  red_flag_level: string
  red_flag_summary: string | null
  ai_synopsis: string | null
  language: string
  channel: string
  created_at: string
  completed_at: string | null
  started_at: string | null
  triage_protocols: { name: string; protocol_type: string } | null
}

type Protocol = { id: string; name: string }

const FLAG_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  none:         { label: 'Clear',        bg: 'bg-gray-100',    text: 'text-gray-500',    dot: 'bg-gray-400' },
  needs_review: { label: 'Needs review', bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-500' },
  urgent:       { label: 'Urgent',       bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500' },
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:     { label: 'Not started', color: 'text-navy-800/40' },
  in_progress: { label: 'In progress', color: 'text-blue-600' },
  completed:   { label: 'Completed',   color: 'text-forest-700' },
  abandoned:   { label: 'Abandoned',   color: 'text-gray-400' },
  expired:     { label: 'Expired',     color: 'text-gray-400' },
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function completionTime(started: string | null, completed: string | null): string {
  if (!started || !completed) return '—'
  const mins = Math.round((new Date(completed).getTime() - new Date(started).getTime()) / 60000)
  return `${mins} min`
}

export default function TriageSessionsClient({
  specialist, sessions, protocols, analytics,
  initialStatus, initialProtocol,
}: {
  specialist: { id: string; name: string; specialty: string }
  sessions: Session[]
  protocols: Protocol[]
  analytics: { total: number; completed: number; flagged: number; urgent: number; thisWeek: number }
  initialStatus: string
  initialProtocol: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [statusFilter, setStatusFilter]     = useState(initialStatus)
  const [protocolFilter, setProtocolFilter] = useState(initialProtocol)
  const [flagFilter, setFlagFilter]         = useState('all')
  const [query, setQuery]                   = useState('')
  const [showSend, setShowSend]             = useState(false)
  const [sendForm, setSendForm]             = useState({ patient_name: '', patient_mobile: '', protocol_id: protocols[0]?.id || '' })

  const displayed = useMemo(() => {
    let list = [...sessions]

    if (statusFilter !== 'all')   list = list.filter(s => s.status === statusFilter)
    if (protocolFilter !== 'all') list = list.filter(s => {
      // match by protocol name
      return (s.triage_protocols as any)?.name?.includes(protocolFilter) || false
    })
    if (flagFilter !== 'all')     list = list.filter(s => s.red_flag_level === flagFilter)

    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(s =>
        s.patient_name.toLowerCase().includes(q) ||
        s.patient_mobile?.includes(q) ||
        s.triage_protocols?.name.toLowerCase().includes(q)
      )
    }

    return list
  }, [sessions, statusFilter, protocolFilter, flagFilter, query])

  async function handleSendTriage(e: React.FormEvent) {
    e.preventDefault()
    if (!sendForm.patient_name.trim() || !sendForm.protocol_id) return
    startTransition(async () => {
      const result = await createTriageSessionAction(
        sendForm.protocol_id, sendForm.patient_name, sendForm.patient_mobile
      )
      if (result?.error) { toast.error(result.error); return }
      if (result.url) {
        navigator.clipboard.writeText(result.url).catch(() => {})
        toast.success('Triage link created — copied to clipboard')
        if (sendForm.patient_mobile) toast.success('Sent via WhatsApp')
      }
      setShowSend(false)
      setSendForm({ patient_name: '', patient_mobile: '', protocol_id: protocols[0]?.id || '' })
      router.refresh()
    })
  }

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Non-sticky inner nav */}
      <div className="bg-white border-b border-navy-800/8">
        <div className="px-5 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1">Triage sessions</span>
          <button
            onClick={() => router.push('/triage/builder')}
            className="text-xs font-medium text-navy-800/60 hover:text-navy-800 transition-colors mr-1"
          >
            Protocol builder
          </button>
          <button
            onClick={() => setShowSend(true)}
            className="flex items-center gap-1.5 bg-navy-800 text-white text-xs font-medium px-3 py-2 rounded-xl hover:bg-navy-900 active:scale-95 transition-all"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            Send triage
          </button>
        </div>
      </div>

      <main className="px-5 py-5 space-y-4">

        {/* Analytics strip */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'This week',  value: analytics.thisWeek,  color: 'text-navy-800' },
            { label: 'Total',      value: analytics.total,     color: 'text-navy-800' },
            { label: 'Completed',  value: analytics.completed, color: 'text-forest-700' },
            { label: 'Flagged',    value: analytics.flagged,   color: 'text-amber-600' },
            { label: 'Urgent',     value: analytics.urgent,    color: 'text-red-600' },
          ].map(stat => (
            <div key={stat.label} className="card-clinical text-center p-2.5">
              <div className={`font-display text-xl font-medium ${stat.color}`}>{stat.value}</div>
              <div className="data-label leading-tight mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Urgent alert */}
        {analytics.urgent > 0 && (
          <div
            className="bg-red-50 border border-red-200/60 rounded-2xl p-4 cursor-pointer"
            onClick={() => setFlagFilter('urgent')}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="data-label text-red-600/70 mb-1">Urgent red flags</div>
                <p className="text-sm font-medium text-red-900">
                  {analytics.urgent} session{analytics.urgent > 1 ? 's' : ''} with urgent flags — review before calling patient in
                </p>
              </div>
              <div className="w-8 h-8 bg-red-500 rounded-xl flex items-center justify-center text-white font-medium text-sm">
                {analytics.urgent}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {['all', 'pending', 'in_progress', 'completed', 'abandoned'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all border
                ${statusFilter === s ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}>
              {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label || s}
            </button>
          ))}
          <div className="w-px bg-navy-800/10 mx-0.5 flex-shrink-0" />
          {['all', 'needs_review', 'urgent'].map(f => (
            <button key={f} onClick={() => setFlagFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all border
                ${flagFilter === f ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}>
              {f === 'all' ? 'All flags' : FLAG_CONFIG[f]?.label || f}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-800/30">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M10.5 10.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search patient name or protocol..."
            className="input-clinical pl-9" />
        </div>

        {/* Sessions list */}
        {displayed.length > 0 ? (
          <div className="card-clinical p-0 overflow-hidden">
            {displayed.map((session, idx) => {
              const flag = FLAG_CONFIG[session.red_flag_level] || FLAG_CONFIG.none
              const status = STATUS_CONFIG[session.status] || STATUS_CONFIG.pending
              const protocol = session.triage_protocols
              return (
                <button
                  key={session.id}
                  onClick={() => router.push(`/triage/sessions/${session.id}`)}
                  className={`w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-navy-50/60 transition-colors
                    ${idx < displayed.length - 1 ? 'border-b border-navy-800/5' : ''}`}
                >
                  {/* Red flag dot */}
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${flag.dot}`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-medium text-navy-800">{session.patient_name}</span>
                      {session.red_flag_level !== 'none' && (
                        <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${flag.bg} ${flag.text}`}>
                          {flag.label}
                        </span>
                      )}
                      <span className={`text-2xs font-medium ${status.color}`}>{status.label}</span>
                    </div>
                    <div className="text-xs text-navy-800/50">
                      {protocol?.name || 'Unknown protocol'}
                      {session.patient_age ? ` · ${session.patient_age}y` : ''}
                      {session.patient_gender ? ` · ${session.patient_gender}` : ''}
                    </div>
                    {session.ai_synopsis && (
                      <div className="text-xs text-navy-800/40 mt-0.5 line-clamp-1">
                        {session.ai_synopsis}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-navy-800/35">{timeAgo(session.created_at)}</span>
                    {session.status === 'completed' && (
                      <span className="text-2xs text-navy-800/30">
                        {completionTime(session.started_at, session.completed_at)}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="card-clinical text-center py-10">
            <div className="w-12 h-12 bg-navy-800/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-navy-800/40">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12l2 2 4-4"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="font-display text-xl text-navy-800 mb-2">No triage sessions</h3>
            <p className="text-sm text-navy-800/50 mb-5 max-w-xs mx-auto">
              {query || statusFilter !== 'all' || flagFilter !== 'all'
                ? 'No sessions match your filters'
                : 'Send a triage link to a patient before their consultation'}
            </p>
            {protocols.length > 0 ? (
              <button onClick={() => setShowSend(true)} className="btn-primary">Send triage link</button>
            ) : (
              <button onClick={() => router.push('/triage/builder')} className="btn-primary">Build a triage protocol</button>
            )}
          </div>
        )}
      </main>

      {/* Send triage modal */}
      {showSend && (
        <div className="fixed inset-0 bg-navy-900/50 flex items-center justify-center px-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-clinical-lg">
            <h2 className="font-display text-xl text-navy-800 mb-1">Send triage to patient</h2>
            <p className="text-sm text-navy-800/50 mb-4 leading-relaxed">
              Creates a secure triage link. If you add their mobile number, it is sent via WhatsApp automatically.
            </p>
            <form onSubmit={handleSendTriage} className="space-y-4">
              <div>
                <label className="data-label block mb-1.5">Protocol</label>
                <select value={sendForm.protocol_id}
                  onChange={e => setSendForm(p => ({ ...p, protocol_id: e.target.value }))}
                  className="input-clinical">
                  {protocols.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="data-label block mb-1.5">Patient name</label>
                <input type="text" value={sendForm.patient_name}
                  onChange={e => setSendForm(p => ({ ...p, patient_name: e.target.value }))}
                  placeholder="Full name" className="input-clinical" autoFocus required />
              </div>
              <div>
                <label className="data-label block mb-1.5">Patient mobile (optional — for WhatsApp)</label>
                <input type="tel" value={sendForm.patient_mobile}
                  onChange={e => setSendForm(p => ({ ...p, patient_mobile: e.target.value }))}
                  placeholder="9876543210" className="input-clinical" />
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={isPending || !sendForm.patient_name.trim() || !sendForm.protocol_id}
                  className="btn-primary flex-1">
                  {isPending ? 'Creating...' : sendForm.patient_mobile ? 'Send via WhatsApp' : 'Create & copy link'}
                </button>
                <button type="button" onClick={() => setShowSend(false)} className="btn-secondary px-5">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
