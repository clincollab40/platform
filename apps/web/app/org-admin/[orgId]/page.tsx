import { redirect }                from 'next/navigation'
import { getOrgOverviewAction }     from '@/app/actions/org-admin'
import OrgAdminDashboardClient      from './org-admin-dashboard-client'

export const metadata = { title: 'Org Admin Dashboard — ClinCollab' }

export default async function OrgAdminDashboardPage({ params }: { params: { orgId: string } }) {
  const r = await getOrgOverviewAction(params.orgId)
  if (!r.ok) redirect('/dashboard')

  const { org, activeSpecialists, enabledModules, eventsLast30d } = r.value

  return (
    <OrgAdminDashboardClient
      org={org}
      activeSpecialists={activeSpecialists}
      enabledModules={enabledModules}
      eventsLast30d={eventsLast30d}
    />
  )
}
