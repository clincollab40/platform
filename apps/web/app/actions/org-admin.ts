'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient }   from '@supabase/supabase-js'
import { redirect }       from 'next/navigation'
import { revalidatePath } from 'next/cache'

type BR<T> = { ok: true; value: T } | { ok: false; error: string }
async function b<T>(name: string, fn: () => Promise<T>): Promise<BR<T>> {
  try   { return { ok: true, value: await fn() } }
  catch (e) { console.error(`[OrgAdmin:${name}]`, e); return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * Resolves the current specialist and verifies they are an owner/admin of the given org.
 * Returns their specialist record and the service-role client.
 */
async function getOrgAdmin(orgId: string) {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const sc = svc()

  const { data: specialist } = await sc.from('specialists')
    .select('id, name, role, email').eq('google_id', user.id).single()
  if (!specialist) redirect('/auth/login')

  // Super admin bypasses org check
  if (specialist.role === 'admin') {
    return { sc, specialist, orgRole: 'owner' as const }
  }

  // Verify org membership with admin/owner role
  const { data: membership } = await sc.from('org_specialists')
    .select('org_role').eq('specialist_id', specialist.id)
    .eq('org_id', orgId).eq('is_active', true).single()

  if (!membership || !['owner','admin'].includes(membership.org_role)) {
    redirect('/dashboard')
  }

  return { sc, specialist, orgRole: membership.org_role as 'owner' | 'admin' }
}

/**
 * Returns the org_id for the current specialist.
 * Used when the specialist doesn't know their org_id in advance.
 */
export async function getMyOrgAction() {
  return b('get_my_org', async () => {
    const authClient = await createServerSupabaseClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const sc = svc()
    const { data: specialist } = await sc.from('specialists')
      .select('id, role').eq('google_id', user.id).single()
    if (!specialist) throw new Error('Specialist not found')

    // Super admin sees all orgs — return null so the UI shows the org list
    if (specialist.role === 'admin') return { orgId: null, orgRole: 'admin', isSuper: true }

    const { data: membership } = await sc.from('org_specialists')
      .select('org_id, org_role')
      .eq('specialist_id', specialist.id)
      .eq('is_active', true)
      .in('org_role', ['owner','admin'])
      .limit(1).single()

    if (!membership) return { orgId: null, orgRole: 'member', isSuper: false }
    return { orgId: membership.org_id, orgRole: membership.org_role, isSuper: false }
  })
}

// ─────────────────────────────────────────────────────────────────
// ORG OVERVIEW
// ─────────────────────────────────────────────────────────────────
export async function getOrgOverviewAction(orgId: string) {
  return b('get_overview', async () => {
    const { sc } = await getOrgAdmin(orgId)

    const { data: org } = await sc.from('organisations')
      .select(`
        id, name, slug, plan_tier, status, geography, admin_email, city, phone,
        max_specialists, trial_ends_at, subscription_ends_at, created_at,
        hipaa_mode, gdpr_mode, abdm_mode,
        org_module_config ( module_key, is_enabled, feature_flags ),
        org_specialists ( specialist_id, org_role, joined_at, is_active, specialists(id, name, specialty, email, status, photo) )
      `)
      .eq('id', orgId).single()

    if (!org) throw new Error('Org not found')

    // Usage last 30 days
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data: events } = await sc.from('usage_events')
      .select('module_key', { count: 'exact' })
      .eq('org_id', orgId).gte('event_at', since)

    const activeSpecialists = (org.org_specialists || []).filter((s: any) => s.is_active).length
    const enabledModules    = (org.org_module_config || []).filter((m: any) => m.is_enabled).length

    return { org, activeSpecialists, enabledModules, eventsLast30d: (events || []).length }
  })
}

// ─────────────────────────────────────────────────────────────────
// USER MANAGEMENT (Org Admin)
// ─────────────────────────────────────────────────────────────────
export async function listOrgUsersAction(orgId: string) {
  return b('list_users', async () => {
    const { sc } = await getOrgAdmin(orgId)

    const { data } = await sc.from('org_specialists')
      .select(`
        specialist_id, org_role, joined_at, is_active,
        specialists ( id, name, specialty, email, status, photo, created_at )
      `)
      .eq('org_id', orgId)
      .order('joined_at', { ascending: false })

    return data || []
  })
}

export async function updateUserRoleAction(orgId: string, specialistId: string, newRole: 'owner'|'admin'|'member') {
  return b('update_role', async () => {
    const { sc, specialist, orgRole } = await getOrgAdmin(orgId)

    // Only owners can promote/demote admins
    if (orgRole !== 'owner' && specialist.role !== 'admin') {
      throw new Error('Only org owners can change user roles')
    }

    const { error } = await sc.from('org_specialists')
      .update({ org_role: newRole })
      .eq('org_id', orgId).eq('specialist_id', specialistId)
    if (error) throw new Error(error.message)

    await sc.from('config_audit_log').insert({
      org_id:       orgId,
      specialist_id: specialistId,
      changed_by:   specialist.id,
      change_type:  'role_changed',
      entity_type:  'org_specialists',
      entity_id:    specialistId,
      field_name:   'org_role',
      new_value:    newRole,
    }).catch(() => {})

    revalidatePath(`/org-admin/${orgId}/users`)
    return true
  })
}

export async function deactivateUserAction(orgId: string, specialistId: string) {
  return b('deactivate_user', async () => {
    const { sc, specialist } = await getOrgAdmin(orgId)

    // Prevent self-deactivation
    if (specialist.id === specialistId) throw new Error('Cannot deactivate yourself')

    const { error } = await sc.from('org_specialists')
      .update({ is_active: false })
      .eq('org_id', orgId).eq('specialist_id', specialistId)
    if (error) throw new Error(error.message)

    await sc.from('config_audit_log').insert({
      org_id:       orgId,
      specialist_id: specialistId,
      changed_by:   specialist.id,
      change_type:  'user_deactivated',
      entity_type:  'org_specialists',
      entity_id:    specialistId,
      field_name:   'is_active',
      new_value:    'false',
    }).catch(() => {})

    revalidatePath(`/org-admin/${orgId}/users`)
    return true
  })
}

export async function reactivateUserAction(orgId: string, specialistId: string) {
  return b('reactivate_user', async () => {
    const { sc, specialist } = await getOrgAdmin(orgId)

    const { error } = await sc.from('org_specialists')
      .update({ is_active: true })
      .eq('org_id', orgId).eq('specialist_id', specialistId)
    if (error) throw new Error(error.message)

    revalidatePath(`/org-admin/${orgId}/users`)
    return true
  })
}

// Org admin can invite new users via email
export async function orgAdminInviteUserAction(params: {
  orgId:   string
  email:   string
  orgRole: 'admin' | 'member'
  message?: string
}) {
  return b('org_invite', async () => {
    const { sc, specialist } = await getOrgAdmin(params.orgId)

    // Check org hasn't hit max_specialists
    const { data: org } = await sc.from('organisations')
      .select('max_specialists').eq('id', params.orgId).single()
    const { count: currentCount } = await sc.from('org_specialists')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', params.orgId).eq('is_active', true)
    if ((currentCount ?? 0) >= (org?.max_specialists ?? 10)) {
      throw new Error(`Specialist limit reached (${org?.max_specialists}). Contact support to upgrade.`)
    }

    const { error } = await sc.from('user_invitations').upsert({
      org_id:     params.orgId,
      email:      params.email.toLowerCase().trim(),
      org_role:   params.orgRole,
      invited_by: specialist.id,
      message:    params.message || null,
      status:     'pending',
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    }, { onConflict: 'org_id,email' })
    if (error) throw new Error(error.message)

    revalidatePath(`/org-admin/${params.orgId}/users`)
    return true
  })
}

// ─────────────────────────────────────────────────────────────────
// MODULE OVERVIEW (read-only for org admin)
// ─────────────────────────────────────────────────────────────────
export async function getOrgModulesAction(orgId: string) {
  return b('get_modules', async () => {
    const { sc } = await getOrgAdmin(orgId)

    const { data: config } = await sc.from('org_module_config')
      .select('module_key, is_enabled, feature_flags, monthly_limit')
      .eq('org_id', orgId)

    const { data: flags } = await sc.from('feature_flag_registry')
      .select('flag_key, display_name, description, module_key, risk_level')
      .order('module_key')

    return { config: config || [], flags: flags || [] }
  })
}

// ─────────────────────────────────────────────────────────────────
// SPECIALIST PERMISSIONS (Org Admin can set module overrides for their users)
// ─────────────────────────────────────────────────────────────────
export async function setOrgUserPermissionAction(
  orgId: string, specialistId: string, moduleKey: string,
  permission: 'inherit' | 'enabled' | 'disabled'
) {
  return b('set_permission', async () => {
    const { sc, specialist } = await getOrgAdmin(orgId)

    await sc.from('specialist_permissions').upsert({
      org_id: orgId, specialist_id: specialistId, module_key: moduleKey as any,
      permission, granted_by: specialist.id,
    }, { onConflict: 'org_id,specialist_id,module_key' })

    revalidatePath(`/org-admin/${orgId}/users`)
    return true
  })
}

// ─────────────────────────────────────────────────────────────────
// AUDIT LOG (Org Admin — only their own org)
// ─────────────────────────────────────────────────────────────────
export async function getOrgAuditLogAction(orgId: string) {
  return b('org_audit', async () => {
    const { sc } = await getOrgAdmin(orgId)

    const { data } = await sc.from('config_audit_log')
      .select('*, specialists!changed_by ( name, email )')
      .eq('org_id', orgId)
      .order('changed_at', { ascending: false })
      .limit(100)

    return data || []
  })
}

// ─────────────────────────────────────────────────────────────────
// PENDING INVITATIONS (Org Admin)
// ─────────────────────────────────────────────────────────────────
export async function getOrgInvitationsAction(orgId: string) {
  return b('get_invites', async () => {
    const { sc } = await getOrgAdmin(orgId)
    const { data } = await sc.from('user_invitations')
      .select('*, specialists!invited_by ( name )')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
    return data || []
  })
}

export async function revokeOrgInvitationAction(orgId: string, invitationId: string) {
  return b('revoke_invite', async () => {
    const { sc } = await getOrgAdmin(orgId)
    await sc.from('user_invitations')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('id', invitationId).eq('org_id', orgId)
    revalidatePath(`/org-admin/${orgId}/users`)
    return true
  })
}
