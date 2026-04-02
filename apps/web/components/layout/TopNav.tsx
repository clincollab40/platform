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

export default function TopNav({ specialist }: { specialist: Specialist }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen]   = useState(false)
  const [searchVal, setSearchVal] = useState('')

  const pageTitle = Object.entries(BREADCRUMBS).find(([k]) => pathname.startsWith(k))?.[1] ?? 'ClinCollab'

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <header className="top-nav">
      {/* Left — breadcrumb (hidden on mobile, space taken by hamburger) */}
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
            placeholder="Search colleagues, referrals, cases..."
            className="w-full pl-8 pr-4 py-2 text-sm bg-clinical-light border border-navy-800/10 rounded-xl
                       placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-navy-800/15
                       focus:bg-white transition-all duration-200"
          />
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Notifications */}
        <button className="relative p-2 rounded-xl text-ink/40 hover:text-ink/70 hover:bg-navy-800/5 transition-colors">
          <Bell size={18} />
          {/* Badge — show when there are notifications */}
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
                <span className="text-white text-xs font-semibold">{specialist.name.charAt(0)}</span>
              </div>
            )}
            <span className="text-sm font-medium text-ink hidden sm:block">
              {specialist.name.split(' ')[0]}
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
