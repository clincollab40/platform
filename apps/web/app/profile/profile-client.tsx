'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Specialist = {
  id: string
  name: string
  specialty: string
  city: string
  email: string
  role: string
  status: string
  whatsapp_number: string | null
  created_at: string
}

type SpecialistProfile = {
  designation: string | null
  sub_specialty: string | null
  hospitals: string[] | null
  years_experience: number | null
  mci_number: string | null
  photo_url: string | null
  bio: string | null
  completeness_pct: number
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

function memberSince(date: string) {
  const d = new Date(date)
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

export default function ProfileClient({
  specialist,
  profile,
}: {
  specialist: Specialist
  profile: SpecialistProfile | null
}) {
  const router = useRouter()
  const completeness = profile?.completeness_pct ?? 0

  const completeColor =
    completeness >= 80 ? 'bg-emerald-500' :
    completeness >= 50 ? 'bg-amber-500' : 'bg-red-500'

  const completeText =
    completeness >= 80 ? 'text-emerald-700' :
    completeness >= 50 ? 'text-amber-700' : 'text-red-600'

  const hospitals = profile?.hospitals?.filter(Boolean) ?? []

  return (
    <div className="min-h-screen bg-clinical-light">

      {/* Nav */}
      <nav className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-navy-800/50 hover:text-navy-800 transition-colors"
          >
            <ChevronLeft />
          </button>
          <span className="font-sans font-medium text-navy-800 flex-1">My Profile</span>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-xl ${
            specialist.status === 'active' ? 'bg-emerald-50 text-emerald-700' :
            specialist.status === 'onboarding' ? 'bg-amber-50 text-amber-700' :
            'bg-gray-100 text-gray-500'
          }`}>
            {specialist.status.charAt(0).toUpperCase() + specialist.status.slice(1)}
          </span>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Profile card */}
        <div className="card-clinical">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="w-16 h-16 rounded-2xl bg-navy-800 flex items-center justify-center flex-shrink-0">
              {profile?.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.photo_url} alt="" className="w-full h-full rounded-2xl object-cover" />
              ) : (
                <span className="text-white text-xl font-semibold">{initials(specialist.name)}</span>
              )}
            </div>

            {/* Name + details */}
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-xl text-navy-800 font-medium">{specialist.name}</h1>
              {profile?.designation && (
                <p className="text-sm text-navy-800/60 mt-0.5">{profile.designation}</p>
              )}
              <p className="text-sm text-navy-800/50 mt-0.5">
                {specialist.specialty}
                {profile?.sub_specialty && ` · ${profile.sub_specialty}`}
              </p>
              <p className="text-xs text-navy-800/40 mt-1">
                {specialist.city} · Member since {memberSince(specialist.created_at)}
              </p>
            </div>
          </div>

          {/* Profile completeness */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="data-label">Profile completeness</span>
              <span className={`text-sm font-semibold ${completeText}`}>{completeness}%</span>
            </div>
            <div className="h-1.5 bg-navy-800/8 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${completeColor}`}
                style={{ width: `${completeness}%` }}
              />
            </div>
            {completeness < 100 && (
              <p className="text-xs text-navy-800/40 mt-1.5">
                Complete your profile to improve peer discoverability
              </p>
            )}
          </div>
        </div>

        {/* Bio */}
        {profile?.bio ? (
          <div className="card-clinical">
            <div className="data-label mb-2">About</div>
            <p className="text-sm text-navy-800/70 leading-relaxed">{profile.bio}</p>
          </div>
        ) : (
          <div className="card-clinical border border-dashed border-navy-800/15 bg-navy-50/40 text-center py-6">
            <p className="text-sm text-navy-800/40 mb-2">No professional bio yet</p>
            <p className="text-xs text-navy-800/30">A bio helps referral partners understand your clinical focus</p>
          </div>
        )}

        {/* Clinical details */}
        <div className="card-clinical space-y-4">
          <div className="data-label">Clinical details</div>

          <InfoRow label="Specialty" value={specialist.specialty} />
          {profile?.sub_specialty && (
            <InfoRow label="Sub-specialty" value={profile.sub_specialty} />
          )}
          {profile?.years_experience != null && (
            <InfoRow label="Experience" value={`${profile.years_experience} years`} />
          )}
          {profile?.mci_number ? (
            <InfoRow label="MCI Registration" value={profile.mci_number} mono />
          ) : (
            <InfoRow label="MCI Registration" value="Not added" muted />
          )}
          <InfoRow label="Practice city" value={specialist.city} />

          {hospitals.length > 0 && (
            <div>
              <div className="text-xs text-navy-800/40 mb-1.5">Affiliated hospitals</div>
              <div className="flex flex-wrap gap-1.5">
                {hospitals.map((h, i) => (
                  <span key={i} className="text-xs bg-navy-800/5 text-navy-800/70 px-2.5 py-1 rounded-xl">
                    {h}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Contact */}
        <div className="card-clinical space-y-4">
          <div className="data-label">Contact & access</div>
          <InfoRow label="Email" value={specialist.email} mono />
          <InfoRow
            label="WhatsApp"
            value={specialist.whatsapp_number || 'Not added'}
            muted={!specialist.whatsapp_number}
            mono={!!specialist.whatsapp_number}
          />
          <InfoRow label="Platform role" value={specialist.role.charAt(0).toUpperCase() + specialist.role.slice(1)} />
        </div>

        {/* Actions */}
        <div className="card-clinical">
          <p className="text-xs text-navy-800/40 text-center">
            To update your profile details, contact your organisation administrator or reach out
            to ClinCollab support.
          </p>
        </div>

        <div className="pb-8" />
      </main>
    </div>
  )
}

function InfoRow({
  label,
  value,
  mono = false,
  muted = false,
}: {
  label: string
  value: string
  mono?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-navy-800/40 flex-shrink-0 w-36">{label}</span>
      <span className={`text-sm text-right flex-1 ${
        muted ? 'text-navy-800/30 italic' :
        mono ? 'font-mono text-navy-800/70 text-xs' :
        'text-navy-800/80'
      }`}>
        {value}
      </span>
    </div>
  )
}

function ChevronLeft() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
