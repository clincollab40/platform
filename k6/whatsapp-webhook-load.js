/**
 * k6 Load Test — POST /api/webhook/whatsapp
 *
 * SLA target: P95 < 500ms at 50 concurrent virtual users
 * Meta requires webhook to respond in < 5 seconds or retries.
 *
 * Run:
 *   k6 run k6/whatsapp-webhook-load.js
 *   k6 run --env BASE_URL=https://sit.clincollab.com k6/whatsapp-webhook-load.js
 */

import http    from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

// ── Custom metrics ─────────────────────────────────────────────────
const errorRate  = new Rate('error_rate')
const ackLatency = new Trend('ack_latency_ms', true)

// ── Test config ────────────────────────────────────────────────────
export const options = {
  scenarios: {
    webhook_burst: {
      executor:   'constant-vus',
      vus:        50,
      duration:   '60s',
    },
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 100 },  // spike to 100 VUs
        { duration: '20s', target: 100 },
        { duration: '10s', target: 0   },
      ],
      startTime: '70s',
    },
  },
  thresholds: {
    // SLA: P95 < 500ms (Meta requires < 5s)
    http_req_duration: ['p(95)<500', 'p(99)<2000'],
    // Must always 200 (non-200 causes Meta to retry and blacklist)
    'http_req_failed': ['rate<0.001'],
    error_rate:        ['rate<0.001'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

// ── Sample WhatsApp webhook payload ───────────────────────────────
function makePayload(fromNumber, messageText) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'wa-business-123',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '918008007070',
            phone_number_id: 'phone-id-001',
          },
          contacts: [{
            profile: { name: 'Load Test User' },
            wa_id: fromNumber,
          }],
          messages: [{
            from:      fromNumber,
            id:        `wamid.load-${Date.now()}-${Math.random()}`,
            text:      { body: messageText },
            type:      'text',
            timestamp: Math.floor(Date.now() / 1000).toString(),
          }],
        },
        field: 'messages',
      }],
    }],
  })
}

const TEST_MESSAGES = [
  'Hello, I want to book an appointment',
  'What are your clinic hours?',
  'Can I speak to the doctor?',
  'I need a follow-up appointment',
  'Please confirm my appointment for tomorrow',
]

export default function () {
  const fromNumber  = `91${Math.floor(9000000000 + Math.random() * 1000000000)}`
  const messageText = TEST_MESSAGES[Math.floor(Math.random() * TEST_MESSAGES.length)]
  const body        = makePayload(fromNumber, messageText)

  const res = http.post(
    `${BASE_URL}/api/webhook/whatsapp`,
    body,
    {
      headers: {
        'Content-Type': 'application/json',
        // No signature — test/dev mode bypasses verification
      },
    }
  )

  ackLatency.add(res.timings.duration)

  const ok = check(res, {
    'status is 200':              (r) => r.status === 200,
    'ack received true':          (r) => {
      try { return JSON.parse(r.body).received === true } catch { return false }
    },
    'response time < 500ms':      (r) => r.timings.duration < 500,
    'response time < 5000ms':     (r) => r.timings.duration < 5000,  // Meta hard limit
    'never 500':                  (r) => r.status !== 500,
  })

  errorRate.add(!ok)

  sleep(0.2)  // 200ms think time — WhatsApp sends bursts
}

export function handleSummary(data) {
  const p95  = data.metrics.http_req_duration?.values?.['p(95)'] ?? 'N/A'
  const p99  = data.metrics.http_req_duration?.values?.['p(99)'] ?? 'N/A'
  const rps  = data.metrics.http_reqs?.values?.rate ?? 'N/A'

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ClinCollab k6 — WhatsApp Webhook Load Test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SLA Target:  P95 < 500ms (Meta limit: 5000ms)
  P95 Latency: ${typeof p95 === 'number' ? p95.toFixed(2) + 'ms' : p95}
  P99 Latency: ${typeof p99 === 'number' ? p99.toFixed(2) + 'ms' : p99}
  Req/s:       ${typeof rps === 'number' ? rps.toFixed(2) : rps}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
  return {}
}
