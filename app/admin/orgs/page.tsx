import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import AdminDashboardClient from '../admin-dashboard-client'
import { getPlatformSummaryAction, listOrgsAction } from '@/app/actions/admin'

export default async function AdminOrgsPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: adminSpec } = await supabase
    .from('specialists').select('id, name, role').eq('google_id', user.id).single()
  if (!adminSpec || adminSpec.role !== 'admin') redirect('/dashboard')

  const [summaryResult, orgsResult] = await Promise.all([
    getPlatformSummaryAction(),
    listOrgsAction(),
  ])

  const { data: plans } = await supabase
    .from('plan_definitions')
    .select('tier, display_name, enabled_modules, default_max_specialists')
    .order('tier')

  return (
    <AdminDashboardClient
      admin={adminSpec}
      summary={summaryResult.ok ? summaryResult.value : null}
      orgs={orgsResult.ok ? orgsResult.value : []}
      plans={plans || []}
      defaultTab="orgs"
    />
  )
}
