/**
 * API Route: GET /api/config/entitlements — Tests
 *
 * Tests: unauthenticated → 401, no specialist record → starter defaults,
 * admin role → enterprise modules, specialist with entitlements → correct modules,
 * fail-open on DB error.
 *
 * Strategy: mock @supabase/ssr and next/headers so the route handler
 * runs in the Jest/Node environment without a real HTTP server.
 */

import { NextRequest } from 'next/server'

// ── Mock next/headers (not available in Jest) ──────────────────────
jest.mock('next/headers', () => ({
  cookies: () => Promise.resolve({
    getAll: () => [],
    set:    jest.fn(),
  }),
}))

// ── Supabase SSR mock factory ──────────────────────────────────────
let mockGetUser: jest.Mock
let mockFrom: jest.Mock

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => mockFrom(table),
  }),
}))

// ── Import route AFTER mocks ───────────────────────────────────────
import { GET } from '@/app/api/config/entitlements/route'

// ── Helpers ────────────────────────────────────────────────────────
function makeRequest() {
  return new NextRequest('http://localhost:3000/api/config/entitlements')
}

function makeSupabaseChain(returnValue: { data: any; error?: any }) {
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(returnValue),
  }
  return chain
}

// ════════════════════════════════════════════════════════════════
describe('GET /api/config/entitlements — authentication', () => {
  test('returns 401 when user is unauthenticated', async () => {
    mockGetUser = jest.fn().mockResolvedValue({ data: { user: null } })
    mockFrom    = jest.fn()

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthenticated')
  })
})

// ════════════════════════════════════════════════════════════════
describe('GET /api/config/entitlements — no specialist record', () => {
  test('returns starter defaults when specialist not found', async () => {
    mockGetUser = jest.fn().mockResolvedValue({ data: { user: { id: 'google-123' } } })
    mockFrom    = jest.fn().mockImplementation((table: string) => {
      if (table === 'specialists') return makeSupabaseChain({ data: null })
      return makeSupabaseChain({ data: null })
    })

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.planTier).toBe('starter')
    expect(body.enabledModules).toContain('m1_identity')
    expect(body.enabledModules).toContain('m2_network')
    expect(body.enabledModules).toContain('m3_referrals')
    expect(body.enabledModules).toHaveLength(3)
  })
})

// ════════════════════════════════════════════════════════════════
describe('GET /api/config/entitlements — admin role', () => {
  test('admin gets enterprise modules', async () => {
    mockGetUser = jest.fn().mockResolvedValue({ data: { user: { id: 'google-admin' } } })
    mockFrom    = jest.fn().mockImplementation((table: string) => {
      if (table === 'specialists') return makeSupabaseChain({ data: { id: 'spec-admin', role: 'admin' } })
      return makeSupabaseChain({ data: null })
    })

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.planTier).toBe('enterprise')
    expect(body.specialistRole).toBe('admin')
    expect(body.orgStatus).toBe('active')
    // Admin has all 10 production modules
    expect(body.enabledModules.length).toBeGreaterThanOrEqual(10)
    expect(body.enabledModules).toContain('m4_chatbot')
    expect(body.enabledModules).toContain('m10_content')
  })

  test('admin gets white_label feature flag', async () => {
    mockGetUser = jest.fn().mockResolvedValue({ data: { user: { id: 'google-admin' } } })
    mockFrom    = jest.fn().mockImplementation((table: string) => {
      if (table === 'specialists') return makeSupabaseChain({ data: { id: 'spec-admin', role: 'admin' } })
      return makeSupabaseChain({ data: null })
    })

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(body.effectiveFeatures['platform.white_label']).toBe(true)
    expect(body.effectiveFeatures['platform.api_access']).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
describe('GET /api/config/entitlements — specialist with entitlements', () => {
  test('returns entitlements from DB view', async () => {
    mockGetUser = jest.fn().mockResolvedValue({ data: { user: { id: 'google-spec' } } })
    mockFrom    = jest.fn().mockImplementation((table: string) => {
      if (table === 'specialists') {
        return makeSupabaseChain({ data: { id: 'spec-001', role: 'specialist' } })
      }
      if (table === 'v_specialist_entitlements') {
        return makeSupabaseChain({
          data: {
            enabled_modules:    ['m1_identity','m2_network','m3_referrals','m4_chatbot','m5_triage','m6_synthesis'],
            effective_features: { whatsapp_notifications: true, ai_synthesis: true },
            plan_tier:          'growth',
            org_status:         'active',
            geography:          'india',
          }
        })
      }
      return makeSupabaseChain({ data: null })
    })

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.planTier).toBe('growth')
    expect(body.orgStatus).toBe('active')
    expect(body.specialistRole).toBe('specialist')
    expect(body.enabledModules).toContain('m4_chatbot')
    expect(body.enabledModules).toContain('m6_synthesis')
    expect(body.enabledModules).not.toContain('m7_transcription')
    expect(body.effectiveFeatures['whatsapp_notifications']).toBe(true)
  })

  test('nested effective_features are flattened to dot notation', async () => {
    mockGetUser = jest.fn().mockResolvedValue({ data: { user: { id: 'google-spec' } } })
    mockFrom    = jest.fn().mockImplementation((table: string) => {
      if (table === 'specialists') return makeSupabaseChain({ data: { id: 'spec-001', role: 'specialist' } })
      if (table === 'v_specialist_entitlements') {
        return makeSupabaseChain({
          data: {
            enabled_modules:    ['m1_identity'],
            effective_features: { platform: { api_access: true }, m10: { pptx_export: false } },
            plan_tier:          'professional',
            org_status:         'active',
            geography:          'india',
          }
        })
      }
      return makeSupabaseChain({ data: null })
    })

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(body.effectiveFeatures['platform.api_access']).toBe(true)
    expect(body.effectiveFeatures['m10.pptx_export']).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
describe('GET /api/config/entitlements — fail-open safety', () => {
  test('returns 200 with starter defaults when DB throws', async () => {
    mockGetUser = jest.fn().mockRejectedValue(new Error('DB connection failed'))
    mockFrom    = jest.fn()

    const res  = await GET(makeRequest())
    const body = await res.json()

    // Must never return 500 — fail-open returns starter defaults
    expect(res.status).toBe(200)
    expect(body.planTier).toBe('starter')
    expect(body.enabledModules).toContain('m1_identity')
  })

  test('Cache-Control header set for specialist entitlements', async () => {
    mockGetUser = jest.fn().mockResolvedValue({ data: { user: { id: 'google-spec' } } })
    mockFrom    = jest.fn().mockImplementation((table: string) => {
      if (table === 'specialists') return makeSupabaseChain({ data: { id: 'spec-001', role: 'specialist' } })
      if (table === 'v_specialist_entitlements') {
        return makeSupabaseChain({
          data: {
            enabled_modules:    ['m1_identity'],
            effective_features: {},
            plan_tier:          'starter',
            org_status:         'active',
            geography:          'india',
          }
        })
      }
      return makeSupabaseChain({ data: null })
    })

    const res = await GET(makeRequest())
    expect(res.headers.get('Cache-Control')).toContain('max-age=300')
  })
})
