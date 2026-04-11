'use client'

import { usePathname, useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  LayoutDashboard, Users, FileText, Calendar, MessageCircle,
  ClipboardList, Sparkles, Mic, Activity, Bell, BookOpen,
  Settings, ChevronLeft, Menu, X, Building2,
} from 'lucide-react'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Specialist = {
  id: string
  name: string
  specialty: string
  role: string
  photo?: string
}

type SidebarProps = {
  specialist: Specialist
  orgId?:    string | null
  orgRole?:  string | null
}

const SPECIALTY_SHORT: Record<string, string> = {
  interventional_cardiology: 'Int. Cardiology',
  cardiac_surgery: 'Cardiac Surgery',
  cardiology: 'Cardiology',
  orthopedics: 'Orthopaedics',
  spine_surgery: 'Spine Surgery',
  neurology: 'Neurology',
  neurosurgery: 'Neurosurgery',
  gi_surgery: 'GI Surgery',
  urology: 'Urology',
  oncology: 'Oncology',
  reproductive_medicine: 'Repro. Medicine',
  dermatology: 'Dermatology',
  ophthalmology: 'Ophthalmology',
  internal_medicine: 'Internal Medicine',
  electrophysiology: 'Electrophysiology',
  vascular_surgery: 'Vascular Surgery',
  endocrinology: 'Endocrinology',
  nephrology: 'Nephrology',
  pulmonology: 'Pulmonology',
  pediatrics: 'Pediatrics',
  radiology: 'Radiology',
  anesthesiology: 'Anesthesiology',
  rheumatology: 'Rheumatology',
  ent: 'ENT',
  other: 'Specialist',
}

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard',    path: '/dashboard',        icon: LayoutDashboard },
    ],
  },
  {
    label: 'Practice',
    items: [
      { label: 'Network',      path: '/network',          icon: Users },
      { label: 'Referrals',    path: '/referrals',        icon: FileText },
      { label: 'Appointments', path: '/appointments',     icon: Calendar },
    ],
  },
  {
    label: 'Clinical AI',
    items: [
      { label: 'Chatbot',      path: '/chatbot/config',   icon: MessageCircle },
      { label: 'Triage',       path: '/triage/sessions',  icon: ClipboardList },
      { label: 'Synthesis',    path: '/synthesis',        icon: Sparkles },
      { label: 'Transcription',path: '/transcription',    icon: Mic },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Procedures',   path: '/procedures',       icon: Activity },
      { label: 'Comms',        path: '/procedures/communications', icon: Bell },
      { label: 'Content',      path: '/content',          icon: BookOpen },
    ],
  },
]

export default function Sidebar({ specialist, orgId, orgRole }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  function isActive(path: string) {
    if (path === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(path)
  }

  const specialtyLabel = SPECIALTY_SHORT[specialist.specialty] ?? 'Specialist'

  const navContent = (
    <div className={`sidebar-nav transition-all duration-200 ${collapsed ? 'w-16' : 'w-sidebar'}`}
      style={{ width: collapsed ? '64px' : undefined }}>

      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 flex-shrink-0">
        <Image src="/logo.png" alt="ClinCollab" width={32} height={32} className="flex-shrink-0" />
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-display text-base text-white leading-tight">ClinCollab</div>
            <div className="text-2xs text-white/30 font-mono truncate">Practice Intelligence</div>
          </div>
        )}
      </div>

      {/* Collapse toggle — desktop only */}
      <div className="hidden lg:flex justify-end px-3 mb-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
        >
          <ChevronLeft size={14} className={`transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 px-1 space-y-5 pb-4">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            {!collapsed && (
              <div className="sidebar-section-label px-3 mb-1">{group.label}</div>
            )}
            <div className="space-y-0.5">
              {group.items.map(item => {
                const Icon = item.icon
                const active = isActive(item.path)
                return (
                  <button
                    key={item.path}
                    onClick={() => { router.push(item.path); setMobileOpen(false) }}
                    title={collapsed ? item.label : undefined}
                    className={`sidebar-item w-full ${active ? 'sidebar-item-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
                  >
                    <Icon size={18} className="sidebar-icon flex-shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* System — Super Admin */}
        {specialist.role === 'admin' && (
          <div>
            {!collapsed && <div className="sidebar-section-label px-3 mb-1">System</div>}
            <button
              onClick={() => { router.push('/admin'); setMobileOpen(false) }}
              className={`sidebar-item w-full ${isActive('/admin') ? 'sidebar-item-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <Settings size={18} className="sidebar-icon flex-shrink-0" />
              {!collapsed && <span>Admin</span>}
            </button>
          </div>
        )}

        {/* Org Admin — org owners and admins */}
        {specialist.role !== 'admin' && orgId && orgRole && ['owner','admin'].includes(orgRole) && (
          <div>
            {!collapsed && <div className="sidebar-section-label px-3 mb-1">Organisation</div>}
            <button
              onClick={() => { router.push(`/org-admin/${orgId}`); setMobileOpen(false) }}
              title={collapsed ? 'Org Admin' : undefined}
              className={`sidebar-item w-full ${isActive('/org-admin') ? 'sidebar-item-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <Building2 size={18} className="sidebar-icon flex-shrink-0" />
              {!collapsed && <span>Org Admin</span>}
            </button>
          </div>
        )}
      </nav>

      {/* User footer */}
      <div className="flex-shrink-0 border-t p-3" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
          {specialist.photo ? (
            <Image src={specialist.photo} alt="" width={32} height={32}
              className="rounded-full flex-shrink-0 ring-2 ring-white/10" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-navy-800 ring-2 ring-white/10 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-semibold">
                {specialist.name.charAt(0)}
              </span>
            </div>
          )}
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">{specialist.name}</div>
              <div className="text-2xs truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>{specialtyLabel}</div>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={handleSignOut}
            className="mt-3 w-full text-left text-2xs font-mono uppercase tracking-wider transition-colors"
            style={{ color: 'rgba(255,255,255,0.28)' }}
            onMouseOver={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.6)')}
            onMouseOut={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.28)')}
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden lg:block h-full flex-shrink-0">
        {navContent}
      </div>

      {/* Mobile hamburger */}
      <div className="lg:hidden fixed top-0 left-0 z-50 p-3">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded-xl bg-sidebar text-white/70 hover:text-white"
        >
          <Menu size={20} />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
            {navContent}
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)}>
            <button className="absolute top-4 right-4 text-white/70 hover:text-white">
              <X size={24} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
