import { redirect }     from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import OrgAdminNav      from './org-admin-nav'

export default async function OrgAdminLayout({
  children, params,
}: {
  children: React.ReactNode
  params: { orgId: string }
}) {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const sc = createServiceRoleClient()

  const { data: specialist } = await sc.from('specialists')
    .select('id, name, role, specialty, photo').eq('google_id', user.id).single()
  if (!specialist) redirect('/auth/login')

  // Super admin has full access
  let orgRole: string = 'admin'
  if (specialist.role !== 'admin') {
    const { data: membership } = await sc.from('org_specialists')
      .select('org_role').eq('specialist_id', specialist.id)
      .eq('org_id', params.orgId).eq('is_active', true).single()

    if (!membership || !['owner','admin'].includes(membership.org_role)) {
      redirect('/dashboard')
    }
    orgRole = membership.org_role
  }

  const { data: org } = await sc.from('organisations')
    .select('id, name, slug, plan_tier, status').eq('id', params.orgId).single()
  if (!org) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-clinical-light">
      <OrgAdminNav org={org} specialist={specialist} orgRole={orgRole} />
      {children}
    </div>
  )
}
