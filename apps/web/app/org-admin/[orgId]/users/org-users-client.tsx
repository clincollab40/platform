'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  updateUserRoleAction, deactivateUserAction, reactivateUserAction,
  orgAdminInviteUserAction, revokeOrgInvitationAction,
} from '@/app/actions/org-admin'

const SPECIALTY_SHORT: Record<string, string> = {
  interventional_cardiology: 'Int. Cardiology',
  cardiac_surgery: 'Cardiac Surgery',
  cardiology: 'Cardiology',
  orthopedics: 'Orthopaedics',
  neurology: 'Neurology',
  gi_surgery: 'GI Surgery',
  urology: 'Urology',
  oncology: 'Oncology',
  dermatology: 'Dermatology',
  internal_medicine: 'Internal Medicine',
  other: 'Specialist',
}

export default function OrgUsersClient({
  orgId, mySpecialistId, myOrgRole, users: initialUsers, invitations: initialInvites,
}: {
  orgId:           string
  mySpecialistId:  string
  myOrgRole:       string
  users:           any[]
  invitations:     any[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [users,       setUsers]       = useState(initialUsers)
  const [invitations, setInvitations] = useState(initialInvites)
  const [activeTab,   setActiveTab]   = useState<'active'|'inactive'|'invitations'>('active')

  // Invite form
  const [inviteEmail,  setInviteEmail]  = useState('')
  const [inviteRole,   setInviteRole]   = useState<'admin'|'member'>('member')
  const [inviteMsg,    setInviteMsg]    = useState('')
  const [inviting,     setInviting]     = useState(false)

  const activeUsers   = users.filter((u: any) => u.is_active)
  const inactiveUsers = users.filter((u: any) => !u.is_active)
  const pendingInvites= invitations.filter((i: any) => i.status === 'pending')

  async function handleInvite() {
    if (!inviteEmail.trim()) { toast.error('Enter an email'); return }
    setInviting(true)
    const r = await orgAdminInviteUserAction({
      orgId, email: inviteEmail, orgRole: inviteRole, message: inviteMsg || undefined,
    })
    setInviting(false)
    if (!r.ok) { toast.error(r.error); return }
    toast.success('Invitation sent')
    setInviteEmail('')
    setInviteMsg('')
    router.refresh()
  }

  function renderUser(user: any, idx: number, listLen: number) {
    const spec   = user.specialists
    const isMe   = spec?.id === mySpecialistId
    const canEdit= ['owner','admin'].includes(myOrgRole) && !isMe

    return (
      <div key={user.specialist_id}
        className={`px-5 py-4 ${idx < listLen - 1 ? 'border-b border-navy-800/5' : ''}`}>
        <div className="flex items-center gap-3">
          {spec?.photo ? (
            <Image src={spec.photo} alt="" width={36} height={36} className="rounded-full flex-shrink-0 ring-1 ring-navy-800/10"/>
          ) : (
            <div className="w-9 h-9 rounded-full bg-navy-100 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-navy-800">
              {spec?.name?.charAt(0) || '?'}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-navy-800">{spec?.name || '—'}</span>
              {isMe && <span className="text-2xs bg-navy-50 text-navy-800/50 px-1.5 py-0.5 rounded">You</span>}
              <span className="text-2xs bg-navy-50 text-navy-800/50 px-1.5 py-0.5 rounded capitalize">{user.org_role}</span>
              {!user.is_active && <span className="text-2xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">Inactive</span>}
            </div>
            <div className="text-xs text-navy-800/40 mt-0.5">
              {SPECIALTY_SHORT[spec?.specialty] || spec?.specialty?.replace(/_/g,' ') || '—'}
              {spec?.email && ` · ${spec.email}`}
            </div>
          </div>

          {/* Actions */}
          {canEdit && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Role selector — only owners can change roles */}
              {myOrgRole === 'owner' && user.is_active && (
                <select
                  defaultValue={user.org_role}
                  onChange={e => startTransition(async () => {
                    const r = await updateUserRoleAction(orgId, user.specialist_id, e.target.value as any)
                    if (!r.ok) toast.error(r.error)
                    else { toast.success('Role updated'); router.refresh() }
                  })}
                  disabled={isPending}
                  className="text-xs border border-navy-800/15 rounded-lg px-2 py-1.5 text-navy-800 bg-white">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              )}

              {/* Deactivate / Reactivate */}
              {user.is_active ? (
                <button
                  onClick={() => {
                    if (!confirm(`Deactivate ${spec?.name}? They will lose access to the platform.`)) return
                    startTransition(async () => {
                      const r = await deactivateUserAction(orgId, user.specialist_id)
                      if (!r.ok) toast.error(r.error)
                      else { toast.success('User deactivated'); router.refresh() }
                    })
                  }}
                  disabled={isPending}
                  className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-2.5 py-1.5 transition-colors">
                  Deactivate
                </button>
              ) : (
                <button
                  onClick={() => startTransition(async () => {
                    const r = await reactivateUserAction(orgId, user.specialist_id)
                    if (!r.ok) toast.error(r.error)
                    else { toast.success('User reactivated'); router.refresh() }
                  })}
                  disabled={isPending}
                  className="text-xs text-forest-700 hover:text-forest-800 border border-forest-200 rounded-lg px-2.5 py-1.5 transition-colors">
                  Reactivate
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-5" id="users">

      {/* Invite form */}
      <div className="bg-white rounded-2xl border border-navy-800/8 p-5" id="invite">
        <div className="data-label mb-3">Invite new user</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="data-label block mb-1">Email address</label>
            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              placeholder="doctor@hospital.com" className="input-clinical"
              onKeyDown={e => e.key === 'Enter' && handleInvite()} />
          </div>
          <div>
            <label className="data-label block mb-1">Role</label>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value as any)} className="input-clinical">
              <option value="member">Member</option>
              {myOrgRole === 'owner' && <option value="admin">Admin</option>}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label className="data-label block mb-1">Personal message (optional)</label>
          <input type="text" value={inviteMsg} onChange={e => setInviteMsg(e.target.value)}
            placeholder="Welcome to our team!" className="input-clinical" />
        </div>
        <div className="mt-3">
          <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}
            className="btn-primary text-sm py-2 px-5 disabled:opacity-40">
            {inviting ? 'Sending…' : 'Send invitation'}
          </button>
        </div>
      </div>

      {/* User list */}
      <div className="bg-white rounded-2xl border border-navy-800/8">
        {/* Tabs */}
        <div className="flex border-b border-navy-800/8">
          {[
            { key:'active',      label:`Active (${activeUsers.length})` },
            { key:'inactive',    label:`Inactive (${inactiveUsers.length})` },
            { key:'invitations', label:`Pending invites (${pendingInvites.length})` },
          ].map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key as any)}
              className={`px-4 py-3 text-xs font-medium border-b-2 transition-colors flex-shrink-0
                ${activeTab === t.key ? 'text-navy-800 border-navy-800' : 'text-navy-800/40 border-transparent hover:text-navy-800/70'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Active users */}
        {activeTab === 'active' && (
          activeUsers.length === 0 ? (
            <div className="text-center py-8 text-sm text-navy-800/40">No active users</div>
          ) : (
            activeUsers.map((u: any, i: number) => renderUser(u, i, activeUsers.length))
          )
        )}

        {/* Inactive users */}
        {activeTab === 'inactive' && (
          inactiveUsers.length === 0 ? (
            <div className="text-center py-8 text-sm text-navy-800/40">No inactive users</div>
          ) : (
            inactiveUsers.map((u: any, i: number) => renderUser(u, i, inactiveUsers.length))
          )
        )}

        {/* Pending invitations */}
        {activeTab === 'invitations' && (
          pendingInvites.length === 0 ? (
            <div className="text-center py-8 text-sm text-navy-800/40">No pending invitations</div>
          ) : (
            pendingInvites.map((inv: any, idx: number) => {
              const expired = new Date(inv.expires_at) < new Date()
              return (
                <div key={inv.id} className={`px-5 py-4 ${idx < pendingInvites.length - 1 ? 'border-b border-navy-800/5' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${expired ? 'bg-red-400' : 'bg-amber-400'}`}/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-navy-800">{inv.email}</span>
                        <span className="text-2xs bg-navy-50 text-navy-800/50 px-1.5 py-0.5 rounded capitalize">{inv.org_role}</span>
                        {expired && <span className="text-2xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">Expired</span>}
                      </div>
                      <div className="text-xs text-navy-800/40 mt-0.5">
                        Sent {new Date(inv.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}
                        {' '}· Expires {new Date(inv.expires_at).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}
                        {inv.specialists?.name && ` · by ${inv.specialists.name}`}
                      </div>
                    </div>
                    <button
                      onClick={() => startTransition(async () => {
                        const r = await revokeOrgInvitationAction(orgId, inv.id)
                        if (!r.ok) toast.error(r.error)
                        else { toast.success('Invitation revoked'); router.refresh() }
                      })}
                      disabled={isPending}
                      className="text-xs text-red-500 hover:text-red-700 transition-colors flex-shrink-0">
                      Revoke
                    </button>
                  </div>
                </div>
              )
            })
          )
        )}
      </div>
    </main>
  )
}
