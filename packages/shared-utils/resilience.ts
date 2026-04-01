/**
 * @clincollab/shared-utils — resilience primitives
 *
 * Circuit breaker, retry with backoff, timeout wrapper, and
 * structured error types. Consumed by every module that calls
 * an external service (Groq, WhatsApp API, Supabase edge functions).
 *
 * Design: each EXTERNAL service boundary must be wrapped in these
 * utilities so a failure at one service does NOT propagate to caller.
 */

import type { Result } from '../types'
import { ok, err } from '../types'

// ── Timeout wrapper ────────────────────────────────────────────
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label = 'operation'
): Promise<Result<T>> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  )
  try {
    const value = await Promise.race([fn(), timeout])
    return ok(value)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

// ── Retry with exponential backoff ─────────────────────────────
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number
    baseDelayMs?: number
    maxDelayMs?: number
    shouldRetry?: (error: Error) => boolean
    label?: string
  } = {}
): Promise<Result<T>> {
  const {
    maxAttempts = 3,
    baseDelayMs = 300,
    maxDelayMs  = 5000,
    shouldRetry = () => true,
    label       = 'operation',
  } = options

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return ok(await fn())
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))

      if (!shouldRetry(lastError) || attempt === maxAttempts) break

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
      const jitter = Math.random() * delay * 0.2
      await sleep(delay + jitter)

      console.warn(`[${label}] Attempt ${attempt} failed, retrying in ${Math.round(delay)}ms:`, lastError.message)
    }
  }

  return err(lastError?.message ?? `${label} failed after ${maxAttempts} attempts`)
}

// ── Circuit breaker state ──────────────────────────────────────
type BreakerState = 'closed' | 'open' | 'half-open'

interface BreakerConfig {
  failureThreshold: number    // failures before opening
  successThreshold: number    // successes in half-open to close
  resetTimeoutMs:   number    // time before trying half-open
}

const DEFAULT_BREAKER: BreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  resetTimeoutMs:   30_000,
}

// Global breaker registry — keyed by service name
const breakers = new Map<string, {
  state:          BreakerState
  failures:       number
  successes:      number
  lastFailureAt:  number | null
  config:         BreakerConfig
}>()

function getBreaker(service: string, config: BreakerConfig) {
  if (!breakers.has(service)) {
    breakers.set(service, {
      state: 'closed', failures: 0, successes: 0,
      lastFailureAt: null, config,
    })
  }
  return breakers.get(service)!
}

export async function withCircuitBreaker<T>(
  service: string,
  fn: () => Promise<T>,
  config: Partial<BreakerConfig> = {}
): Promise<Result<T>> {
  const cfg = { ...DEFAULT_BREAKER, ...config }
  const breaker = getBreaker(service, cfg)

  // Open — check if reset timeout elapsed
  if (breaker.state === 'open') {
    const elapsed = Date.now() - (breaker.lastFailureAt ?? 0)
    if (elapsed < cfg.resetTimeoutMs) {
      return err(`[circuit-breaker] ${service} is open — too many recent failures. Retrying in ${Math.round((cfg.resetTimeoutMs - elapsed) / 1000)}s`)
    }
    breaker.state = 'half-open'
    breaker.successes = 0
  }

  try {
    const value = await fn()

    // Success handling
    if (breaker.state === 'half-open') {
      breaker.successes++
      if (breaker.successes >= cfg.successThreshold) {
        breaker.state = 'closed'
        breaker.failures = 0
        console.log(`[circuit-breaker] ${service} closed after recovery`)
      }
    } else {
      breaker.failures = 0
    }

    return ok(value)
  } catch (e) {
    breaker.failures++
    breaker.lastFailureAt = Date.now()

    if (breaker.failures >= cfg.failureThreshold || breaker.state === 'half-open') {
      breaker.state = 'open'
      console.error(`[circuit-breaker] ${service} OPENED after ${breaker.failures} failures`)
    }

    return err(e instanceof Error ? e.message : String(e))
  }
}

// ── Convenience: timeout + circuit breaker combined ───────────
export async function callExternalService<T>(
  service: string,
  fn: () => Promise<T>,
  timeoutMs = 10_000
): Promise<Result<T>> {
  return withCircuitBreaker(service, () =>
    withTimeout(fn, timeoutMs, service).then(result => {
      if (!result.ok) throw new Error(result.error)
      return result.value
    })
  )
}

// ── Service health check ───────────────────────────────────────
export function getBreakerStatus(service: string): {
  state: BreakerState
  failures: number
  lastFailureAt: string | null
} {
  const b = breakers.get(service)
  return {
    state:         b?.state ?? 'closed',
    failures:      b?.failures ?? 0,
    lastFailureAt: b?.lastFailureAt ? new Date(b.lastFailureAt).toISOString() : null,
  }
}

export function getAllBreakerStatuses(): Record<string, ReturnType<typeof getBreakerStatus>> {
  const result: Record<string, ReturnType<typeof getBreakerStatus>> = {}
  breakers.forEach((_, service) => { result[service] = getBreakerStatus(service) })
  return result
}

// ── Sleep utility ──────────────────────────────────────────────
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Error classifier ──────────────────────────────────────────
export function isRetryableError(error: Error): boolean {
  const msg = error.message.toLowerCase()
  // Network errors and rate limits are retryable
  if (msg.includes('rate limit') || msg.includes('429')) return true
  if (msg.includes('network') || msg.includes('econnreset')) return true
  if (msg.includes('timeout') || msg.includes('econnrefused')) return true
  // Auth errors and 4xx (except 429) are NOT retryable
  if (msg.includes('401') || msg.includes('403') || msg.includes('404')) return false
  // 5xx are retryable
  if (msg.includes('500') || msg.includes('503')) return true
  return true
}

// ── Module error boundary ─────────────────────────────────────
/**
 * Wraps any module operation so that uncaught errors
 * are captured and returned as Result<T> rather than thrown.
 * Use at the top of every server action and API route.
 */
export async function moduleBoundary<T>(
  moduleName: string,
  fn: () => Promise<T>
): Promise<Result<T>> {
  try {
    return ok(await fn())
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[${moduleName}] Unhandled error:`, message)
    return err(message)
  }
}

// ── Structured logger ─────────────────────────────────────────
export function log(
  level: 'info' | 'warn' | 'error',
  module: string,
  event: string,
  meta?: Record<string, unknown>
) {
  const entry = {
    ts:  new Date().toISOString(),
    lvl: level,
    mod: module,
    evt: event,
    ...meta,
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else if (level === 'warn') console.warn(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}
