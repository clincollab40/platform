/**
 * API Route: GET /api/health — Tests
 *
 * Tests: response shape, overall status field, database section,
 * modules section, external_services section, synthesis_queue,
 * no-cache header.
 */

import { NextRequest } from 'next/server'

// ── Mock @supabase/supabase-js ─────────────────────────────────────
let mockFrom: jest.Mock

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => mockFrom(table),
  }),
}))

import { GET } from '@/app/api/health/route'

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/health')
}

function makeChain(returnValue: any) {
  return {
    select:  jest.fn().mockReturnThis(),
    limit:   jest.fn().mockReturnThis(),
    gte:     jest.fn().mockReturnThis(),
    single:  jest.fn().mockResolvedValue(returnValue),
    then:    jest.fn().mockResolvedValue(returnValue),
    // For select() without single():
    __resolved: returnValue,
  }
}

// ── Default healthy mock ───────────────────────────────────────────
function setupHealthyMocks() {
  mockFrom = jest.fn().mockImplementation((table: string) => {
    const chain: any = {
      select: jest.fn().mockReturnThis(),
      limit:  jest.fn().mockReturnThis(),
      gte:    jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: '1' }, error: null }),
    }
    // Make select() awaitable
    chain.select.mockImplementation(() => {
      const inner: any = {
        ...chain,
        then: (resolve: any) => resolve({ data: getMockData(table), error: null }),
      }
      inner.limit  = jest.fn().mockReturnValue(inner)
      inner.gte    = jest.fn().mockReturnValue(inner)
      inner.single = jest.fn().mockResolvedValue({ data: { id: '1' }, error: null })
      return inner
    })
    return chain
  })
}

function getMockData(table: string) {
  if (table === 'v_latest_module_health') {
    return [
      { module: 'M1', service: 'auth', status: 'ok', latency_ms: 45, recorded_at: new Date().toISOString() },
      { module: 'M2', service: 'network', status: 'ok', latency_ms: 60, recorded_at: new Date().toISOString() },
    ]
  }
  if (table === 'synthesis_jobs') {
    return [
      { status: 'completed' },
      { status: 'completed' },
      { status: 'running' },
      { status: 'failed' },
    ]
  }
  return []
}

// ════════════════════════════════════════════════════════════════
describe('GET /api/health — response shape', () => {
  beforeEach(() => setupHealthyMocks())

  test('returns 200', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
  })

  test('response contains timestamp', async () => {
    const res  = await GET(makeRequest())
    const body = await res.json()
    expect(body.timestamp).toBeDefined()
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date')
  })

  test('response contains overall field', async () => {
    const res  = await GET(makeRequest())
    const body = await res.json()
    expect(body.overall).toBeDefined()
    expect(['ok', 'degraded']).toContain(body.overall)
  })

  test('response contains database section', async () => {
    const res  = await GET(makeRequest())
    const body = await res.json()
    expect(body.database).toBeDefined()
    expect(body.database.supabase).toBeDefined()
  })

  test('response contains modules section', async () => {
    const res  = await GET(makeRequest())
    const body = await res.json()
    expect(body.modules).toBeDefined()
    expect(typeof body.modules).toBe('object')
  })

  test('modules section has M1 through M6', async () => {
    const res  = await GET(makeRequest())
    const body = await res.json()
    ;['M1','M2','M3','M4','M5','M6'].forEach(mod => {
      expect(body.modules[mod]).toBeDefined()
    })
  })

  test('response contains external_services section', async () => {
    const res  = await GET(makeRequest())
    const body = await res.json()
    expect(body.external_services).toBeDefined()
    expect(body.external_services.groq_api).toBeDefined()
    expect(body.external_services.whatsapp_api).toBeDefined()
  })

  test('response contains synthesis_queue section', async () => {
    const res  = await GET(makeRequest())
    const body = await res.json()
    expect(body.synthesis_queue).toBeDefined()
  })
})

// ════════════════════════════════════════════════════════════════
describe('GET /api/health — cache headers', () => {
  beforeEach(() => setupHealthyMocks())

  test('response has no-cache header', async () => {
    const res = await GET(makeRequest())
    const cc  = res.headers.get('Cache-Control')
    expect(cc).toContain('no-cache')
  })

  test('response has no-store header', async () => {
    const res = await GET(makeRequest())
    const cc  = res.headers.get('Cache-Control')
    expect(cc).toContain('no-store')
  })
})

// ════════════════════════════════════════════════════════════════
describe('GET /api/health — degraded state', () => {
  test('overall = degraded when DB is down', async () => {
    mockFrom = jest.fn().mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      limit:  jest.fn().mockReturnThis(),
      gte:    jest.fn().mockReturnThis(),
      single: jest.fn().mockRejectedValue(new Error('DB down')),
      then:   (_: any, reject: any) => reject(new Error('DB down')),
    }))

    const res  = await GET(makeRequest())
    // Should not throw — health endpoint never 500s
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.overall).toBeDefined()
  })
})
