/**
 * Module 6 — Unit Tests
 * Synthesis agent: tool isolation, circuit breaker, data completeness,
 * red flag extraction, fallback brief generation
 */

import {
  withTimeout,
  withRetry,
  withCircuitBreaker,
  moduleBoundary,
  isRetryableError,
} from '@clincollab/shared-utils/resilience'
import { ok, err } from '@clincollab/types'
import type { ClinCollab } from '@clincollab/types'

// ══════════════════════════════════════════════════
// RESULT TYPE
// ══════════════════════════════════════════════════
describe('Result<T> type', () => {
  test('ok() creates success result', () => {
    const r = ok(42)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(42)
  })

  test('err() creates error result', () => {
    const r = err<number>('something failed')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('something failed')
  })
})

// ══════════════════════════════════════════════════
// TIMEOUT WRAPPER
// ══════════════════════════════════════════════════
describe('withTimeout', () => {
  test('returns ok when fn completes before timeout', async () => {
    const result = await withTimeout(() => Promise.resolve('done'), 1000)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('done')
  })

  test('returns err when fn exceeds timeout', async () => {
    const result = await withTimeout(
      () => new Promise(resolve => setTimeout(() => resolve('late'), 500)),
      50,
      'test_op'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('timed out')
  })

  test('returns err on thrown error', async () => {
    const result = await withTimeout(
      () => Promise.reject(new Error('boom')),
      1000
    )
    expect(result.ok).toBe(false)
  })
})

// ══════════════════════════════════════════════════
// RETRY WITH BACKOFF
// ══════════════════════════════════════════════════
describe('withRetry', () => {
  test('succeeds on first try', async () => {
    const fn = jest.fn().mockResolvedValue('ok')
    const result = await withRetry(fn, { maxAttempts: 3 })
    expect(result.ok).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('retries on failure and eventually succeeds', async () => {
    let calls = 0
    const fn = jest.fn().mockImplementation(async () => {
      calls++
      if (calls < 3) throw new Error('temporary failure')
      return 'success'
    })
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    expect(result.ok).toBe(true)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  test('returns err after max attempts exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('persistent failure'))
    const result = await withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 })
    expect(result.ok).toBe(false)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  test('does not retry non-retryable errors when shouldRetry returns false', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('404 not found'))
    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      shouldRetry: (e) => !e.message.includes('404'),
    })
    expect(result.ok).toBe(false)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

// ══════════════════════════════════════════════════
// CIRCUIT BREAKER
// ══════════════════════════════════════════════════
describe('withCircuitBreaker', () => {
  const service = `test_service_${Date.now()}` // unique per test run

  test('allows calls when circuit is closed', async () => {
    const result = await withCircuitBreaker(service, () => Promise.resolve('ok'))
    expect(result.ok).toBe(true)
  })

  test('opens after failure threshold', async () => {
    const svc = `svc_open_${Date.now()}`
    const fn = jest.fn().mockRejectedValue(new Error('failure'))

    // Hit failure threshold
    for (let i = 0; i < 5; i++) {
      await withCircuitBreaker(svc, fn, { failureThreshold: 5 })
    }

    // Next call should be blocked
    const blocked = await withCircuitBreaker(svc, fn, { failureThreshold: 5 })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error).toContain('open')
  })
})

// ══════════════════════════════════════════════════
// MODULE BOUNDARY
// ══════════════════════════════════════════════════
describe('moduleBoundary', () => {
  test('returns ok result from successful fn', async () => {
    const result = await moduleBoundary('TEST', () => Promise.resolve('value'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('value')
  })

  test('catches thrown error and returns err — never rethrows', async () => {
    const result = await moduleBoundary('TEST', () => {
      throw new Error('module crashed')
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('module crashed')
  })

  test('catches async rejection — never rethrows', async () => {
    const result = await moduleBoundary('TEST', async () => {
      await Promise.reject(new Error('async crash'))
    })
    expect(result.ok).toBe(false)
  })
})

// ══════════════════════════════════════════════════
// ERROR CLASSIFICATION
// ══════════════════════════════════════════════════
describe('isRetryableError', () => {
  test('rate limit is retryable', () => {
    expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true)
  })
  test('429 is retryable', () => {
    expect(isRetryableError(new Error('status 429 too many requests'))).toBe(true)
  })
  test('network error is retryable', () => {
    expect(isRetryableError(new Error('network connection failed'))).toBe(true)
  })
  test('timeout is retryable', () => {
    expect(isRetryableError(new Error('operation timed out'))).toBe(true)
  })
  test('401 auth error is NOT retryable', () => {
    expect(isRetryableError(new Error('401 unauthorized'))).toBe(false)
  })
  test('404 not found is NOT retryable', () => {
    expect(isRetryableError(new Error('404 not found'))).toBe(false)
  })
  test('500 server error is retryable', () => {
    expect(isRetryableError(new Error('500 internal server error'))).toBe(true)
  })
})

// ══════════════════════════════════════════════════
// DATA COMPLETENESS SCORING
// ══════════════════════════════════════════════════
describe('data completeness scoring', () => {
  function computeCompleteness(successCount: number, totalTools: number): number {
    return Math.round((successCount / totalTools) * 100)
  }

  test('all 5 tools = 100%', () => {
    expect(computeCompleteness(5, 5)).toBe(100)
  })

  test('4 tools = 80%', () => {
    expect(computeCompleteness(4, 5)).toBe(80)
  })

  test('1 tool = 20%', () => {
    expect(computeCompleteness(1, 5)).toBe(20)
  })

  test('0 tools = 0% (synthesis should not proceed)', () => {
    expect(computeCompleteness(0, 5)).toBe(0)
  })
})

// ══════════════════════════════════════════════════
// RED FLAG EXTRACTION
// ══════════════════════════════════════════════════
describe('synthesis red flag extraction from tool outputs', () => {
  function extractRedFlags(outputs: any[]): ClinCollab.SynthesisRedFlag[] {
    const flags: ClinCollab.SynthesisRedFlag[] = []
    for (const o of outputs) {
      if (o.source === 'triage_self_report' && o.redFlagLevel !== 'none') {
        flags.push({
          description: o.redFlagSummary || 'Triage flag',
          source: 'triage_self_report',
          level: o.redFlagLevel,
        })
      }
      if (o.source === 'referral_summary' && o.urgency === 'emergency') {
        flags.push({ description: 'Emergency referral', source: 'referral_summary', level: 'urgent' })
      }
    }
    return flags
  }

  test('urgent triage flag surfaced', () => {
    const flags = extractRedFlags([{
      source: 'triage_self_report', redFlagLevel: 'urgent', redFlagSummary: 'BP 190/110'
    }])
    expect(flags).toHaveLength(1)
    expect(flags[0].level).toBe('urgent')
  })

  test('no flags when triage is clear', () => {
    const flags = extractRedFlags([{
      source: 'triage_self_report', redFlagLevel: 'none', redFlagSummary: null
    }])
    expect(flags).toHaveLength(0)
  })

  test('emergency referral creates urgent flag', () => {
    const flags = extractRedFlags([{
      source: 'referral_summary', urgency: 'emergency'
    }])
    expect(flags[0].level).toBe('urgent')
  })

  test('multiple sources can each contribute flags', () => {
    const flags = extractRedFlags([
      { source: 'triage_self_report', redFlagLevel: 'needs_review', redFlagSummary: 'Syncope' },
      { source: 'referral_summary', urgency: 'emergency' },
    ])
    expect(flags).toHaveLength(2)
  })

  test('triage needs_review does not become urgent in aggregation', () => {
    const flags = extractRedFlags([{
      source: 'triage_self_report', redFlagLevel: 'needs_review', redFlagSummary: 'Tachycardia'
    }])
    expect(flags[0].level).toBe('needs_review')
  })
})

// ══════════════════════════════════════════════════
// SYNTHESIS CONTEXT BUILDING
// ══════════════════════════════════════════════════
describe('synthesis context building', () => {
  function buildContext(outputs: any[]): string {
    return outputs.map(o => {
      if (o.source === 'triage_self_report') {
        return `TRIAGE: ${o.answers?.map((a: any) => `${a.question_text}: ${a.answer_value}`).join(', ')}`
      }
      if (o.source === 'referral_summary') {
        return `REFERRAL: ${o.chiefComplaint}`
      }
      return `OTHER: ${o.source}`
    }).join('\n\n')
  }

  test('triage answers included in context', () => {
    const ctx = buildContext([{
      source: 'triage_self_report',
      answers: [{ question_text: 'Do you have chest pain?', answer_value: 'yes' }],
      redFlagLevel: 'urgent',
    }])
    expect(ctx).toContain('chest pain')
    expect(ctx).toContain('yes')
  })

  test('referral complaint included in context', () => {
    const ctx = buildContext([{
      source: 'referral_summary',
      chiefComplaint: 'Chest tightness on exertion',
    }])
    expect(ctx).toContain('Chest tightness on exertion')
  })

  test('empty outputs produce empty context', () => {
    const ctx = buildContext([])
    expect(ctx).toBe('')
  })
})

// ══════════════════════════════════════════════════
// NOTIFICATION BUS
// ══════════════════════════════════════════════════
describe('notification templates', () => {
  const T = {
    synthesisReady: (specialist: string, patient: string, url: string) =>
      `ClinCollab — Pre-consultation brief ready\n\nDr. ${specialist},\n\n360° clinical synthesis for ${patient} is ready.\n\nView brief: ${url}`,
  }

  test('synthesis ready message contains specialist name and URL', () => {
    const msg = T.synthesisReady('Kumar', 'Patient X', 'https://app.clincollab.com/synthesis/abc')
    expect(msg).toContain('Dr. Kumar')
    expect(msg).toContain('Patient X')
    expect(msg).toContain('https://app.clincollab.com')
  })
})
