/**
 * ClinCollab — Config Package (Module 11)
 *
 * This package is the single point of truth for:
 *   1. Module access check — can this specialist use this module?
 *   2. Feature flag resolution — is this flag on for this specialist?
 *   3. Usage event recording — log billable/trackable actions
 *   4. Entitlement summary — full resolved config for a specialist
 *
 * Usage in any module server component or action:
 *   import { checkModuleAccess, getFeatureFlag } from '@clincollab/config'
 *   const canAccess = await checkModuleAccess(specialistId, 'm10_content')
 *   const hasTier2 = await getFeatureFlag(specialistId, 'm10.tier2_evidence')
 *
 * Architecture:
 *   - Results are cached in-memory per request (no extra DB hit)
 *   - Cache is per specialist per module per request lifecycle
 *   - All checks gracefully degrade: if config DB is down, access is GRANTED
 *     for existing specialist (fail-open for clinical safety)
 */

import { createClient } from '@supabase/supabase-js'

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// ── In-memory cache (request-scoped, not persistent) ──────────
const configCache = new Map<string, EntitlementSummary>()
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes

interface CacheEntry {
  data:      EntitlementSummary
  cachedAt:  number
}
const cache = new Map<string, CacheEntry>()

function getCached(specialistId: string): EntitlementSummary | null {
  const entry = cache.get(specialistId)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(specialistId)
    return null
  }
  return entry.data
}

function setCached(specialistId: string, data: EntitlementSummary) {
  cache.set(specialistId, { data, cachedAt: Date.now() })
}

// ── Types ─────────────────────────────────────────────────────
export interface EntitlementSummary {
  specialistId:     string
  specialistName:   string
  specialistRole:   string
  orgId:            string | null
  orgName:          string | null
  orgSlug:          string | null
  planTier:         string
  orgStatus:        string
  geography:        string
  enabledModules:   string[]
  effectiveFeatures:Record<string, boolean>
  hipaaMode:        boolean
  gdprMode:         boolean
  abdmMode:         boolean
  ucpmpMode:        boolean
}

// ── Default for specialists not yet in an org ─────────────────
function defaultEntitlement(specialistId: string): EntitlementSummary {
  return {
    specialistId,
    specialistName:   '',
    specialistRole:   'specialist',
    orgId:            null,
    orgName:          null,
    orgSlug:          null,
    planTier:         'starter',
    orgStatus:        'trial',
    geography:        'india',
    enabledModules:   ['m1_identity', 'm2_network', 'm3_referrals'],
    effectiveFeatures:{},
    hipaaMode:        false,
    gdprMode:         false,
    abdmMode:         true,
    ucpmpMode:        true,
  }
}

// ── Core: resolve full entitlement for a specialist ───────────
export async function resolveEntitlements(
  specialistId: string
): Promise<EntitlementSummary> {
  // Check cache first
  const cached = getCached(specialistId)
  if (cached) return cached

  try {
    const sc = svc()

    const { data } = await sc
      .from('v_specialist_entitlements')
      .select('*')
      .eq('specialist_id', specialistId)
      .single()

    if (!data) {
      const def = defaultEntitlement(specialistId)
      setCached(specialistId, def)
      return def
    }

    const entitlement: EntitlementSummary = {
      specialistId:     data.specialist_id,
      specialistName:   data.specialist_name || '',
      specialistRole:   data.specialist_role || 'specialist',
      orgId:            data.org_id || null,
      orgName:          data.org_name || null,
      orgSlug:          data.org_slug || null,
      planTier:         data.plan_tier || 'starter',
      orgStatus:        data.org_status || 'trial',
      geography:        data.geography || 'india',
      enabledModules:   Array.isArray(data.enabled_modules) ? data.enabled_modules : ['m1_identity','m2_network','m3_referrals'],
      effectiveFeatures:flattenFeatures(data.effective_features),
      hipaaMode:        data.hipaa_mode || false,
      gdprMode:         data.gdpr_mode || false,
      abdmMode:         data.abdm_mode ?? true,
      ucpmpMode:        data.ucpmp_mode ?? true,
    }

    setCached(specialistId, entitlement)
    return entitlement

  } catch (err) {
    // Fail-open: if config DB is unreachable, grant starter access
    console.error('[Config] resolveEntitlements failed, using defaults:', err)
    const def = defaultEntitlement(specialistId)
    return def
  }
}

function flattenFeatures(raw: any): Record<string, boolean> {
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, boolean> = {}
  const flatten = (obj: any, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k
      if (typeof v === 'boolean') result[key] = v
      else if (typeof v === 'object' && v !== null) flatten(v, key)
    }
  }
  flatten(raw)
  return result
}

// ── Public API: module access check ──────────────────────────
export async function checkModuleAccess(
  specialistId: string,
  moduleKey: string
): Promise<boolean> {
  try {
    const entitlement = await resolveEntitlements(specialistId)

    // Admin always has access to everything
    if (entitlement.specialistRole === 'admin') return true

    // Org must be active or trial
    if (!['active', 'trial', 'demo'].includes(entitlement.orgStatus)) return false

    return entitlement.enabledModules.includes(moduleKey)
  } catch {
    return true  // Fail-open
  }
}

// ── Public API: feature flag ──────────────────────────────────
export async function getFeatureFlag(
  specialistId: string,
  flagKey: string
): Promise<boolean> {
  try {
    const entitlement = await resolveEntitlements(specialistId)
    return entitlement.effectiveFeatures[flagKey] ?? false
  } catch {
    return false
  }
}

// ── Public API: record usage event ───────────────────────────
export async function recordUsage(
  specialistId: string,
  moduleKey: string,
  eventType: string,
  metadata: Record<string, any> = {}
): Promise<void> {
  try {
    const sc = svc()
    await sc.rpc('record_usage_event', {
      p_specialist_id: specialistId,
      p_module_key:    moduleKey,
      p_event_type:    eventType,
      p_metadata:      metadata,
    })
  } catch (err) {
    // Non-critical — never block user action for usage logging failure
    console.error('[Config] recordUsage failed silently:', err)
  }
}

// ── Public API: invalidate cache (call after config change) ──
export function invalidateConfigCache(specialistId: string) {
  cache.delete(specialistId)
}

export function invalidateAllCaches() {
  cache.clear()
}

// ── Public API: get org usage summary ────────────────────────
export async function getOrgUsageSummary(
  orgId: string,
  monthYear: string  // 'YYYY-MM'
): Promise<Record<string, number>> {
  try {
    const sc = svc()
    const startDate = `${monthYear}-01`
    const endDate   = new Date(new Date(startDate).setMonth(new Date(startDate).getMonth() + 1))
      .toISOString().split('T')[0]

    const { data } = await sc
      .from('usage_events')
      .select('module_key, event_type')
      .eq('org_id', orgId)
      .gte('event_at', startDate)
      .lt('event_at', endDate)

    const summary: Record<string, number> = {}
    for (const event of data || []) {
      const key = `${event.module_key}.${event.event_type}`
      summary[key] = (summary[key] || 0) + 1
    }
    return summary
  } catch {
    return {}
  }
}

// ── Middleware helper: fast module check without full resolution ──
export async function fastModuleCheck(
  specialistId: string,
  moduleKey: string
): Promise<boolean> {
  try {
    const sc = svc()
    const { data } = await sc.rpc('check_module_access', {
      p_specialist_id: specialistId,
      p_module_key:    moduleKey,
    })
    return data === true
  } catch {
    return true  // Fail-open
  }
}
