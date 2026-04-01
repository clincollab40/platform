'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { logReferralAction, addNoteAction, deleteReferrerAction } from '@/app/actions/network'

type Referrer = {
  id: string; name: string; clinic_name: string | null; clinic_area: string | null
  city: string; mobile: string | null; whatsapp: string | null; specialty: string | null
  status: string; total_referrals: number; last_referral_at: string | null
  days_since_last: number | null; created_at: string
}
type Log = {
  id: string; referred_on: string; case_type: string; notes: string | null; created_at: string
}
type Note = { id: string; note: string; noted_at: string }

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  active:   { label: 'Active',   bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  drifting: { label: 'Drifting', bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
  silent:   { label: 'Silent',   bg: 'bg-red-50',     text: 'text-red-600',     dot: 'bg-red-500'     },
  new:      { label: 'New',      bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500'    },
}

const CASE_TYPES = [
  { value: 'procedure',        label: 'Procedure' },
  { value: 'opd_consultation', label: 'OPD Consultation' },
  { value: 'emergency',        label: 'Emergency' },
  { value: 'investigation',    label: 'Investigation' },
  { value: 'other',            label: 'Other' },
]

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

export default function ReferrerDetailClient({
  referrer, logs, notes, specialistId,
}: {
  referrer: Referrer; logs: Log[]; notes: Note[]; specialistId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<'timeline' | 'notes'>('timeline')
  const [showLogForm, setShowLogForm] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [logForm, setLogForm] = useState({
    referred_on: new Date().toISOString().split('T')[0],
    case_type: 'procedure',
    notes: '',
  })
  const [noteText, setNoteText] = useState('')

  const cfg = STATUS_CONFIG[referrer.status] || STATUS_CONFIG.new

  async function handleLogReferral(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.set('referrer_id', referrer.id)
    fd.set('referred_on', logForm.referred_on)
    fd.set('case_type', logForm.case_type)
    if (logForm.notes) fd.set('notes', logForm.notes)

    startTransition(async () => {
      const result = await logReferralAction(fd)
      if (result?.error) { toast.error(result.error) }
      else {
        toast.success('Referral logged successfully')
        setShowLogForm(false)
        setLogForm({ referred_on: new Date().toISOString().split('T')[0], case_type: 'procedure', notes: '' })
        router.refresh()
      }
    })
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.set('referrer_id', referrer.id)
    fd.set('note', noteText)

    startTransition(async () => {
      const result = await addNoteAction(fd)
      if (result?.error) { toast.error(result.error) }
      else {
        toast.success('Note saved')
        setShowNoteForm(false)
        setNoteText('')
        router.refresh()
      }
    })
  }

  async function handleDelete() {
    startTransition(async () => {
      const result = await deleteReferrerAction(referrer.id)
      if (result?.error) { toast.error(result.error) }
      else {
        toast.success(`${referrer.name} removed from your network`)
        router.push('/network')
      }
    })
  }

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/network')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1 truncate">
            {referrer.name}
          </span>
          <button
            onClick={() => router.push(`/network/${referrer.id}/edit`)}
            className="text-xs text-navy-800/60 hover:text-navy-800 transition-colors font-medium"
          >
            Edit
          </button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Profile card */}
        <div className="card-clinical">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-navy-800/8 flex items-center
                            justify-center flex-shrink-0">
              <span className="text-lg font-medium text-navy-800">{initials(referrer.name)}</span>
            </div>
            <div className="flex-1">
              <h1 className="font-display text-xl text-navy-800">{referrer.name}</h1>
              {referrer.specialty && (
                <p className="text-sm text-navy-800/60">{referrer.specialty}</p>
              )}
              {referrer.clinic_name && (
                <p className="text-sm text-navy-800/50">
                  {referrer.clinic_name}
                  {referrer.clinic_area && ` · ${referrer.clinic_area}`}
                </p>
              )}
              <p className="text-sm text-navy-800/40">{referrer.city}</p>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
              {cfg.label}
            </span>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 py-4 border-y border-navy-800/8 mb-4">
            <div className="text-center">
              <div className="font-display text-2xl text-navy-800">{referrer.total_referrals}</div>
              <div className="data-label">Total referrals</div>
            </div>
            <div className="text-center">
              <div className="font-display text-2xl text-navy-800">
                {referrer.days_since_last ?? '—'}
              </div>
              <div className="data-label">Days since last</div>
            </div>
            <div className="text-center">
              <div className="font-display text-2xl text-navy-800">{logs.length}</div>
              <div className="data-label">Logged cases</div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex gap-2">
            <button
              onClick={() => setShowLogForm(!showLogForm)}
              className="btn-primary flex-1 text-sm py-2.5"
            >
              Log referral
            </button>
            {referrer.whatsapp && (
              <a
                href={`https://wa.me/91${referrer.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 flex-1
                           bg-green-500 text-white rounded-xl text-sm font-medium
                           py-2.5 hover:bg-green-600 active:scale-95 transition-all"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                WhatsApp
              </a>
            )}
            {referrer.mobile && !referrer.whatsapp && (
              <a
                href={`tel:${referrer.mobile}`}
                className="btn-secondary flex-1 text-sm py-2.5 text-center"
              >
                Call
              </a>
            )}
          </div>
        </div>

        {/* Log referral form */}
        {showLogForm && (
          <form onSubmit={handleLogReferral} className="card-clinical space-y-4 animate-slide-up">
            <div className="data-label">Log referral received</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="data-label block mb-1.5">Date</label>
                <input
                  type="date"
                  value={logForm.referred_on}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={e => setLogForm(p => ({ ...p, referred_on: e.target.value }))}
                  className="input-clinical text-sm"
                />
              </div>
              <div>
                <label className="data-label block mb-1.5">Case type</label>
                <select
                  value={logForm.case_type}
                  onChange={e => setLogForm(p => ({ ...p, case_type: e.target.value }))}
                  className="input-clinical text-sm"
                >
                  {CASE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="data-label block mb-1.5">Notes (optional)</label>
              <input
                type="text"
                value={logForm.notes}
                onChange={e => setLogForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Brief case note..."
                className="input-clinical text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={isPending} className="btn-primary flex-1 text-sm py-2.5">
                {isPending ? 'Saving...' : 'Save referral'}
              </button>
              <button type="button" onClick={() => setShowLogForm(false)}
                className="btn-secondary text-sm py-2.5 px-4">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Timeline / Notes tabs */}
        <div className="card-clinical p-0 overflow-hidden">
          <div className="flex border-b border-navy-800/8">
            {(['timeline', 'notes'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-3 text-sm font-medium transition-colors capitalize
                  ${tab === t ? 'text-navy-800 border-b-2 border-navy-800' : 'text-navy-800/40'}`}
              >
                {t === 'timeline' ? `Referral history (${logs.length})` : `Notes (${notes.length})`}
              </button>
            ))}
          </div>

          {tab === 'timeline' && (
            <div>
              {logs.length > 0 ? (
                logs.map((log, idx) => (
                  <div key={log.id}
                    className={`flex items-start gap-3 px-4 py-3.5
                      ${idx < logs.length - 1 ? 'border-b border-navy-800/5' : ''}`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-navy-800/5 flex items-center
                                    justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-mono text-navy-800/50">
                        {new Date(log.referred_on).getDate()}
                      </span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-navy-800 capitalize">
                          {log.case_type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-navy-800/40">
                          {formatDate(log.referred_on)}
                        </span>
                      </div>
                      {log.notes && (
                        <p className="text-xs text-navy-800/50 mt-0.5">{log.notes}</p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-navy-800/40 mb-3">No referrals logged yet</p>
                  <button
                    onClick={() => setShowLogForm(true)}
                    className="text-sm font-medium text-navy-800 hover:underline"
                  >
                    Log first referral
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'notes' && (
            <div>
              <div className="px-4 py-3 border-b border-navy-800/5">
                {!showNoteForm ? (
                  <button
                    onClick={() => setShowNoteForm(true)}
                    className="text-sm text-navy-800/60 hover:text-navy-800 transition-colors"
                  >
                    + Add note
                  </button>
                ) : (
                  <form onSubmit={handleAddNote} className="space-y-2">
                    <textarea
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      placeholder="Add a note about this colleague..."
                      rows={3}
                      className="input-clinical text-sm resize-none"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button type="submit" disabled={isPending || !noteText.trim()}
                        className="btn-primary text-xs py-2 px-4">
                        Save note
                      </button>
                      <button type="button" onClick={() => { setShowNoteForm(false); setNoteText('') }}
                        className="btn-secondary text-xs py-2 px-4">
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
              {notes.length > 0 ? (
                notes.map((note, idx) => (
                  <div key={note.id}
                    className={`px-4 py-3.5 ${idx < notes.length - 1 ? 'border-b border-navy-800/5' : ''}`}
                  >
                    <p className="text-sm text-navy-800 leading-relaxed">{note.note}</p>
                    <p className="text-xs text-navy-800/35 mt-1">
                      {formatDate(note.noted_at)}
                    </p>
                  </div>
                ))
              ) : (
                !showNoteForm && (
                  <div className="text-center py-6 text-sm text-navy-800/40">
                    No notes yet
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {/* Danger zone */}
        <div className="pt-2">
          {!showDelete ? (
            <button
              onClick={() => setShowDelete(true)}
              className="w-full text-center text-xs text-red-400 hover:text-red-500 transition-colors py-2"
            >
              Remove from network
            </button>
          ) : (
            <div className="card-clinical border-red-200/60 bg-red-50/50">
              <p className="text-sm text-red-700 mb-3 font-medium">
                Remove {referrer.name} from your network?
              </p>
              <p className="text-xs text-red-600/70 mb-4">
                Their referral history will be preserved. You can restore them later.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={isPending}
                  className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm
                             font-medium hover:bg-red-700 active:scale-95 transition-all"
                >
                  {isPending ? 'Removing...' : 'Yes, remove'}
                </button>
                <button
                  onClick={() => setShowDelete(false)}
                  className="btn-secondary flex-1 text-sm py-2.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

      </main>
    </div>
  )
}
