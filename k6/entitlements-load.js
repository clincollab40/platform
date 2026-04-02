/**
 * k6 Load Test — GET /api/config/entitlements
 *
 * SLA target: P95 < 200ms at 100 concurrent virtual users
 *
 * Run:
 *   k6 run k6/entitlements-load.js
 *   k6 run --env BASE_URL=https://sit.clincollab.com k6/entitlements-load.js
 *
 * Install k6: https://k6.io/docs/getting-started/installation/
 */

import http    from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend, Counter } from 'k6/metrics'

// ── Custom metrics ─────────────────────────────────────────────────
const errorRate    = new Rate('error_rate')
const p95Latency   = new Trend('p95_latency', true)
const starterCount = new Counter('starter_fallback_count')

// ── Test config ────────────────────────────────────────────────────
export const options = {
  scenarios: {
    constant_load: {
      executor:   'constant-vus',
      vus:        100,
      duration:   '60s',
    },
    ramp_up: {
      executor:   'ramping-vus',
      startVUs:   0,
      stages: [
        { duration: '30s', target: 50  },
        { duration: '60s', target: 100 },
        { duration: '30s', target: 0   },
      ],
      startTime: '70s',  // Run after constant_load
    },
  },
  thresholds: {
    // SLA: P95 < 200ms
    http_req_duration:      ['p(95)<200', 'p(99)<500'],
    // Error rate < 1%
    error_rate:             ['rate<0.01'],
    // All requests return 200 (fail-open)
    'http_req_failed':      ['rate<0.01'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

// ── Auth cookie (set E2E_AUTH_COOKIE in env for authenticated load test) ──
const AUTH_COOKIE = __ENV.E2E_AUTH_COOKIE || ''

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  }
  if (AUTH_COOKIE) {
    headers['Cookie'] = AUTH_COOKIE
  }

  const res = http.get(`${BASE_URL}/api/config/entitlements`, { headers })

  // Record metrics
  p95Latency.add(res.timings.duration)

  const ok = check(res, {
    'status is 200':              (r) => r.status === 200,
    'response has enabledModules':(r) => {
      try { return JSON.parse(r.body).enabledModules !== undefined } catch { return false }
    },
    'response has planTier':      (r) => {
      try { return JSON.parse(r.body).planTier !== undefined } catch { return false }
    },
    'response time < 200ms':      (r) => r.timings.duration < 200,
    'fail-open: never returns 500':(r) => r.status !== 500,
  })

  errorRate.add(!ok)

  // Track fail-open fallback responses (unauthenticated in load test = starter defaults)
  try {
    const body = JSON.parse(res.body)
    if (body.planTier === 'starter' && res.status === 200) {
      starterCount.add(1)
    }
  } catch { /* ignore */ }

  sleep(0.1)  // 100ms think time — realistic browser polling interval
}

export function handleSummary(data) {
  const p95  = data.metrics.http_req_duration?.values?.['p(95)'] ?? 'N/A'
  const p99  = data.metrics.http_req_duration?.values?.['p(99)'] ?? 'N/A'
  const rps  = data.metrics.http_reqs?.values?.rate ?? 'N/A'
  const errs = data.metrics.error_rate?.values?.rate ?? 'N/A'

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ClinCollab k6 — Entitlements Load Test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SLA Target:  P95 < 200ms
  P95 Latency: ${typeof p95 === 'number' ? p95.toFixed(2) + 'ms' : p95}
  P99 Latency: ${typeof p99 === 'number' ? p99.toFixed(2) + 'ms' : p99}
  Req/s:       ${typeof rps === 'number' ? rps.toFixed(2) : rps}
  Error Rate:  ${typeof errs === 'number' ? (errs * 100).toFixed(2) + '%' : errs}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
  return {}
}
