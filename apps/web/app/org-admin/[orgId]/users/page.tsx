import { redirect }             from 'next/navigation'
import { listOrgUsersAction, getOrgInvitationsAction } from '@/app/actions/org-admin'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import OrgUsersClient          from './org-users-client'

export const metadata = { title: 'User Management — ClinCollab Org Admin' }

export default async function OrgUsersPage({ params }: { params: { orgId: string } }) {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const sc = createServiceRoleClient()
  const { data: me } = await sc.from('specialists')
    .select('id, role').eq('google_id', user.id).single()
  if (!me) redirect('/auth/login')

  const [usersRes, invitesRes] = await Promise.all([
    listOrgUsersAction(params.orgId),
    getOrgInvitationsAction(params.orgId),
  ])

  // Determine my org role
  let orgRole = 'member'
  if (me.role === 'admin') {
    orgRole = 'owner'
  } else {
    const { data: mem } = await sc.from('org_specialists')
      .select('org_role').eq('specialist_id', me.id)
      .eq('org_id', params.orgId).eq('is_active', true).single()
    orgRole = mem?.org_role || 'member'
  }

  return (
    <OrgUsersClient
      orgId={params.orgId}
      mySpecialistId={me.id}
      myOrgRole={orgRole}
      users={usersRes.ok ? usersRes.value : []}
      invitations={invitesRes.ok ? invitesRes.value : []}
    />
  )
}
