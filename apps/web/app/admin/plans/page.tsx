import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import AdminPlansClient from './admin-plans-client'

export default async function AdminPlansPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: adminSpec } = await supabase
    .from('specialists').select('id, name, role').eq('google_id', user.id).single()
  if (!adminSpec || adminSpec.role !== 'admin') redirect('/dashboard')

  const { data: plans } = await supabase
    .from('plan_definitions')
    .select('*')
    .order('tier')

  const { data: flags } = await supabase
    .from('feature_flag_registry')
    .select('*')
    .order('module_key')

  const { data: orgCounts } = await supabase
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
