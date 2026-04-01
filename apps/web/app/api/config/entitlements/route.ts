import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

/**
 * GET /api/config/entitlements
 * Serves the resolved entitlements for the authenticated specialist.
 * Called by the useConfig() hook on client mount.
 * Responds in < 100ms using the DB view (cached by Supabase).
 *
 * Path: apps/web/app/api/config/entitlements/route.ts
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cs) { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

    // Get specialist ID
    const { data: specialist } = await supabase
      .from('specialists')
      .select('id, role')
      .eq('google_id', user.id)
      .single()

    if (!specialist) {
      // No specialist record yet — return safe defaults
      return NextResponse.json({
        enabledModules:    ['m1_identity', 'm2_network', 'm3_referrals'],
        effectiveFeatures: {},
        planTier:          'starter',
        orgStatus:         'trial',
        geography:         'india',
        specialistRole:    'specialist',
      })
    }

    // Admin always gets full access
    if (specialist.role === 'admin') {
      return NextResponse.json({
        enabledModules:    ['m1_identity','m2_network','m3_referrals','m4_chatbot','m5_triage',
                           'm6_synthesis','m7_transcription','m8_procedure_planner','m9_communication','m10_content'],
        effectiveFeatures: { 'platform.api_access': true, 'platform.white_label': true,
                             'platform.data_export_all': true, 'm10.tier2_evidence': true,
                             'm10.patient_education': true, 'm10.pptx_export': true },
        planTier:          'enterprise',
        orgStatus:         'active',
        geography:         'india',
        specialistRole:    'admin',
      }, {
        headers: { 'Cache-Control': 'private, max-age=60' }
      })
    }

    // Query the entitlements view
    const { data: entitlement } = await supabase
      .from('v_specialist_entitlements')
      .select('enabled_modules, effective_features, plan_tier, org_status, geography')
      .eq('specialist_id', specialist.id)
      .single()

    if (!entitlement) {
      // Specialist not yet in an org — return starter defaults
      return NextResponse.json({
        enabledModules:    ['m1_identity', 'm2_network', 'm3_referrals'],
        effectiveFeatures: { 'whatsapp_notifications': true },
        planTier:          'starter',
        orgStatus:         'trial',
        geography:         'india',
        specialistRole:    'specialist',
      }, {
        headers: { 'Cache-Control': 'private, max-age=120' }
      })
    }

    // Flatten effective_features JSONB to flat key-value
    const flatFeatures: Record<string, boolean> = {}
    const flattenObj = (obj: any, prefix = '') => {
      for (const [k, v] of Object.entries(obj || {})) {
        const key = prefix ? `${prefix}.${k}` : k
        if (typeof v === 'boolean') flatFeatures[key] = v
        else if (typeof v === 'object' && v !== null) flattenObj(v, key)
      }
    }
    flattenObj(entitlement.effective_features)

    return NextResponse.json({
      enabledModules:    entitlement.enabled_modules || ['m1_identity','m2_network','m3_referrals'],
      effectiveFeatures: flatFeatures,
      planTier:          entitlement.plan_tier || 'starter',
      orgStatus:         entitlement.org_status || 'trial',
      geography:         entitlement.geography || 'india',
      specialistRole:    'specialist',
    }, {
      headers: { 'Cache-Control': 'private, max-age=300' }  // 5 min browser cache
    })

  } catch (err) {
    console.error('[/api/config/entitlements]', err)
    // Fail-open: return starter defaults so the app never hard-blocks
    return NextResponse.json({
      enabledModules:    ['m1_identity', 'm2_network', 'm3_referrals'],
      effectiveFeatures: {},
      planTier:          'starter',
      orgStatus:         'active',
      geography:         'india',
      specialistRole:    'specialist',
    })
  }
}
