/**
 * /org-admin — entry point
 * Resolves the current specialist's org and redirects to their org admin dashboard.
 * Super admins are redirected to /admin (they use the full admin panel).
 */
import { redirect }             from 'next/navigation'
import { getMyOrgAction }       from '@/app/actions/org-admin'

export default async function OrgAdminIndexPage() {
  const r = await getMyOrgAction()
  if (!r.ok) redirect('/dashboard')

  const { orgId, orgRole, isSuper } = r.value

  if (isSuper)       redirect('/admin')
  if (!orgId)        redirect('/dashboard')

  redirect(`/org-admin/${orgId}`)
}
