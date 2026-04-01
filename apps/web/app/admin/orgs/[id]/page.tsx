import { redirect, notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import OrgDetailClient from './org-detail-client'
import { getOrgAction, getUsageAnalyticsAction, getAuditLogAction } from '@/app/actions/admin'

export default async function OrgDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: adminSpec } = await supabase
    .from('specialists').select('id, name, role').eq('google_id', user.id).single()
  if (!adminSpec || adminSpec.role !== 'admin') redirect('/dashboard')

  const [orgResult, usageResult, auditResult] = await Promise.all([
    getOrgAction(params.id),
    getUsageAnalyticsAction(params.id, '30d'),
    getAuditLogAction(params.id, 20),
  ])

  if (!orgResult.ok) notFound()

  const { data: flagRegistry } = await supabase
    .from('feature_flag_registry')
    .select('flag_key, module_key, display_name, description, default_value, risk_level, requires_admin')
    .order('module_key')

  const { data: allSpecialists } = await supabase
    .from('specialists').select('id, name, specialty, email, status').order('name').limit(100)

  return (
    <OrgDetailClient
      org={orgResult.value}
      usage={usageResult.ok ? usageResult.value : null}
      auditLog={auditResult.ok ? auditResult.value : []}
      flagRegistry={flagRegistry || []}
      allSpecialists={allSpecialists || []}
      admin={adminSpec}
    />
  )
}
