'use client'

/**
 * ClinCollab — useConfig React Hook (Module 11)
 *
 * Provides client-side access to:
 *   - enabledModules: string[]          — which modules this specialist can access
 *   - checkModule(key): boolean         — can this specialist access this module?
 *   - getFlag(key): boolean             — is this feature flag enabled?
 *   - planTier: string                  — the org's current plan tier
 *   - isLoading: boolean                — initial load in progress
 *
 * How it works:
 *   - Fetches entitlements from /api/config/entitlements on mount
 *   - Results are cached in sessionStorage for the page session
 *   - Used to show/hide nav items and feature sections in client components
 *   - Server components should use checkModuleAccess() from @clincollab/config directly
 *
 * Usage:
 *   const { checkModule, getFlag, planTier, isLoading } = useConfig()
 *   if (!checkModule('m10_content')) return null
 *   if (getFlag('m10.tier2_evidence')) { ... }
 */

import { useState, useEffect, useCallback } from 'react'

interface ConfigState {
  enabledModules:   string[]
  effectiveFeatures:Record<string, boolean>
  planTier:         string
  orgStatus:        string
  geography:        string
  specialistRole:   string
  isLoading:        boolean
  error:            string | null
}

const CACHE_KEY  = 'clincollab_config_v1'
const CACHE_TTL  = 5 * 60 * 1000  // 5 minutes

function loadFromCache(): ConfigState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { data, cachedAt } = JSON.parse(raw)
    if (Date.now() - cachedAt > CACHE_TTL) {
      sessionStorage.removeItem(CACHE_KEY)
      return null
    }
    return data
  } catch { return null }
}

function saveToCache(data: ConfigState) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, cachedAt: Date.now() }))
  } catch {}
}

const DEFAULT_STATE: ConfigState = {
  enabledModules:    ['m1_identity', 'm2_network', 'm3_referrals'],
  effectiveFeatures: {},
  planTier:          'starter',
  orgStatus:         'active',
  geography:         'india',
  specialistRole:    'specialist',
  isLoading:         true,
  error:             null,
}

export function useConfig(): ConfigState & {
  checkModule: (moduleKey: string) => boolean
  getFlag:     (flagKey: string) => boolean
  refresh:     () => void
} {
  const [state, setState] = useState<ConfigState>(DEFAULT_STATE)

  const fetchConfig = useCallback(async () => {
    // Try cache first
    const cached = loadFromCache()
    if (cached) {
      setState({ ...cached, isLoading: false })
      return
    }

    try {
      const res = await fetch('/api/config/entitlements', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      })

      if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`)

      const data = await res.json()

      const newState: ConfigState = {
        enabledModules:    data.enabledModules   || DEFAULT_STATE.enabledModules,
        effectiveFeatures: data.effectiveFeatures|| {},
        planTier:          data.planTier         || 'starter',
        orgStatus:         data.orgStatus        || 'active',
        geography:         data.geography        || 'india',
        specialistRole:    data.specialistRole   || 'specialist',
        isLoading:         false,
        error:             null,
      }

      saveToCache(newState)
      setState(newState)
    } catch (err) {
      // Fail gracefully — use defaults, never block the user
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Config unavailable',
        // Keep defaults: starter plan — minimum viable access
      }))
    }
  }, [])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const checkModule = useCallback((moduleKey: string): boolean => {
    if (state.specialistRole === 'admin') return true
    if (!['active', 'trial', 'demo'].includes(state.orgStatus)) return false
    return state.enabledModules.includes(moduleKey)
  }, [state.enabledModules, state.orgStatus, state.specialistRole])

  const getFlag = useCallback((flagKey: string): boolean => {
    return state.effectiveFeatures[flagKey] ?? false
  }, [state.effectiveFeatures])

  const refresh = useCallback(() => {
    if (typeof window !== 'undefined') sessionStorage.removeItem(CACHE_KEY)
    setState(DEFAULT_STATE)
    fetchConfig()
  }, [fetchConfig])

  return { ...state, checkModule, getFlag, refresh }
}

// ── Convenience: invalidate config cache from anywhere ────────
export function invalidateConfigCache() {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(CACHE_KEY)
  }
}
