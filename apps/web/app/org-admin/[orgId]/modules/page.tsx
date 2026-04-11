import { redirect }             from 'next/navigation'
import { getOrgModulesAction }  from '@/app/actions/org-admin'
import OrgModulesClient         from './org-modules-client'

export const metadata = { title: 'Module Overview — ClinCollab Org Admin' }

export default async function OrgModulesPage({ params }: { params: { orgId: string } }) {
  const r = await getOrgModulesAction(params.orgId)
  if (!r.ok) redirect(`/org-admin/${params.orgId}`)

  return <OrgModulesClient orgId={params.orgId} config={r.value.config} flags={r.value.flags} />
}
