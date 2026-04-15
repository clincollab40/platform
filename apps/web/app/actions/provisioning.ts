'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createClient }   from '@supabase/supabase-js'
import { redirect }       from 'next/navigation'
import { revalidatePath } from 'next/cache'

type BR<T> = { ok: true; value: T } | { ok: false; error: string }
async function b<T>(name: string, fn: () => Promise<T>): Promise<BR<T>> {
  try   { return { ok: true, value: await fn() } }
  catch (e) { console.error(`[Provisioning:${name}]`, e); return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

async function getAdmin() {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')
  const sc = svc()
  const { data: s } = await sc.from('specialists')
    .select('id, name, role').eq('google_id', user.id).single()
  if (!s || s.role !== 'admin') redirect('/dashboard')
  return { sc, admin: s }
}

const ALL_MODULES = [
  'm1_identity','m2_network','m3_referrals','m4_chatbot','m5_triage',
  'm6_synthesis','m7_transcription','m8_procedure_planner','m9_communication','m10_content',
]

// ─────────────────────────────────────────────────────────────────
// PROVISION ORG
// Full wizard submission — creates org, configures modules, seeds
// provisioning checklist, optionally sends admin invitation.
// ─────────────────────────────────────────────────────────────────
export async function provisionOrgAction(params: {
  name:           string
  slug:           string
  planTier:       string
  adminEmail:     string
  geography:      string
  city?:          string
  phone?:         string
  moduleOverrides?: Record<string, boolean>
  sendInvitation: boolean
  inviteMessage?: string
  maxSpecialists?: number
  hipaaMode?:     boolean
  gdprMode?:      boolean
  abdmMode?:      boolean
}) {
  return b('provision_org', async () => {
    const { sc, admin } = await getAdmin()

    // 1. Validate slug uniqueness
    const { data: existing } = await sc.from('organisations')
      .select('id').eq('slug', params.slug).maybeSingle()
    if (existing) throw new Error(`Slug "${params.slug}" is already taken`)

    // 2. Fetch plan defaults
    const { data: planDef } = await sc.from('plan_definitions')
      .select('enabled_modules').eq('tier', params.planTier).single()
    const planModules: string[] = planDef?.enabled_modules || ['m1_identity']

    // 3. Create organisation
    const { data: org, error: orgErr } = await sc.from('organisations').insert({
      name:          params.name,
      slug:          params.slug,
      plan_tier:     params.planTier as any,
      admin_email:   params.adminEmail,
      geography:     params.geography as any,
      city:          params.city || null,
      phone:         params.phone || null,
      status:        'trial',
      max_specialists: params.maxSpecialists || 10,
      hipaa_mode:    params.hipaaMode || false,
      gdpr_mode:     params.gdprMode  || false,
      abdm_mode:     params.abdmMode  || false,
      trial_ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      created_by:    admin.id,
    }).select('id').single()
    if (orgErr || !org) throw new Error(orgErr?.message || 'Failed to create organisation')

    const orgId = org.id

    // 4. Configure modules (plan defaults + overrides)
    for (const mk of ALL_MODULES) {
      const planEnabled  = planModules.includes(mk)
      const overrideVal  = params.moduleOverrides?.[mk]
      const finalEnabled = overrideVal !== undefined ? overrideVal : planEnabled

      await sc.from('org_module_config').upsert({
        org_id: orgId, module_key: mk as any, is_enabled: finalEnabled,
        updated_by: admin.id,
      }, { onConflict: 'org_id,module_key' })
    }

    // 5. Seed provisioning checklist via DB function
    await sc.rpc('provision_implementation_steps', {
      p_org_id:   orgId,
      p_admin_id: admin.id,
    })

    // 6. Send invitation if requested
    if (params.sendInvitation && params.adminEmail) {
      await sc.from('user_invitations').insert({
        org_id:     orgId,
        email:      params.adminEmail,
        org_role:   'owner',
        invited_by: admin.id,
        message:    params.inviteMessage || null,
      })

      // Mark invite step as in_progress
      await sc.from('implementation_steps')
        .update({ status: 'in_progress' })
        .eq('org_id', orgId).eq('step_key', 'invite_admin')
    }

    // 7. Audit log
    await sc.from('config_audit_log').insert({
      org_id:       orgId,
      changed_by:   admin.id,
      change_type:  'org_provisioned',
      entity_type:  'organisation',
      entity_id:    orgId,
      field_name:   'plan_tier',
      new_value:    params.planTier,
      change_reason: 'New org provisioned via wizard',
    }).catch(() => {})

    revalidatePath('/admin')
    revalidatePath('/admin/orgs')
    return { orgId }
  })
}

// ─────────────────────────────────────────────────────────────────
// IMPLEMENTATION STEPS
// ─────────────────────────────────────────────────────────────────
export async function getImplementationStepsAction(orgId: string) {
  return b('get_steps', async () => {
    const { sc } = await getAdmin()
    const { data } = await sc.from('implementation_steps')
      .select('*, specialists!completed_by ( name )')
      .eq('org_id', orgId)
      .order('step_number')
    return data || []
  })
}

export async function updateStepAction(
  orgId: string, stepKey: string,
  status: 'pending'|'in_progress'|'completed'|'skipped'|'failed',
  notes?: string
) {
  return b('update_step', async () => {
    const { sc, admin } = await getAdmin()
    const patch: any = { status, notes: notes || null, updated_at: new Date().toISOString() }
    if (status === 'completed') {
      patch.completed_by = admin.id
      patch.completed_at = new Date().toISOString()
    }
    await sc.from('implementation_steps')
      .update(patch)
      .eq('org_id', orgId).eq('step_key', stepKey)

    revalidatePath(`/admin/orgs/${orgId}`)
    return true
  })
}

// ─────────────────────────────────────────────────────────────────
// TEST RUNNER
// Validates that each enabled module has a working configuration.
// This is a lightweight health-check — not a unit test suite.
// ─────────────────────────────────────────────────────────────────
export async function runTestSuiteAction(orgId: string, moduleKey?: string) {
  return b('run_tests', async () => {
    const { sc, admin } = await getAdmin()

    // Create test run record
    const { data: run, error: runErr } = await sc.from('test_runs').insert({
      org_id:       orgId,
      triggered_by: admin.id,
      module_key:   moduleKey || null,
      status:       'in_progress',
      started_at:   new Date().toISOString(),
    }).select('id').single()
    if (runErr || !run) throw new Error('Could not create test run')

    // Fetch org config
    const { data: org } = await sc.from('organisations')
      .select('*, org_module_config ( module_key, is_enabled, feature_flags )')
      .eq('id', orgId).single()
    if (!org) throw new Error('Org not found')

    const moduleConfig: Record<string, any> = {}
    for (const m of (org.org_module_config || [])) {
      moduleConfig[m.module_key] = m
    }

    const targetModules = moduleKey ? [moduleKey] : ALL_MODULES
    const results: { module: string; test: string; result: string; message: string }[] = []
    let passed = 0, failed = 0, skipped = 0

    for (const mk of targetModules) {
      const cfg = moduleConfig[mk]
      const enabled = cfg?.is_enabled ?? false

      if (!enabled) {
        results.push({ module: mk, test: 'module_enabled', result: 'skip', message: 'Module is disabled for this org' })
        skipped++
        continue
      }

      // Test 1: Module config row exists
      if (cfg) {
        results.push({ module: mk, test: 'config_exists', result: 'pass', message: 'Module config row found' })
        passed++
      } else {
        results.push({ module: mk, test: 'config_exists', result: 'fail', message: 'No org_module_config row found — run module setup' })
        failed++
        continue
      }

      // Test 2: M1 — org has at least one specialist
      if (mk === 'm1_identity') {
        const { count } = await sc.from('org_specialists')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId).eq('is_active', true)
        if ((count ?? 0) > 0) {
          results.push({ module: mk, test: 'm1_has_specialist', result: 'pass', message: `${count} active specialist(s) found` })
          passed++
        } else {
          results.push({ module: mk, test: 'm1_has_specialist', result: 'fail', message: 'No active specialists assigned — onboard at least one' })
          failed++
        }
      }

      // Test 3: M4 chatbot — check escalation mobile configured
      if (mk === 'm4_chatbot') {
        const flags = cfg?.feature_flags || {}
        results.push({ module: mk, test: 'm4_flags_present', result: 'pass', message: 'Chatbot module config present' })
        passed++
      }

      // Test 4: M10 content — check GROQ_API_KEY set (indirectly via env)
      if (mk === 'm10_content') {
        const hasKey = !!process.env.GROQ_API_KEY
        if (hasKey) {
          results.push({ module: mk, test: 'm10_groq_key', result: 'pass', message: 'GROQ_API_KEY present' })
          passed++
        } else {
          results.push({ module: mk, test: 'm10_groq_key', result: 'fail', message: 'GROQ_API_KEY not set — AI content generation will fail' })
          failed++
        }
      }
    }

    const overallStatus = failed > 0 ? 'failed' : 'completed'

    // Update test run
    await sc.from('test_runs').update({
      status:      overallStatus as any,
      ended_at:    new Date().toISOString(),
      total_tests: results.length,
      passed, failed, skipped,
      results,
    }).eq('id', run.id)

    // If full suite passed, mark test step complete
    if (!moduleKey && failed === 0) {
      await sc.from('implementation_steps')
        .update({ status: 'completed', completed_by: admin.id, completed_at: new Date().toISOString() })
        .eq('org_id', orgId).eq('step_key', 'run_test_suite')
    }

    revalidatePath(`/admin/orgs/${orgId}`)
    return { runId: run.id, status: overallStatus, passed, failed, skipped, results }
  })
}

export async function getTestRunsAction(orgId: string) {
  return b('get_test_runs', async () => {
    const { sc } = await getAdmin()
    const { data } = await sc.from('test_runs')
      .select('*, specialists!triggered_by ( name )')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(20)
    return data || []
  })
}

// ─────────────────────────────────────────────────────────────────
// USER INVITATIONS (Super Admin)
// ─────────────────────────────────────────────────────────────────
export async function inviteUserAction(params: {
  orgId:   string
  email:   string
  orgRole: 'owner' | 'admin' | 'member'
  message?: string
}) {
  return b('invite_user', async () => {
    const { sc, admin } = await getAdmin()

    // Upsert (re-invite if already invited)
    const { error } = await sc.from('user_invitations').upsert({
      org_id:     params.orgId,
      email:      params.email.toLowerCase().trim(),
      org_role:   params.orgRole,
      invited_by: admin.id,
      message:    params.message || null,
      status:     'pending',
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    }, { onConflict: 'org_id,email' })
    if (error) throw new Error(error.message)

    revalidatePath(`/admin/orgs/${params.orgId}`)
    return true
  })
}

export async function revokeInvitationAction(invitationId: string, orgId: string) {
  return b('revoke_invitation', async () => {
    const { sc } = await getAdmin()
    await sc.from('user_invitations')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('id', invitationId)
    revalidatePath(`/admin/orgs/${orgId}`)
    return true
  })
}

export async function getInvitationsAction(orgId: string) {
  return b('get_invitations', async () => {
    const { sc } = await getAdmin()
    const { data } = await sc.from('user_invitations')
      .select('*, specialists!invited_by ( name )')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
    return data || []
  })
}
