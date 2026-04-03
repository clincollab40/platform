import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AdminPlansClient from './admin-plans-client'

export default async function AdminPlansPage() {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: adminSpec } = await db
    .from('specialists').select('id, name, role').eq('google_id', user.id).single()
  if (!adminSpec || adminSpec.role !== 'admin') redirect('/dashboard')

  const { data: plans } = await db
    .from('plan_definitions')
    .select('*')
    .order('tier')

  const { data: flags } = await db
    .from('feature_flag_registry')
    .select('*')
    .order('module_key')

  const { data: orgCounts } = await db
    .from('organisations')
    .select('plan_tier')

  const tierCounts: Record<string, number> = {}
  for (const o of orgCounts || []) tierCounts[(o as any).plan_tier] = (tierCounts[(o as any).plan_tier] || 0) + 1

  return (
    <AdminPlansClient
      plans={plans || []}
      flags={flags || []}
      tierCounts={tierCounts}
      admin={adminSpec}
    />
  )
}
