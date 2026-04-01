'use client'

import { useState, useMemo } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

type Appointment = {
  id: string
  patient_name: string
  patient_mobile: string
  patient_gender: string | null
  reason: string | null
  channel: string
  status: string
  notes: string | null
  booked_at: string
  updated_at: string
  appointment_slots: { slot_date: string; slot_time: string; duration_mins: number } | null
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  confirmed:   { label: 'Confirmed',   bg: 'bg-emerald-50', text: 'text-emerald-700' },
  rescheduled: { label: 'Rescheduled', bg: 'bg-amber-50',   text: 'text-amber-700'   },
  cancelled:   { label: 'Cancelled',   bg: 'bg-red-50',     text: 'text-red-600'     },
  completed:   { label: 'Completed',   bg: 'bg-gray-100',   text: 'text-gray-500'    },
  no_show:     { label: 'No show',     bg: 'bg-red-50',     text: 'text-red-400'     },
}

const CHANNEL_CONFIG: Record<string, string> = {
  whatsapp: 'WhatsApp',
  web_widget: 'Web',
  manual: 'Manual',
  referral: 'Referral',
}

function formatSlotDate(date: string) {
  const d = new Date(date)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date === today.toISOString().split('T')[0]) return 'Today'
  if (date === tomorrow.toISOString().split('T')[0]) return 'Tomorrow'
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

function formatTime(time: string) {
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

type ViewFilter = 'today' | 'upcoming' | 'all'

export default function AppointmentsClient({
  specialist,
  appointments,
  todayCount,
}: {
  specialist: { id: string; name: string; specialty: string }
  appointments: Appointment[]
  todayCount: number
}) {
  const router = useRouter()
  const [view, setView]   = useState<ViewFilter>('today')
  const [query, setQuery] = useState('')

  const today    = new Date().toISOString().split('T')[0]
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  const nextWeek = new Date()
  nextWeek.setDate(nextWeek.getDate() + 7)
  const nextWeekStr = nextWeek.toISOString().split('T')[0]

  const displayed = useMemo(() => {
    let list = [...appointments]

    if (view === 'today') {
      list = list.filter(a => a.appointment_slots?.slot_date === today)
    } else if (view === 'upcoming') {
      list = list.filter(a => {
        const d = a.appointment_slots?.slot_date
        return d && d >= today && d <= nextWeekStr
      })
    }

    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(a =>
        a.patient_name.toLowerCase().includes(q) ||
        a.patient_mobile.includes(q) ||
        a.reason?.toLowerCase().includes(q)
      )
    }

    // Sort by slot date + time
    return list.sort((a, b) => {
      const dateA = `${a.appointment_slots?.slot_date}${a.appointment_slots?.slot_time}`
      const dateB = `${b.appointment_slots?.slot_date}${b.appointment_slots?.slot_time}`
      return dateA.localeCompare(dateB)
    })
  }, [appointments, view, query, today, nextWeekStr])

  async function updateStatus(id: string, status: string) {
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        toast.success('Appointment updated')
        router.refresh()
      }
    } catch {
      toast.error('Could not update appointment')
    }
  }

  const upcomingCount = appointments.filter(a => {
    const d = a.appointment_slots?.slot_date
    return d && d >= today && d <= nextWeekStr && a.status === 'confirmed'
  }).length

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <span className="font-sans font-medium text-navy-800 flex-1">Appointments</span>
          <button
            onClick={() => router.push('/chatbot/config')}
            className="text-xs text-navy-800/60 hover:text-navy-800 transition-colors font-medium">
            Configure chatbot
          </button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Today', value: todayCount, action: () => setView('today') },
            { label: 'This week', value: upcomingCount, action: () => setView('upcoming') },
            { label: 'Total', value: appointments.length, action: () => setView('all') },
          ].map(stat => (
            <button key={stat.label} onClick={stat.action}
              className="card-clinical text-center p-3 hover:bg-navy-50 transition-colors">
              <div className="font-display text-2xl text-navy-800">{stat.value}</div>
              <div className="data-label">{stat.label}</div>
            </button>
          ))}
        </div>

        {/* View filter */}
        <div className="flex gap-1.5">
          {(['today', 'upcoming', 'all'] as ViewFilter[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-2 rounded-xl text-xs font-medium capitalize
                transition-all border flex-shrink-0
                ${view === v
                  ? 'bg-navy-800 text-white border-navy-800'
                  : 'bg-white text-navy-800/60 border-navy-800/15 hover:border-navy-800/30'}`}>
              {v === 'upcoming' ? 'Next 7 days' : v}
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
            placeholder="Search by patient name or mobile..."
            className="input-clinical pl-9" />
        </div>

        {/* Appointments list */}
        {displayed.length > 0 ? (
          <div className="card-clinical p-0 overflow-hidden">
            {displayed.map((appt, idx) => {
              const slot = appt.appointment_slots
              const cfg  = STATUS_CONFIG[appt.status] || STATUS_CONFIG.confirmed
              return (
                <div key={appt.id}
                  className={`px-4 py-4 ${idx < displayed.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                  <div className="flex items-start gap-3">
                    {/* Time column */}
                    <div className="w-16 flex-shrink-0 text-center">
                      {slot ? (
                        <>
                          <div className="text-xs font-medium text-navy-800">
                            {formatTime(slot.slot_time)}
                          </div>
                          <div className="text-2xs text-navy-800/40">
                            {formatSlotDate(slot.slot_date)}
                          </div>
                        </>
                      ) : (
                        <div className="text-2xs text-navy-800/30">No slot</div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-navy-800">{appt.patient_name}</span>
                        <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
                          {cfg.label}
                        </span>
                        <span className="text-2xs text-navy-800/30">
                          {CHANNEL_CONFIG[appt.channel] || appt.channel}
                        </span>
                      </div>
                      {appt.reason && (
                        <div className="text-xs text-navy-800/50 truncate">{appt.reason}</div>
                      )}
                      <div className="text-xs text-navy-800/35 mt-0.5">{appt.patient_mobile}</div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <a
                        href={`https://wa.me/91${appt.patient_mobile.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-8 h-8 bg-green-50 rounded-lg flex items-center
                                   justify-center hover:bg-green-100 transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#16a34a">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                      </a>

                      {appt.status === 'confirmed' && (
                        <button
                          onClick={() => updateStatus(appt.id, 'completed')}
                          className="text-2xs text-navy-800/50 hover:text-forest-700
                                     transition-colors px-2 py-1 rounded-lg hover:bg-forest-50"
                        >
                          Mark done
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="card-clinical text-center py-10">
            <div className="w-12 h-12 bg-navy-800/5 rounded-2xl flex items-center
                            justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                   className="text-navy-800/40">
                <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M8 15h8M8 18h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h3 className="font-display text-xl text-navy-800 mb-2">
              {view === 'today' ? 'No appointments today' : 'No appointments'}
            </h3>
            <p className="text-sm text-navy-800/50 mb-5 max-w-xs mx-auto">
              {view === 'today'
                ? 'Set up your chatbot to let patients book appointments via WhatsApp'
                : 'Appointments booked via WhatsApp or web widget will appear here'}
            </p>
            <button onClick={() => router.push('/chatbot/config')} className="btn-primary">
              Configure chatbot
            </button>
          </div>
        )}

      </main>
    </div>
  )
}
