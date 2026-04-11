import { redirect }                        from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import ProvisioningWizardClient            from './provisioning-wizard-client'

export const metadata = { title: 'Provision New Organisation — ClinCollab Admin' }

export default async function ProvisionNewOrgPage() {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()
  const { data: adminSpec } = await db
    .from('specialists').select('id, name, role').eq('google_id', user.id).single()
  if (!adminSpec || adminSpec.role !== 'admin') redirect('/dashboard')

  const { data: plans } = await db
    .from('plan_definitions')
    .select('tier, display_name, enabled_modules, default_max_specialists, monthly_price_inr')
    .order('tier')

  return <ProvisioningWizardClient admin={adminSpec} plans={plans || []} />
}
