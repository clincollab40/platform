import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AdminConfigClient from './admin-config-client'
import { getAuditLogAction } from '@/app/actions/admin'

export default async function AdminConfigPage() {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: adminSpec } = await db
    .from('specialists').select('id, name, role').eq('google_id', user.id).single()
  if (!adminSpec || adminSpec.role !== 'admin') redirect('/dashboard')

  const [auditResult] = await Promise.all([
    getAuditLogAction(undefined, 200),   // global — no org filter
  ])

  const { data: flags } = await db
    .from('feature_flag_registry')
    .select('*')
    .order('module_key').order('flag_key')

  return (
    <AdminConfigClient
      auditLog={auditResult.ok ? auditResult.value : []}
      flags={flags || []}
      admin={adminSpec}
    />
  )
}
