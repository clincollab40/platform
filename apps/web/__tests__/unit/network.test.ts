/**
 * Module 2 — Unit Tests
 * Network intelligence, referral status, health scoring
 */

// ── Referral status logic ───────────────────────────
describe('referrer status classification', () => {
  function classify(lastReferralAt: string | null, daysSince: number | null) {
    if (!lastReferralAt) return 'new'
    const d = daysSince ?? 999
    if (d < 30)  return 'active'
    if (d < 90)  return 'drifting'
    return 'silent'
  }

  test('null referral = new', ()        => expect(classify(null, null)).toBe('new'))
  test('1 day ago = active', ()         => expect(classify('2024-01-01', 1)).toBe('active'))
  test('29 days ago = active', ()       => expect(classify('2024-01-01', 29)).toBe('active'))
  test('30 days ago = drifting', ()     => expect(classify('2024-01-01', 30)).toBe('drifting'))
  test('89 days ago = drifting', ()     => expect(classify('2024-01-01', 89)).toBe('drifting'))
  test('90 days ago = silent', ()       => expect(classify('2024-01-01', 90)).toBe('silent'))
  test('365 days ago = silent', ()      => expect(classify('2024-01-01', 365)).toBe('silent'))
})

// ── Health score algorithm ──────────────────────────
describe('network health score', () => {
  function score(total: number, active: number, drifting: number) {
    if (total === 0) return 0
    return Math.min(100, Math.round(100 * (active + drifting * 0.4) / total))
  }

  test('all active = 100', ()            => expect(score(10, 10, 0)).toBe(100))
  test('all silent = 0', ()              => expect(score(10, 0, 0)).toBe(0))
  test('half active = 50', ()            => expect(score(10, 5, 0)).toBe(50))
  test('all drifting = 40', ()           => expect(score(10, 0, 10)).toBe(40))
  test('empty network = 0', ()           => expect(score(0, 0, 0)).toBe(0))
  test('mixed = correct', ()             => expect(score(10, 6, 2)).toBe(68))
  test('cannot exceed 100', ()           => expect(score(5, 5, 5)).toBe(100))
})

// ── At-risk referrer identification ───────────────────
describe('at-risk referrer detection', () => {
  type Ref = { id: string; status: string; total_referrals: number; name: string }

  function getAtRisk(referrers: Ref[], minReferrals = 3) {
    return referrers
      .filter(r => r.status === 'silent' && r.total_referrals >= minReferrals)
      .sort((a, b) => b.total_referrals - a.total_referrals)
      .slice(0, 3)
  }

  const referrers: Ref[] = [
    { id: '1', status: 'silent',   total_referrals: 12, name: 'Dr. Mehta' },
    { id: '2', status: 'active',   total_referrals: 8,  name: 'Dr. Sharma' },
    { id: '3', status: 'silent',   total_referrals: 2,  name: 'Dr. Reddy' },
    { id: '4', status: 'drifting', total_referrals: 5,  name: 'Dr. Rao' },
    { id: '5', status: 'silent',   total_referrals: 7,  name: 'Dr. Patel' },
  ]

  test('only silent referrers with sufficient history', () => {
    const result = getAtRisk(referrers)
    expect(result.every(r => r.status === 'silent')).toBe(true)
    expect(result.every(r => r.total_referrals >= 3)).toBe(true)
  })

  test('sorted by volume descending', () => {
    const result = getAtRisk(referrers)
    expect(result[0].name).toBe('Dr. Mehta')
    expect(result[1].name).toBe('Dr. Patel')
  })

  test('max 3 returned', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: String(i), status: 'silent', total_referrals: 10, name: `Dr. ${i}`
    }))
    expect(getAtRisk(many).length).toBe(3)
  })

  test('referrer with 2 referrals not at-risk', () => {
    const result = getAtRisk(referrers)
    expect(result.find(r => r.name === 'Dr. Reddy')).toBeUndefined()
  })
})

// ── City benchmark gap ──────────────────────────────
describe('city benchmark gap', () => {
  const BENCHMARKS: Record<string, number> = {
    Hyderabad: 14, Bengaluru: 16, Mumbai: 18, default: 12,
  }

  function gap(city: string, count: number) {
    return Math.max(0, (BENCHMARKS[city] ?? BENCHMARKS.default) - count)
  }

  test('gap when under benchmark', ()   => expect(gap('Hyderabad', 8)).toBe(6))
  test('no gap at benchmark', ()        => expect(gap('Hyderabad', 14)).toBe(0))
  test('no gap above benchmark', ()     => expect(gap('Hyderabad', 20)).toBe(0))
  test('unknown city uses default', ()  => expect(gap('Nagpur', 5)).toBe(7))
})

// ── CSV import validation ───────────────────────────
describe('CSV import validation', () => {
  function validateRow(row: Record<string, string>) {
    if (!row.name?.trim())  return { valid: false, error: 'Name required' }
    if (!row.city?.trim())  return { valid: false, error: 'City required' }
    if (row.name.length > 100) return { valid: false, error: 'Name too long' }
    return { valid: true }
  }

  test('valid row passes', () => {
    expect(validateRow({ name: 'Dr. Mehta', city: 'Hyderabad' }).valid).toBe(true)
  })

  test('missing name fails', () => {
    expect(validateRow({ name: '', city: 'Hyderabad' }).valid).toBe(false)
  })

  test('missing city fails', () => {
    expect(validateRow({ name: 'Dr. Mehta', city: '' }).valid).toBe(false)
  })

  test('name too long fails', () => {
    expect(validateRow({ name: 'A'.repeat(101), city: 'Mumbai' }).valid).toBe(false)
  })

  test('whitespace-only name fails', () => {
    expect(validateRow({ name: '   ', city: 'Delhi' }).valid).toBe(false)
  })
})

// ── Relative date formatting ────────────────────────
describe('relativeDate', () => {
  function relativeDate(days: number | null) {
    if (days === null) return 'No referrals recorded'
    if (days === 0)    return 'Referred today'
    if (days === 1)    return 'Referred yesterday'
    if (days < 30)     return `${days} days ago`
    if (days < 365)    return `${Math.floor(days / 30)} months ago`
    return `${Math.floor(days / 365)} year${Math.floor(days / 365) > 1 ? 's' : ''} ago`
  }

  test('null = no referrals',    () => expect(relativeDate(null)).toBe('No referrals recorded'))
  test('0 days = today',         () => expect(relativeDate(0)).toBe('Referred today'))
  test('1 day = yesterday',      () => expect(relativeDate(1)).toBe('Referred yesterday'))
  test('15 days = days ago',     () => expect(relativeDate(15)).toBe('15 days ago'))
  test('45 days = months ago',   () => expect(relativeDate(45)).toBe('1 months ago'))
  test('400 days = years ago',   () => expect(relativeDate(400)).toBe('1 year ago'))
  test('800 days = plural years',() => expect(relativeDate(800)).toBe('2 years ago'))
})
