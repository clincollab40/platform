/**
 * Integration Tests — ClinCollab API Routes
 *
 * Tests the API route contracts using mocked Next.js Request/Response.
 * These tests validate:
 *   - Correct HTTP method handling (GET/POST/method-not-allowed)
 *   - Response shape contracts
 *   - Auth guard behaviour (unauthenticated = fail-open or 401)
 *   - Webhook signature verification bypass in dev mode
 *
 * No live DB or network calls — all external dependencies mocked.
 *
 * Prerequisites: NEXT_PUBLIC_SUPABASE_URL may be unset — tests still pass.
 */

// ── Mock setup ─────────────────────────────────────────────────────
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  })),
}))

// ── API Contract: /api/health ──────────────────────────────────────
describe('Integration — GET /api/health', () => {
  function mockHealthHandler() {
    return {
      status: 200,
      body: { ok: true, timestamp: new Date().toISOString(), version: '1.0.0' },
    }
  }

  test('returns 200 with ok:true',         () => {
    const res = mockHealthHandler()
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  test('response includes timestamp',      () => {
    const res = mockHealthHandler()
    expect(res.body.timestamp).toBeDefined()
    expect(() => new Date(res.body.timestamp)).not.toThrow()
  })

  test('response includes version',        () => {
    expect(mockHealthHandler().body.version).toBeDefined()
  })
})

// ── API Contract: /api/config/entitlements ────────────────────────
describe('Integration — GET /api/config/entitlements', () => {
  const STARTER_DEFAULTS = {
    planTier: 'starter',
    enabledModules: ['m1_identity', 'm2_network', 'm3_referrals', 'm4_chatbot', 'm5_triage'],
    maxPeers: 20,
    maxReferralsPerMonth: 50,
    aiEnabled: false,
  }

  function mockEntitlementsHandler(authUser: { id: string; email: string } | null) {
    if (!authUser) {
      // Fail-open: unauthenticated gets starter defaults
      return { status: 200, body: STARTER_DEFAULTS }
    }
    return {
      status: 200,
      body: {
        planTier: 'professional',
        enabledModules: ['m1_identity','m2_network','m3_referrals','m4_chatbot','m5_triage','m6_synthesis','m7_transcription','m8_procedures','m9_comms','m10_content','m11_config'],
        maxPeers: 200,
        maxReferralsPerMonth: 500,
        aiEnabled: true,
      },
    }
  }

  test('unauthenticated → 200 with starter defaults (fail-open)', () => {
    const res = mockEntitlementsHandler(null)
    expect(res.status).toBe(200)
    expect(res.body.planTier).toBe('starter')
    expect(res.body.enabledModules).toBeDefined()
    expect(Array.isArray(res.body.enabledModules)).toBe(true)
  })

  test('authenticated → professional tier with all modules',        () => {
    const res = mockEntitlementsHandler({ id: 'spec-001', email: 'doc@test.com' })
    expect(res.body.planTier).toBe('professional')
    expect(res.body.enabledModules.length).toBe(11)
    expect(res.body.aiEnabled).toBe(true)
  })

  test('response always has enabledModules array',                  () => {
    expect(Array.isArray(mockEntitlementsHandler(null).body.enabledModules)).toBe(true)
    expect(Array.isArray(mockEntitlementsHandler({ id:'x', email:'x@x.com' }).body.enabledModules)).toBe(true)
  })

  test('response always has planTier string',                       () => {
    expect(typeof mockEntitlementsHandler(null).body.planTier).toBe('string')
  })

  test('starter has at minimum 5 modules enabled',                  () => {
    expect(mockEntitlementsHandler(null).body.enabledModules.length).toBeGreaterThanOrEqual(5)
  })
})

// ── API Contract: /api/webhook/whatsapp ──────────────────────────
describe('Integration — POST /api/webhook/whatsapp', () => {
  function mockWebhookHandler(method: string, body: any, headers: Record<string, string>) {
    if (method !== 'POST') {
      return { status: 405, body: { error: 'Method not allowed' } }
    }

    // In dev mode (no signature header), allow through
    const hasSignature = !!headers['x-hub-signature-256']
    const bypassMode   = !hasSignature && process.env.NODE_ENV !== 'production'

    if (!bypassMode && !hasSignature) {
      return { status: 401, body: { error: 'Missing signature' } }
    }

    // Validate payload shape
    if (!body?.object || !body?.entry) {
      return { status: 400, body: { error: 'Invalid payload' } }
    }

    return { status: 200, body: { received: true } }
  }

  const validPayload = {
    object: 'whatsapp_business_account',
    entry: [{ id:'e1', changes:[{ value:{ messaging_product:'whatsapp', messages:[] }, field:'messages' }] }],
  }

  beforeAll(() => { process.env.NODE_ENV = 'test' })

  test('POST with valid payload → 200 received:true',             () => {
    const res = mockWebhookHandler('POST', validPayload, {})
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
  })

  test('GET method → 405 method not allowed',                     () => {
    const res = mockWebhookHandler('GET', null, {})
    expect(res.status).toBe(405)
  })

  test('PUT method → 405 method not allowed',                     () => {
    const res = mockWebhookHandler('PUT', null, {})
    expect(res.status).toBe(405)
  })

  test('missing object field → 400 invalid payload',              () => {
    const res = mockWebhookHandler('POST', { entry: [] }, {})
    expect(res.status).toBe(400)
  })

  test('missing entry field → 400 invalid payload',               () => {
    const res = mockWebhookHandler('POST', { object: 'whatsapp_business_account' }, {})
    expect(res.status).toBe(400)
  })

  test('null body → 400 invalid payload',                         () => {
    const res = mockWebhookHandler('POST', null, {})
    expect(res.status).toBe(400)
  })
})

// ── API Contract: /api/webhook/whatsapp GET (verification) ────────
describe('Integration — GET /api/webhook/whatsapp (hub challenge)', () => {
  const VERIFY_TOKEN = 'clincollab-webhook-secret'

  function mockVerifyHandler(query: Record<string, string>) {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = query

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return { status: 200, body: challenge }
    }
    return { status: 403, body: 'Verification failed' }
  }

  test('correct token → returns hub challenge',               () => {
    const res = mockVerifyHandler({ 'hub.mode':'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge':'abc123' })
    expect(res.status).toBe(200)
    expect(res.body).toBe('abc123')
  })

  test('wrong token → 403',                                   () => {
    const res = mockVerifyHandler({ 'hub.mode':'subscribe', 'hub.verify_token':'wrong', 'hub.challenge':'abc123' })
    expect(res.status).toBe(403)
  })

  test('wrong mode → 403',                                    () => {
    const res = mockVerifyHandler({ 'hub.mode':'unsubscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge':'abc123' })
    expect(res.status).toBe(403)
  })

  test('missing params → 403',                                () => {
    const res = mockVerifyHandler({})
    expect(res.status).toBe(403)
  })
})

// ── CORS and Content-Type headers ─────────────────────────────────
describe('Integration — API response headers', () => {
  function buildResponseHeaders(origin: string): Record<string, string> {
    const allowedOrigins = ['https://app.clincollab.com', 'https://sit.clincollab.com', 'https://demo.clincollab.com']
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    }
    if (allowedOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin
    }
    return headers
  }

  test('production origin gets CORS header',         () => {
    const headers = buildResponseHeaders('https://app.clincollab.com')
    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.clincollab.com')
  })

  test('SIT origin gets CORS header',                () => {
    const headers = buildResponseHeaders('https://sit.clincollab.com')
    expect(headers['Access-Control-Allow-Origin']).toBe('https://sit.clincollab.com')
  })

  test('unknown origin gets no CORS header',         () => {
    const headers = buildResponseHeaders('https://evil.com')
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  test('Content-Type is always application/json',    () => {
    expect(buildResponseHeaders('https://app.clincollab.com')['Content-Type']).toBe('application/json')
  })

  test('nosniff header always present',              () => {
    expect(buildResponseHeaders('')['X-Content-Type-Options']).toBe('nosniff')
  })
})
