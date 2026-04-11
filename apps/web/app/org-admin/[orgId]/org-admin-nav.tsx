'use client'

import { usePathname, useRouter } from 'next/navigation'
import Image from 'next/image'

const TIER_COLOURS: Record<string, string> = {
  starter:      'bg-slate-600',
  growth:       'bg-blue-600',
  professional: 'bg-purple-600',
  enterprise:   'bg-amber-600',
  custom:       'bg-navy-700',
}

export default function OrgAdminNav({ org, specialist, orgRole }: {
  org:        { id: string; name: string; slug: string; plan_tier: string; status: string }
  specialist: { name: string; photo?: string }
  orgRole:    string
}) {
  const router   = useRouter()
  const pathname = usePathname()
  const base     = `/org-admin/${org.id}`

  const tabs = [
    { label: 'Dashboard', path: base },
    { label: 'Users',     path: `${base}/users` },
    { label: 'Modules',   path: `${base}/modules` },
  ]

  return (
    <nav className="bg-navy-900 border-b border-navy-700 sticky top-0 z-40">
      <div className="max-w-4xl mx-auto px-4">
        {/* Top bar */}
        <div className="h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-navy-400 hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <Image src="/logo.png" alt="" width={24} height={24} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">{org.name}</div>
            <div className="flex items-center gap-2">
              <span className={`text-2xs px-1.5 py-0.5 rounded text-white capitalize font-medium ${TIER_COLOURS[org.plan_tier] || 'bg-navy-700'}`}>
                {org.plan_tier}
              </span>
              <span className={`text-2xs capitalize ${org.status === 'active' ? 'text-forest-400' : org.status === 'trial' ? 'text-amber-400' : 'text-red-400'}`}>
                {org.status}
              </span>
              <span className="text-2xs text-navy-400 capitalize">· You are {orgRole}</span>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex">
          {tabs.map(t => {
            const isActive = t.path === base ? pathname === base : pathname.startsWith(t.path)
            return (
              <button key={t.path} onClick={() => router.push(t.path)}
                className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors
                  ${isActive ? 'text-white border-white' : 'text-navy-400 border-transparent hover:text-white/70'}`}>
                {t.label}
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
