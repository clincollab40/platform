'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient }                from '@supabase/supabase-js'
import { redirect }                    from 'next/navigation'
import { revalidatePath }              from 'next/cache'

type BR<T> = { ok: true; value: T } | { ok: false; error: string }
async function b<T>(name: string, fn: () => Promise<T>): Promise<BR<T>> {
  try   { return { ok: true, value: await fn() } }
  catch (e) { console.error(`[M11:${name}]`, e); return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

async function getAdmin() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const { data: s } = await supabase.from('specialists')
    .select('id, name, role').eq('google_id', user.id).single()
  if (!s || s.role !== 'admin') redirect('/dashboard')
  return { supabase, admin: s }
}

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

async function auditLog(sc: ReturnType<typeof svc>, params: {
  orgId?: string; specialistId?: string; changedBy: string
  changeType: string; entityType: string; entityId: string
  fieldName: string; oldValue?: string; newValue?: string; reason?: string
}) {
  await sc.from('config_audit_log').insert({
    org_id:        params.orgId || null,
    specialist_id: params.specialistId || null,
    changed_by:    params.changedBy,
    change_type:   params.changeType,
    entity_type:   params.entityType,
    entity_id:     params.entityId,
    field_name:    params.fieldName,
    old_value:     params.oldValue || null,
    new_value:     params.newValue || null,
    change_reason: params.reason || null,
  }).catch(() => {})
}

// ════════════════════════════════════════════════════════════
// ORGANISATION MANAGEMENT
// ════════════════════════════════════════════════════════════

export async function listOrgsAction(status?: string) {
  return b('list_orgs', async () => {
    const { supabase } = await getAdmin()
    let q = supabase.from('organisations')
      .select(`
        id, name, slug, plan_tier, status, geography, admin_email, city,
        max_specialists, trial_ends_at, subscription_ends_at, created_at,
        org_specialists ( count )
      `)
      .order('created_at', { ascending: false })
    if (status && status !== 'all') q = q.eq('status', status)
    const { data } = await q.limit(200)
    return data || []
  })
}

export async function getOrgAction(orgId: string) {
  return b('get_org', async () => {
    const { supabase } = await getAdmin()
    const { data } = await supabase.from('organisations')
      .select(`
        *,
        org_specialists ( specialist_id, org_role, joined_at, is_active, specialists(id,name,specialty,email,status) ),
        org_module_config ( module_key, is_enabled, feature_flags, monthly_limit )
      `)
      .eq('id', orgId).single()
    if (!data) throw new Error('Org not found')
    return data
  })
}

export async function createOrgAction(formData: FormData) {
  return b('create_org', async () => {
    const { admin } = await getAdmin()
    const sc = svc()

    const name      = (formData.get('name') as string)?.trim()
    const slug      = (formData.get('slug') as string)?.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const planTier  = formData.get('plan_tier') as string || 'starter'
    const adminEmail= (formData.get('admin_email') as string)?.trim()
    const geography = formData.get('geography') as string || 'india'

    if (!name || !slug || !adminEmail) throw new Error('Name, slug, and admin email required')

    const { data: org, error } = await sc.from('organisations').insert({
      name, slug, plan_tier: planTier as any, admin_email: adminEmail,
      status: 'trial', geography: geography as any,
      trial_ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      created_by: admin.id,
    }).select('id').single()

    if (error || !org) throw new Error(error?.message || 'Could not create org')

    await auditLog(sc, {
      orgId: org.id, changedBy: admin.id,
      changeType: 'org_created', entityType: 'organisation', entityId: org.id,
      fieldName: 'plan_tier', newValue: planTier,
    })

    revalidatePath('/admin/orgs')
    return { orgId: org.id }
  })
}

export async function updateOrgAction(orgId: string, updates: Record<string, any>, reason?: string) {
  return b('update_org', async () => {
    const { admin } = await getAdmin()
    const sc = svc()

    const { data: before } = await sc.from('organisations').select('*').eq('id', orgId).single()
    const { error } = await sc.from('organisations').update(updates).eq('id', orgId)
    if (error) throw new Error(error.message)

    // Log each changed field
    for (const [field, newVal] of Object.entries(updates)) {
      await auditLog(sc, {
        orgId, changedBy: admin.id,
        changeType: 'org_updated', entityType: 'organisation', entityId: orgId,
        fieldName: field,
        oldValue: before ? String((before as any)[field] ?? '') : undefined,
        newValue: String(newVal),
        reason,
      })
    }

    revalidatePath(`/admin/orgs/${orgId}`)
    return true
  })
}

export async function changePlanAction(orgId: string, newTier: string, reason: string) {
  return b('change_plan', async () => {
    const { admin } = await getAdmin()
    const sc = svc()

    const { data: org } = await sc.from('organisations').select('plan_tier').eq('id', orgId).single()
    if (!org) throw new Error('Org not found')

    await sc.from('organisations').update({ plan_tier: newTier as any }).eq('id', orgId)

    // Re-trigger module setup for new plan
    const { data: planDef } = await sc.from('plan_definitions')
      .select('enabled_modules').eq('tier', newTier).single()

    if (planDef?.enabled_modules) {
      const allModules = ['m1_identity','m2_network','m3_referrals','m4_chatbot','m5_triage',
                          'm6_synthesis','m7_transcription','m8_procedure_planner','m9_communication','m10_content']
      for (const mk of allModules) {
        await sc.from('org_module_config').upsert({
          org_id: orgId, module_key: mk,
          is_enabled: (planDef.enabled_modules as string[]).includes(mk),
        }, { onConflict: 'org_id,module_key' })
      }
    }

    await auditLog(sc, {
      orgId, changedBy: admin.id,
      changeType: 'plan_changed', entityType: 'organisation', entityId: orgId,
      fieldName: 'plan_tier', oldValue: org.plan_tier, newValue: newTier, reason,
    })

    revalidatePath(`/admin/orgs/${orgId}`)
    return true
  })
}

// ════════════════════════════════════════════════════════════
// MODULE CONFIGURATION
// ════════════════════════════════════════════════════════════

export async function toggleModuleAction(orgId: string, moduleKey: string, enabled: boolean, reason?: string) {
  return b('toggle_module', async () => {
    const { admin } = await getAdmin()
    const sc = svc()

    const { error } = await sc.from('org_module_config').upsert({
      org_id: orgId, module_key: moduleKey as any, is_enabled: enabled,
      updated_by: admin.id,
    }, { onConflict: 'org_id,module_key' })
    if (error) throw new Error(error.message)

    await auditLog(sc, {
      orgId, changedBy: admin.id,
      changeType: enabled ? 'module_enabled' : 'module_disabled',
      entityType: 'org_module_config', entityId: orgId,
      fieldName: moduleKey, newValue: String(enabled), reason,
    })

    revalidatePath(`/admin/orgs/${orgId}`)
    return true
  })
}

export async function updateFeatureFlagsAction(orgId: string, moduleKey: string, flags: Record<string, boolean>, reason?: string) {
  return b('update_flags', async () => {
    const { admin } = await getAdmin()
    const sc = svc()

    const { data: current } = await sc.from('org_module_config')
      .select('feature_flags').eq('org_id', orgId).eq('module_key', moduleKey).single()
    const merged = { ...(current?.feature_flags || {}), ...flags }

    await sc.from('org_module_config').upsert({
      org_id: orgId, module_key: moduleKey as any, feature_flags: merged, updated_by: admin.id,
    }, { onConflict: 'org_id,module_key' })

    await auditLog(sc, {
      orgId, changedBy: admin.id,
      changeType: 'flag_changed', entityType: 'org_module_config', entityId: orgId,
      fieldName: moduleKey + '.feature_flags',
      oldValue: JSON.stringify(current?.feature_flags || {}),
      newValue: JSON.stringify(merged), reason,
    })

    revalidatePath(`/admin/orgs/${orgId}`)
    return true
  })
}

// ════════════════════════════════════════════════════════════
// SPECIALIST PERMISSIONS
// ════════════════════════════════════════════════════════════

export async function setSpecialistPermissionAction(
  orgId: string, specialistId: string, moduleKey: string,
  permission: 'inherit' | 'enabled' | 'disabled', reason?: string
) {
  return b('set_permission', async () => {
    const { admin } = await getAdmin()
    const sc = svc()

    await sc.from('specialist_permissions').upsert({
      org_id: orgId, specialist_id: specialistId, module_key: moduleKey as any,
      permission, granted_by: admin.id, notes: reason || null,
    }, { onConflict: 'org_id,specialist_id,module_key' })

    await auditLog(sc, {
      orgId, specialistId, changedBy: admin.id,
      changeType: 'permission_changed', entityType: 'specialist_permissions', entityId: specialistId,
      fieldName: moduleKey, newValue: permission, reason,
    })

    return true
  })
}

export async function assignSpecialistToOrgAction(specialistId: string, orgId: string, orgRole: string = 'member') {
  return b('assign_specialist', async () => {
    const { admin } = await getAdmin()
    const sc = svc()

    const { error } = await sc.from('org_specialists').upsert({
      org_id: orgId, specialist_id: specialistId, org_role: orgRole,
      invited_by: admin.id, is_active: true,
    }, { onConflict: 'specialist_id' })
    if (error) throw new Error(error.message)

    revalidatePath(`/admin/orgs/${orgId}`)
    return true
  })
}

// ════════════════════════════════════════════════════════════
// ANALYTICS AND USAGE
// ════════════════════════════════════════════════════════════

export async function getUsageAnalyticsAction(orgId: string, period: string = '30d') {
  return b('usage_analytics', async () => {
    const { supabase } = await getAdmin()
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30
    const since = new Date(Date.now() - days * 86400000).toISOString()

    const { data: events } = await supabase
      .from('usage_events')
      .select('module_key, event_type, event_at, specialist_id')
      .eq('org_id', orgId)
      .gte('event_at', since)
      .order('event_at', { ascending: false })
      .limit(10000)

    const byModule: Record<string, number>   = {}
    const byDay:    Record<string, number>   = {}
    const byType:   Record<string, number>   = {}

    for (const e of events || []) {
      byModule[e.module_key] = (byModule[e.module_key] || 0) + 1
      const day = e.event_at.split('T')[0]
      byDay[day] = (byDay[day] || 0) + 1
      byType[e.event_type] = (byType[e.event_type] || 0) + 1
    }

    return {
      totalEvents: (events || []).length,
      byModule,
      byDay,
      byType,
      period,
    }
  })
}

export async function getAuditLogAction(orgId?: string, limit = 100) {
  return b('audit_log', async () => {
    const { supabase } = await getAdmin()
    let q = supabase.from('config_audit_log')
      .select(`*, specialists!changed_by ( name, email )`)
      .order('changed_at', { ascending: false })
      .limit(limit)
    if (orgId) q = q.eq('org_id', orgId)
    const { data } = await q
    return data || []
  })
}

export async function getPlatformSummaryAction() {
  return b('platform_summary', async () => {
    const { supabase } = await getAdmin()
    const [orgs, specs, events] = await Promise.all([
      supabase.from('organisations').select('id, status, plan_tier'),
      supabase.from('specialists').select('id, status, created_at'),
      supabase.from('usage_events')
        .select('module_key')
        .gte('event_at', new Date(Date.now() - 30 * 86400000).toISOString()),
    ])

    const orgsByTier: Record<string, number>   = {}
    const orgsByStatus: Record<string, number> = {}
    for (const o of orgs.data || []) {
      orgsByTier[(o as any).plan_tier]   = (orgsByTier[(o as any).plan_tier]   || 0) + 1
      orgsByStatus[(o as any).status]    = (orgsByStatus[(o as any).status]    || 0) + 1
    }

    const moduleActivity: Record<string, number> = {}
    for (const e of events.data || []) {
      moduleActivity[(e as any).module_key] = (moduleActivity[(e as any).module_key] || 0) + 1
    }

    return {
      totalOrgs:        (orgs.data || []).length,
      totalSpecialists: (specs.data || []).length,
      activeSpecialists:(specs.data || []).filter((s: any) => s.status === 'active').length,
      orgsByTier,
      orgsByStatus,
      moduleActivityLast30d: moduleActivity,
      totalEventsLast30d:    (events.data || []).length,
    }
  })
}
