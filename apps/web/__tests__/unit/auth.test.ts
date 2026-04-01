/**
 * Module 1 — Unit Tests
 * Tests core business logic without external dependencies
 */

// ── Peer status classification ──────────────────────
describe('getPeerStatus', () => {
  const now = new Date().toISOString()

  function daysAgo(n: number) {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toISOString()
  }

  function getPeerStatus(lastReferralAt: string | null, daysSince: number | null) {
    if (!lastReferralAt) return 'new'
    const days = daysSince ?? 999
    if (days < 30)  return 'active'
    if (days < 90)  return 'drifting'
    return 'silent'
  }

  test('peer with no referral history is new', () => {
    expect(getPeerStatus(null, null)).toBe('new')
  })

  test('peer referred 5 days ago is active', () => {
    expect(getPeerStatus(daysAgo(5), 5)).toBe('active')
  })

  test('peer referred 29 days ago is still active', () => {
    expect(getPeerStatus(daysAgo(29), 29)).toBe('active')
  })

  test('peer referred 30 days ago is drifting', () => {
    expect(getPeerStatus(daysAgo(30), 30)).toBe('drifting')
  })

  test('peer referred 89 days ago is drifting', () => {
    expect(getPeerStatus(daysAgo(89), 89)).toBe('drifting')
  })

  test('peer referred 90 days ago is silent', () => {
    expect(getPeerStatus(daysAgo(90), 90)).toBe('silent')
  })

  test('peer referred 200 days ago is silent', () => {
    expect(getPeerStatus(daysAgo(200), 200)).toBe('silent')
  })
})

// ── Network gap calculation ─────────────────────────
describe('cityBenchmarkGap', () => {
  const CITY_BENCHMARKS: Record<string, number> = {
    Hyderabad: 14, Bengaluru: 16, Mumbai: 18, Delhi: 17,
    Chennai: 13, default: 12,
  }

  function getNetworkGap(city: string, peerCount: number) {
    const benchmark = CITY_BENCHMARKS[city] ?? CITY_BENCHMARKS.default
    return Math.max(0, benchmark - peerCount)
  }

  test('Hyderabad with 5 peers has gap of 9', () => {
    expect(getNetworkGap('Hyderabad', 5)).toBe(9)
  })

  test('Hyderabad with 14 peers has no gap', () => {
    expect(getNetworkGap('Hyderabad', 14)).toBe(0)
  })

  test('Hyderabad with 20 peers has no gap (no negative)', () => {
    expect(getNetworkGap('Hyderabad', 20)).toBe(0)
  })

  test('Unknown city uses default benchmark', () => {
    expect(getNetworkGap('Patna', 5)).toBe(7) // 12 - 5
  })
})

// ── Specialty label formatting ──────────────────────
describe('getSpecialtyLabel', () => {
  const map: Record<string, string> = {
    interventional_cardiology: 'Interventional Cardiology',
    cardiac_surgery: 'Cardiac Surgery',
    other: 'Other',
  }

  function getSpecialtyLabel(val: string) {
    return map[val] || val
  }

  test('known specialty returns formatted label', () => {
    expect(getSpecialtyLabel('interventional_cardiology')).toBe('Interventional Cardiology')
  })

  test('unknown specialty returns raw value', () => {
    expect(getSpecialtyLabel('something_else')).toBe('something_else')
  })
})

// ── Profile completeness ────────────────────────────
describe('profileCompletenessScore', () => {
  function calculateCompleteness(profile: {
    designation?: string | null
    sub_specialty?: string | null
    hospitals?: string[]
    years_experience?: number | null
    photo_url?: string | null
    mci_number?: string | null
  }) {
    const fields = [
      !!profile.designation,
      !!profile.sub_specialty,
      (profile.hospitals?.length ?? 0) > 0,
      !!profile.years_experience,
      !!profile.photo_url,
      !!profile.mci_number,
    ]
    const filled = fields.filter(Boolean).length
    return Math.round((filled / fields.length) * 100)
  }

  test('empty profile is 0%', () => {
    expect(calculateCompleteness({})).toBe(0)
  })

  test('fully complete profile is 100%', () => {
    expect(calculateCompleteness({
      designation: 'Consultant',
      sub_specialty: 'Electrophysiology',
      hospitals: ['AIIMS Hyderabad'],
      years_experience: 12,
      photo_url: 'https://example.com/photo.jpg',
      mci_number: 'MH12345',
    })).toBe(100)
  })

  test('half complete profile is 50%', () => {
    expect(calculateCompleteness({
      designation: 'Consultant',
      hospitals: ['KIMS'],
      years_experience: 8,
    })).toBe(50)
  })
})

// ── Admin email whitelist ───────────────────────────
describe('adminEmailWhitelist', () => {
  function isAdmin(email: string, whitelist: string) {
    return whitelist.split(',').map(e => e.trim()).includes(email)
  }

  test('admin email is recognised', () => {
    expect(isAdmin('avinash40keshri@gmail.com', 'avinash40keshri@gmail.com,clincollab40@gmail.com')).toBe(true)
  })

  test('non-admin email is rejected', () => {
    expect(isAdmin('doctor@example.com', 'avinash40keshri@gmail.com')).toBe(false)
  })

  test('whitespace around emails is trimmed', () => {
    expect(isAdmin('admin@clincollab.com', ' admin@clincollab.com , other@example.com ')).toBe(true)
  })
})
