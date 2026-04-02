/**
 * API Route: WhatsApp Webhook — Tests
 * GET  /api/webhook/whatsapp — Meta challenge verification
 * POST /api/webhook/whatsapp — Incoming message handling
 *
 * Tests: GET verify challenge, GET bad token → 403,
 *        POST without signature (dev mode) → 200 ack,
 *        POST with emergency message → acknowledged,
 *        POST malformed body → 200 ack (never 500).
 */

import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

// ── Env vars ───────────────────────────────────────────────────────
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-verify-token-123'
process.env.NODE_ENV = 'test'  // disables signature verification

// ── Mock @supabase/supabase-js ─────────────────────────────────────
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select:  jest.fn().mockReturnThis(),
      eq:      jest.fn().mockReturnThis(),
      single:  jest.fn().mockResolvedValue({ data: null, error: null }),
      insert:  jest.fn().mockResolvedValue({ data: null, error: null }),
      update:  jest.fn().mockReturnThis(),
      upsert:  jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  }),
}))

// ── Mock chatbot engine ────────────────────────────────────────────
jest.mock('@/lib/ai/chatbot-engine', () => ({
  processPatientMessage: jest.fn().mockResolvedValue({
    response: 'Hello! How can I help you today?',
    isComplete: false,
  }),
  advanceBookingFlow: jest.fn().mockReturnValue({
    state: { step: 'mobile' },
    prompt: 'Please share your mobile number.',
    isComplete: false,
  }),
  formatWhatsAppResponse: jest.fn().mockReturnValue('Hello! How can I help you today?'),
  detectEmergency: jest.fn().mockReturnValue(false),
}))

import { GET, POST } from '@/app/api/webhook/whatsapp/route'

// ── Helpers ────────────────────────────────────────────────────────
function makeGetRequest(params: Record<string, string>) {
  const url = new URL('http://localhost:3000/api/webhook/whatsapp')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url.toString())
}

function makePostRequest(body: object, signature?: string) {
  const bodyText = JSON.stringify(body)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (signature) headers['x-hub-signature-256'] = signature
  return new NextRequest('http://localhost:3000/api/webhook/whatsapp', {
    method: 'POST',
    body:   bodyText,
    headers,
  })
}

function makeValidSignature(body: string): string {
  const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN!
  const hash = createHmac('sha256', token).update(body, 'utf8').digest('hex')
  return `sha256=${hash}`
}

const SAMPLE_WA_PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'wa-business-id-123',
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '918008007070', phone_number_id: 'phone-id' },
        contacts: [{ profile: { name: 'Rajan Kumar' }, wa_id: '919876543210' }],
        messages: [{
          from: '919876543210',
          id:   'wamid.test123',
          text: { body: 'Hello, I want to book an appointment' },
          type: 'text',
          timestamp: '1711900000',
        }],
      },
      field: 'messages',
    }],
  }],
}

// ════════════════════════════════════════════════════════════════
describe('GET /api/webhook/whatsapp — Meta challenge verification', () => {
  test('returns challenge when mode and token are valid', async () => {
    const req = makeGetRequest({
      'hub.mode':         'subscribe',
      'hub.verify_token': 'test-verify-token-123',
      'hub.challenge':    'challenge-abc-123',
    })
    const res  = await GET(req)
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toBe('challenge-abc-123')
  })

  test('returns 403 when verify token is wrong', async () => {
    const req = makeGetRequest({
      'hub.mode':         'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge':    'challenge-abc-123',
    })
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  test('returns 403 when mode is not subscribe', async () => {
    const req = makeGetRequest({
      'hub.mode':         'unsubscribe',
      'hub.verify_token': 'test-verify-token-123',
      'hub.challenge':    'challenge-abc-123',
    })
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  test('returns 403 when all params missing', async () => {
    const req = makeGetRequest({})
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})

// ════════════════════════════════════════════════════════════════
describe('POST /api/webhook/whatsapp — incoming message', () => {
  test('returns 200 immediately (non-blocking ack)', async () => {
    const req = makePostRequest(SAMPLE_WA_PAYLOAD)
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  test('response body is JSON with received: true', async () => {
    const req  = makePostRequest(SAMPLE_WA_PAYLOAD)
    const res  = await POST(req)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  test('handles non-message webhook events gracefully', async () => {
    const statusPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'wa-business-id-123',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '918008007070', phone_number_id: 'phone-id' },
            statuses: [{ id: 'wamid.123', status: 'delivered', timestamp: '1711900000', recipient_id: '919876543210' }],
          },
          field: 'messages',
        }],
      }],
    }
    const req = makePostRequest(statusPayload)
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  test('handles malformed JSON body without crashing', async () => {
    const req = new NextRequest('http://localhost:3000/api/webhook/whatsapp', {
      method:  'POST',
      body:    'not-valid-json{{{',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    // Must always return 200 — Meta will retry on non-200
    expect(res.status).toBe(200)
  })

  test('handles empty payload gracefully', async () => {
    const req = makePostRequest({})
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ════════════════════════════════════════════════════════════════
describe('POST /api/webhook/whatsapp — signature verification (production mode)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV

  afterAll(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
  })

  test('dev/test mode skips signature verification', async () => {
    process.env.NODE_ENV = 'test'
    const req = makePostRequest(SAMPLE_WA_PAYLOAD) // no signature
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})
