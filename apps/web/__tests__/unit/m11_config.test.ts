/**
 * M11 — Platform Config & Plan Management — Unit Tests
 *
 * Self-contained: all logic inlined as pure functions.
 * FIXES:
 *   1. Plan tier module inclusions match actual plan_tier ENUM and feature flags
 *      (starter: M1-3, growth: M1-6, professional: M1-9, enterprise: M1-11)
 *   2. Usage limit of -1 means unlimited (not 0)
 *   3. Org slug validation: 3-63 chars, lowercase letters/numbers/hyphens, no leading/trailing hyphens
 *   4. Session cache TTL tests (5 min)
 *   5. Feature flag fail-open safety for production critical paths
 */

// ── Plan tier module inclusions ───────────────────────────────────
describe('M11 — planTierModuleInclusions', () => {
  const PLAN_MODULES: Record<string, number[]> = {
    starter:      [1, 2, 3],
    growth:       [1, 2, 3, 4, 5, 6],
    professional: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    enterprise:   [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  }

  function hasModule(plan: string, moduleNum: number): boolean {
    return (PLAN_MODULES[plan] ?? []).includes(moduleNum)
  }

  // Starter
  test('starter has M1 (identity)',        () => expect(hasModule('starter', 1)).toBe(true))
  test('starter has M2 (network)',         () => expect(hasModule('starter', 2)).toBe(true))
  test('starter has M3 (referrals)',       () => expect(hasModule('starter', 3)).toBe(true))
  test('starter does NOT have M4',         () => expect(hasModule('starter', 4)).toBe(false))
  test('starter does NOT have M7',         () => expect(hasModule('starter', 7)).toBe(false))

  // Growth
  test('growth has M4 (chatbot)',          () => expect(hasModule('growth', 4)).toBe(true))
  test('growth has M6 (synthesis)',        () => expect(hasModule('growth', 6)).toBe(true))
  test('growth does NOT have M7',          () => expect(hasModule('growth', 7)).toBe(false))

  // Professional
  test('professional has M7 (transcription)', () => expect(hasModule('professional', 7)).toBe(true))
  test('professional has M9 (comms)',       () => expect(hasModule('professional', 9)).toBe(true))
  test('professional does NOT have M10',    () => expect(hasModule('professional', 10)).toBe(false))

  // Enterprise
  test('enterprise has M10 (content)',     () => expect(hasModule('enterprise', 10)).toBe(true))
  test('enterprise has M11 (config)',      () => expect(hasModule('enterprise', 11)).toBe(true))
  test('all 11 modules in enterprise',     () => expect(PLAN_MODULES.enterprise.length).toBe(11))

  // Unknown
  test('unknown plan has no modules',      () => expect(hasModule('free', 1)).toBe(false))
})

// ── Org slug validation ───────────────────────────────────────────
describe('M11 — orgSlugValidation', () => {
  function isValidSlug(slug: string): boolean {
    if (slug.length < 3 || slug.length > 63)      return false
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length > 1) return false
    if (/--/.test(slug))                           return false
    return /^[a-z0-9-]+$/.test(slug)
  }

  test('valid slug "apollo-hospitals"',         () => expect(isValidSlug('apollo-hospitals')).toBe(true))
  test('valid slug "kims"',                     () => expect(isValidSlug('kims')).toBe(true))
  test('valid slug with numbers "clinic123"',   () => expect(isValidSlug('clinic123')).toBe(true))
  test('too short (2 chars) invalid',           () => expect(isValidSlug('ab')).toBe(false))
  test('exactly 3 chars valid',                 () => expect(isValidSlug('abc')).toBe(true))
  test('64 chars too long',                     () => expect(isValidSlug('a'.repeat(64))).toBe(false))
  test('63 chars valid',                        () => expect(isValidSlug('a'.repeat(63))).toBe(true))
  test('uppercase rejected',                    () => expect(isValidSlug('Apollo')).toBe(false))
  test('leading hyphen rejected',               () => expect(isValidSlug('-clinic')).toBe(false))
  test('trailing hyphen rejected',              () => expect(isValidSlug('clinic-')).toBe(false))
  test('double hyphen rejected',                () => expect(isValidSlug('apollo--hospitals')).toBe(false))
  test('underscore rejected',                   () => expect(isValidSlug('apollo_hospitals')).toBe(false))
  test('space rejected',                        () => expect(isValidSlug('apollo hospitals')).toBe(false))
})

// ── Usage limit enforcement ───────────────────────────────────────
describe('M11 — usageLimitEnforcement', () => {
  // -1 = unlimited, 0 = feature not included, N = hard cap
  function isUsageAllowed(limit: number, currentUsage: number): boolean {
    if (limit === 0)  return false   // feature not in plan
    if (limit === -1) return true    // unlimited
    return currentUsage < limit
  }

  test('-1 limit = unlimited (always allowed)',     () => expect(isUsageAllowed(-1, 9999)).toBe(true))
  test('0 limit = not included (never allowed)',    () => expect(isUsageAllowed(0, 0)).toBe(false))
  test('below cap allowed',                         () => expect(isUsageAllowed(100, 50)).toBe(true))
  test('at cap not allowed',                        () => expect(isUsageAllowed(100, 100)).toBe(false))
  test('above cap not allowed',                     () => expect(isUsageAllowed(100, 101)).toBe(false))
  test('cap of 1, first usage allowed',             () => expect(isUsageAllowed(1, 0)).toBe(true))
  test('cap of 1, second usage rejected',           () => expect(isUsageAllowed(1, 1)).toBe(false))
})

// ── Plan tier comparison ──────────────────────────────────────────
describe('M11 — planTierComparison', () => {
  const TIER_RANK: Record<string, number> = {
    starter: 1, growth: 2, professional: 3, enterprise: 4,
  }

  function isAtLeastPlan(currentPlan: string, requiredPlan: string): boolean {
    return (TIER_RANK[currentPlan] ?? 0) >= (TIER_RANK[requiredPlan] ?? 999)
  }

  function canDowngradeTo(currentPlan: string, targetPlan: string): boolean {
    return (TIER_RANK[currentPlan] ?? 0) > (TIER_RANK[targetPlan] ?? 0)
  }

  test('enterprise >= professional',     () => expect(isAtLeastPlan('enterprise', 'professional')).toBe(true))
  test('professional >= growth',         () => expect(isAtLeastPlan('professional', 'growth')).toBe(true))
  test('starter NOT >= growth',          () => expect(isAtLeastPlan('starter', 'growth')).toBe(false))
  test('starter = starter',              () => expect(isAtLeastPlan('starter', 'starter')).toBe(true))
  test('enterprise can downgrade to starter', () => expect(canDowngradeTo('enterprise', 'starter')).toBe(true))
  test('starter cannot downgrade',       () => expect(canDowngradeTo('starter', 'growth')).toBe(false))
  test('same tier cannot downgrade',     () => expect(canDowngradeTo('growth', 'growth')).toBe(false))
  test('unknown plan fails all checks',  () => expect(isAtLeastPlan('free', 'starter')).toBe(false))
})

// ── Config hierarchy resolution ───────────────────────────────────
describe('M11 — configHierarchyResolution', () => {
  // Priority: specialist_config > org_config > platform_defaults
  function resolveConfig<T>(
    platformDefault: T,
    orgOverride: T | null | undefined,
    specialistOverride: T | null | undefined
  ): T {
    if (specialistOverride != null) return specialistOverride
    if (orgOverride != null)        return orgOverride
    return platformDefault
  }

  test('specialist override takes priority',  () => expect(resolveConfig('platform', 'org', 'specialist')).toBe('specialist'))
  test('org override beats platform',         () => expect(resolveConfig('platform', 'org', null)).toBe('org'))
  test('platform default used when both null',() => expect(resolveConfig('platform', null, null)).toBe('platform'))
  test('null specialist falls through to org',() => expect(resolveConfig('platform', 'org', null)).toBe('org'))
  test('false value (boolean) overrides',     () => expect(resolveConfig(true, null, false)).toBe(false))
  test('0 value (number) overrides',          () => expect(resolveConfig(10, null, 0)).toBe(0))
})

// ── Feature flag resolution ────────────────────────────────────────
describe('M11 — featureFlagResolution', () => {
  interface FeatureFlags {
    [key: string]: boolean
  }

  // fail-open: if flag undefined in production-critical contexts, default true
  function resolveFlag(flags: FeatureFlags, key: string, defaultValue = true): boolean {
    return flags[key] ?? defaultValue
  }

  test('flag explicitly enabled',             () => expect(resolveFlag({ ai_synthesis: true }, 'ai_synthesis')).toBe(true))
  test('flag explicitly disabled',            () => expect(resolveFlag({ ai_synthesis: false }, 'ai_synthesis')).toBe(false))
  test('missing flag defaults to true (fail-open)', () => expect(resolveFlag({}, 'ai_synthesis')).toBe(true))
  test('missing flag with false default',     () => expect(resolveFlag({}, 'beta_feature', false)).toBe(false))
  test('whatsapp flag disabled blocks sending', () => {
    const canSend = resolveFlag({ whatsapp_notifications: false }, 'whatsapp_notifications', true)
    expect(canSend).toBe(false)
  })
})

// ── Org status access control ─────────────────────────────────────
describe('M11 — orgStatusAccessControl', () => {
  type OrgStatus = 'active' | 'suspended' | 'trial' | 'churned'

  function canAccessPlatform(status: OrgStatus): boolean {
    return status === 'active' || status === 'trial'
  }

  function canModifyConfig(status: OrgStatus): boolean {
    return status === 'active'
  }

  test('active org can access platform',      () => expect(canAccessPlatform('active')).toBe(true))
  test('trial org can access platform',       () => expect(canAccessPlatform('trial')).toBe(true))
  test('suspended org cannot access',         () => expect(canAccessPlatform('suspended')).toBe(false))
  test('churned org cannot access',           () => expect(canAccessPlatform('churned')).toBe(false))
  test('only active org can modify config',   () => expect(canModifyConfig('active')).toBe(true))
  test('trial org cannot modify config',      () => expect(canModifyConfig('trial')).toBe(false))
  test('suspended org cannot modify config',  () => expect(canModifyConfig('suspended')).toBe(false))
})

// ── Session storage cache TTL ─────────────────────────────────────
describe('M11 — sessionCacheTTL', () => {
  const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes

  function isCacheValid(cachedAt: number, now: number): boolean {
    return (now - cachedAt) < CACHE_TTL_MS
  }

  test('fresh cache (0ms) is valid',         () => expect(isCacheValid(Date.now(), Date.now())).toBe(true))
  test('4 min 59s cache is valid',           () => {
    const cachedAt = Date.now() - (4 * 60 * 1000 + 59 * 1000)
    expect(isCacheValid(cachedAt, Date.now())).toBe(true)
  })
  test('exactly 5 min cache is expired',    () => {
    const cachedAt = Date.now() - CACHE_TTL_MS
    expect(isCacheValid(cachedAt, Date.now())).toBe(false)
  })
  test('10 min old cache is expired',       () => {
    const cachedAt = Date.now() - (10 * 60 * 1000)
    expect(isCacheValid(cachedAt, Date.now())).toBe(false)
  })
  test('CACHE_TTL_MS = 300000 (5 min)',     () => expect(CACHE_TTL_MS).toBe(300000))
})
