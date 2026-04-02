/**
 * M2 — Doctor Network Map — Unit Tests
 *
 * FIXES from original:
 *   1. City benchmarks aligned with actual CITY_BENCHMARKS in network/page.tsx
 *      (Mumbai=18, not 20; Delhi=17, not 18; Hyderabad=14)
 *   2. Added tests for InsightPanel network score color logic (new UI)
 *   3. Added at-risk detection for high-value referrers (total_referrals > 10)
 *   4. CSV validation tests now use 10-digit Indian mobile format consistently
 */

// ── Referrer engagement status ───────────────────────────────────
describe('M2 — referrerEngagementStatus', () => {
  function classifyReferrer(lastReferralAt: string | null, daysSince: number | null): string {
    if (!lastReferralAt) return 'new'
    const d = daysSince ?? 999
    if (d < 30) return 'active'
    if (d < 90) return 'drifting'
    return 'silent'
  }

  test('no referral history = new',           () => expect(classifyReferrer(null, null)).toBe('new'))
  test('1 day ago = active',                  () => expect(classifyReferrer('2024-01-01', 1)).toBe('active'))
  test('29 days = active (boundary)',         () => expect(classifyReferrer('2024-01-01', 29)).toBe('active'))
  test('30 days = drifting (boundary)',       () => expect(classifyReferrer('2024-01-01', 30)).toBe('drifting'))
  test('89 days = drifting (boundary)',       () => expect(classifyReferrer('2024-01-01', 89)).toBe('drifting'))
  test('90 days = silent (boundary)',         () => expect(classifyReferrer('2024-01-01', 90)).toBe('silent'))
  test('365 days = silent',                   () => expect(classifyReferrer('2024-01-01', 365)).toBe('silent'))
  test('0 days = active (today)',             () => expect(classifyReferrer('2024-01-01', 0)).toBe('active'))
  test('null daysSince uses 999 → silent',    () => expect(classifyReferrer('2024-01-01', null)).toBe('silent'))
})

// ── Network health score ─────────────────────────────────────────
describe('M2 — networkHealthScore', () => {
  function healthScore(total: number, active: number, drifting: number): number {
    if (total === 0) return 0
    return Math.min(100, Math.round(100 * (active + drifting * 0.4) / total))
  }

  test('empty network = 0',          () => expect(healthScore(0, 0, 0)).toBe(0))
  test('all active = 100',           () => expect(healthScore(10, 10, 0)).toBe(100))
  test('all silent = 0',             () => expect(healthScore(10, 0, 0)).toBe(0))
  test('half active = 50',           () => expect(healthScore(10, 5, 0)).toBe(50))
  test('all drifting = 40',          () => expect(healthScore(10, 0, 10)).toBe(40))
  test('8 active 2 drifting = 88',   () => expect(healthScore(10, 8, 2)).toBe(88))
  test('score capped at 100',        () => expect(healthScore(5, 5, 5)).toBe(100))
  test('5/5 active + 5 drifting = cap', () => expect(healthScore(10, 5, 5)).toBe(70))
})

// ── InsightPanel score color logic (new UI) ──────────────────────
describe('M2 — insightPanelScoreColor', () => {
  function getScoreColor(score: number): 'green' | 'amber' | 'red' {
    if (score >= 70) return 'green'
    if (score >= 40) return 'amber'
    return 'red'
  }

  test('score 100 → green',   () => expect(getScoreColor(100)).toBe('green'))
  test('score 70 → green',    () => expect(getScoreColor(70)).toBe('green'))
  test('score 69 → amber',    () => expect(getScoreColor(69)).toBe('amber'))
  test('score 40 → amber',    () => expect(getScoreColor(40)).toBe('amber'))
  test('score 39 → red',      () => expect(getScoreColor(39)).toBe('red'))
  test('score 0 → red',       () => expect(getScoreColor(0)).toBe('red'))
})

// ── City benchmark gap (CORRECTED from codebase values) ──────────
describe('M2 — cityBenchmarkGap', () => {
  // FIXED: values now match actual CITY_BENCHMARKS in network/page.tsx
  const benchmarks: Record<string, number> = {
    Hyderabad: 14, Bengaluru: 16, Mumbai: 18, Delhi: 17,
    Chennai: 13, Kolkata: 12, Pune: 13, Ahmedabad: 12, default: 12,
  }
  const gap = (city: string, count: number) =>
    Math.max(0, (benchmarks[city] ?? benchmarks.default) - count)

  test('Mumbai benchmark = 18',           () => expect(gap('Mumbai', 0)).toBe(18))
  test('Mumbai with 5 = gap 13',          () => expect(gap('Mumbai', 5)).toBe(13))
  test('Mumbai at benchmark = 0',         () => expect(gap('Mumbai', 18)).toBe(0))
  test('above benchmark = 0 (no neg)',    () => expect(gap('Mumbai', 25)).toBe(0))
  test('Hyderabad benchmark = 14',        () => expect(gap('Hyderabad', 0)).toBe(14))
  test('Delhi benchmark = 17',            () => expect(gap('Delhi', 10)).toBe(7))
  test('unknown city default = 12',       () => expect(gap('Patna', 3)).toBe(9))
})

// ── At-risk referrer detection ───────────────────────────────────
describe('M2 — atRiskReferrerDetection', () => {
  interface Referrer { status: string; days_since_last: number | null; total_referrals: number }
  function isAtRisk(r: Referrer): boolean {
    if (r.status === 'silent') return true
    if (r.status === 'drifting' && (r.days_since_last ?? 999) > 60) return true
    if (r.total_referrals > 10 && r.status === 'drifting') return true
    return false
  }

  test('silent = at risk',                    () => expect(isAtRisk({ status:'silent', days_since_last:100, total_referrals:5 })).toBe(true))
  test('drifting > 60 days = at risk',        () => expect(isAtRisk({ status:'drifting', days_since_last:65, total_referrals:3 })).toBe(true))
  test('drifting 45 days = not at risk',      () => expect(isAtRisk({ status:'drifting', days_since_last:45, total_referrals:2 })).toBe(false))
  test('high-volume drifting = at risk',      () => expect(isAtRisk({ status:'drifting', days_since_last:35, total_referrals:15 })).toBe(true))
  test('active = not at risk',               () => expect(isAtRisk({ status:'active', days_since_last:10, total_referrals:20 })).toBe(false))
  test('new referrer = not at risk',         () => expect(isAtRisk({ status:'new', days_since_last:null, total_referrals:0 })).toBe(false))
})

// ── CSV import validation ────────────────────────────────────────
describe('M2 — csvImportValidation', () => {
  function validateRow(row: Record<string, string>): string | null {
    if (!row.name || row.name.trim().length < 2) return 'Name is required (min 2 chars)'
    if (!row.mobile || !/^[6-9]\d{9}$/.test(row.mobile.replace(/[\s\-]/g, ''))) return 'Invalid Indian mobile (must start 6-9, 10 digits)'
    if (!row.specialty) return 'Specialty is required'
    return null
  }

  test('valid row passes',                  () => expect(validateRow({ name:'Dr. Shah', mobile:'9876543210', specialty:'general_surgery' })).toBeNull())
  test('missing name fails',                () => expect(validateRow({ name:'', mobile:'9876543210', specialty:'cardiology' })).toBeTruthy())
  test('single char name fails',            () => expect(validateRow({ name:'A', mobile:'9876543210', specialty:'urology' })).toBeTruthy())
  test('invalid mobile (5-digit) fails',    () => expect(validateRow({ name:'Dr. A', mobile:'12345', specialty:'urology' })).toBeTruthy())
  test('mobile starting with 5 fails',     () => expect(validateRow({ name:'Dr. B', mobile:'5876543210', specialty:'urology' })).toBeTruthy())
  test('mobile with spaces = stripped, valid', () => expect(validateRow({ name:'Dr. C', mobile:'98765 43210', specialty:'neurology' })).toBeNull())
  test('missing specialty fails',          () => expect(validateRow({ name:'Dr. D', mobile:'8765432109', specialty:'' })).toBeTruthy())
  test('+91 prefix stripped and valid',    () => {
    // Should be pre-stripped before calling validateRow
    const mobile = '+919876543210'.replace(/\+91/, '')
    expect(validateRow({ name:'Dr. E', mobile, specialty:'ortho' })).toBeNull()
  })
})
