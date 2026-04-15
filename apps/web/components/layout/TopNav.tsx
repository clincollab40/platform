'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter, usePathname } from 'next/navigation'
import { Bell, Search, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Specialist = {
  id: string
  name: string
  specialty: string
  role: string
  photo?: string
}

const BREADCRUMBS: Record<string, string> = {
  '/dashboard':                   'Dashboard',
  '/network':                     'Peer Network',
  '/network/add':                 'Add Colleague',
  '/referrals':                   'Referrals',
  '/appointments':                'Appointments',
  '/chatbot/config':              'AI Chatbot',
  '/triage/sessions':             'Triage Sessions',
  '/triage/builder':              'Protocol Builder',
  '/synthesis':                   '360° Synthesis',
  '/transcription':               'Transcription',
  '/procedures':                  'Procedure Planner',
  '/procedures/communications':   'Procedure Comms',
  '/content':                     'Content Studio',
  '/admin':                       'Admin Panel',
}

// WhatsApp SVG icon (inline, no external dep)
function WaIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}

const WA_SUPPORT = '918008007070'

export default function TopNav({ specialist }: { specialist: Specialist }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [menuOpen,   setMenuOpen]   = useState(false)
  const [searchVal,  setSearchVal]  = useState('')

  const pageTitle = Object.entries(BREADCRUMBS).find(([k]) => pathname.startsWith(k))?.[1] ?? 'ClinCollab'

  // Strip "Dr." prefix for display name
  const displayName = specialist.name.replace(/^dr\.?\s+/i, '').split(' ')[0] || specialist.name.split(' ')[0]

  // Global search — navigate current page with ?q= param on Enter
  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !searchVal.trim()) return
    const q = encodeURIComponent(searchVal.trim())
    // Route to the module that best handles search
    if (pathname.startsWith('/network'))      router.push(`/network?q=${q}`)
    else if (pathname.startsWith('/referrals')) router.push(`/referrals?q=${q}`)
    else if (pathname.startsWith('/triage'))   router.push(`/triage/sessions?q=${q}`)
    else if (pathname.startsWith('/synthesis')) router.push(`/synthesis?q=${q}`)
    else if (pathname.startsWith('/appointments')) router.push(`/appointments?q=${q}`)
    else router.push(`/referrals?q=${q}`)   // default: referrals search
  }

  function openWhatsAppSupport() {
    const msg = encodeURIComponent('Hi ClinCollab team, I need support with my account.')
    window.open(`https://wa.me/${WA_SUPPORT}?text=${msg}`, '_blank')
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <header className="top-nav">
      {/* Left — breadcrumb */}
      <div className="hidden lg:block flex-shrink-0">
        <span className="text-sm font-medium text-ink/60">{pageTitle}</span>
      </div>

      {/* Search — grows to fill */}
      <div className="flex-1 max-w-md mx-auto lg:mx-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input
            type="text"
            value={searchVal}
            onChange={e => setSearchVal(e.target.value)}
            onKeyDown={handleSearchKey}
            placeholder="Search colleagues, referrals, cases… (Enter)"
            className="w-full pl-8 pr-4 py-2 text-sm bg-clinical-light border border-navy-800/10 rounded-xl
                       placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-navy-800/15
                       focus:bg-white transition-all duration-200"
          />
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2 flex-shrink-0">

        {/* WhatsApp Support button */}
        <button
          onClick={openWhatsAppSupport}
          title="WhatsApp for Support"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold
                     text-white bg-[#25D366] hover:bg-[#1ebe5d] active:scale-95 transition-all"
        >
          <WaIcon />
          <span className="hidden md:inline">WhatsApp Support</span>
        </button>

        {/* Notifications */}
        <button className="relative p-2 rounded-xl text-ink/40 hover:text-ink/70 hover:bg-navy-800/5 transition-colors">
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* Profile menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2.5 pl-1 pr-3 py-1.5 rounded-xl hover:bg-navy-800/5 transition-colors"
          >
            {specialist.photo ? (
              <Image src={specialist.photo} alt="" width={30} height={30} className="rounded-full flex-shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-navy-800 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-semibold">{displayName.charAt(0)}</span>
              </div>
            )}
            <span className="text-sm font-medium text-ink hidden sm:block">
              Dr. {displayName}
            </span>
            <ChevronDown size={14} className="text-ink/40 hidden sm:block" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-12 bg-white border border-navy-800/10 rounded-2xl
                              shadow-clinical-lg py-1.5 w-52 z-50 animate-fade-in">
                <div className="px-4 py-3 border-b border-navy-800/6">
                  <div className="text-sm font-medium text-ink">{specialist.name}</div>
                  <div className="text-xs text-ink/40 mt-0.5 font-mono uppercase tracking-wide">
                    {specialist.role}
                  </div>
                </div>
                <button onClick={() => { router.push('/profile'); setMenuOpen(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-navy-50 transition-colors">
                  My Profile
                </button>
                {specialist.role === 'admin' && (
                  <button onClick={() => { router.push('/admin'); setMenuOpen(false) }}
                    className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-navy-50 transition-colors">
                    Admin Panel
                  </button>
                )}
                <div className="border-t border-navy-800/6 mt-1 pt-1">
                  <button onClick={handleSignOut}
                    className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors rounded-b-2xl">
                    Sign Out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
