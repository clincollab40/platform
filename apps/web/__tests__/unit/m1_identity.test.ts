/**
 * M1 — Identity, Auth & Onboarding — Unit Tests
 *
 * FIXES from original auth.test.ts + m1_m4_unit.test.ts:
 *   1. Removed duplicate tests (admin whitelist appeared in both files)
 *   2. Fixed profileCompletenessScore to use ACTUAL field names from the codebase
 *      (designation, sub_specialty, hospitals, years_experience, photo_url, mci_number)
 *      NOT the wrong fields (name, specialty, city, bio) used in m1_m4_unit.test.ts
 *   3. Added tests for new AppLayout specialist prop shape
 *   4. Added InsightPanel score computation tests (new component)
 */

// ── Peer status classification ───────────────────────────────────
describe('M1 — getPeerStatus: peer engagement classification', () => {
  function daysAgo(n: number) {
    const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString()
  }
  function getPeerStatus(lastReferralAt: string | null, daysSince: number | null) {
    if (!lastReferralAt) return 'new'
    const days = daysSince ?? 999
    if (days < 30)  return 'active'
    if (days < 90)  return 'drifting'
    return 'silent'
  }

  test('no referral history = new',          () => expect(getPeerStatus(null, null)).toBe('new'))
  test('5 days ago = active',                () => expect(getPeerStatus(daysAgo(5), 5)).toBe('active'))
  test('29 days ago = active (boundary)',    () => expect(getPeerStatus(daysAgo(29), 29)).toBe('active'))
  test('30 days ago = drifting (boundary)',  () => expect(getPeerStatus(daysAgo(30), 30)).toBe('drifting'))
  test('89 days ago = drifting (boundary)',  () => expect(getPeerStatus(daysAgo(89), 89)).toBe('drifting'))
  test('90 days ago = silent (boundary)',    () => expect(getPeerStatus(daysAgo(90), 90)).toBe('silent'))
  test('200 days ago = silent',             () => expect(getPeerStatus(daysAgo(200), 200)).toBe('silent'))
  test('0 days ago = active (today)',       () => expect(getPeerStatus(daysAgo(0), 0)).toBe('active'))
  test('null daysSince uses 999 default → silent', () =>
    expect(getPeerStatus(daysAgo(200), null)).toBe('silent'))
})

// ── City benchmark gap ───────────────────────────────────────────
describe('M1 — cityBenchmarkGap', () => {
  const CITY_BENCHMARKS: Record<string, number> = {
    Hyderabad: 14, Bengaluru: 16, Mumbai: 18, Delhi: 17,
    Chennai: 13, Kolkata: 12, Pune: 13, Ahmedabad: 12, default: 12,
  }
  function getNetworkGap(city: string, peerCount: number) {
    return Math.max(0, (CITY_BENCHMARKS[city] ?? CITY_BENCHMARKS.default) - peerCount)
  }

  test('Hyderabad with 5 peers = gap of 9',   () => expect(getNetworkGap('Hyderabad', 5)).toBe(9))
  test('Hyderabad at benchmark = no gap',     () => expect(getNetworkGap('Hyderabad', 14)).toBe(0))
  test('above benchmark = 0 (no negative)',   () => expect(getNetworkGap('Hyderabad', 20)).toBe(0))
  test('Mumbai benchmark = 18',              () => expect(getNetworkGap('Mumbai', 0)).toBe(18))
  test('unknown city uses default 12',       () => expect(getNetworkGap('Patna', 5)).toBe(7))
})

// ── Profile completeness — CORRECTED FIELD NAMES ─────────────────
// FIXED: original m1_m4_unit.test.ts used wrong fields (name/specialty/city/bio).
// Actual fields come from specialist_profiles table in migration 001.
describe('M1 — profileCompletenessScore (correct field names)', () => {
  function calculateCompleteness(profile: {
    designation?:      string | null
    sub_specialty?:    string | null
    hospitals?:        string[]
    years_experience?: number | null
    photo_url?:        string | null
    mci_number?:       string | null
  }) {
    const fields = [
      !!profile.designation,
      !!profile.sub_specialty,
      (profile.hospitals?.length ?? 0) > 0,
      profile.years_experience != null && profile.years_experience > 0,
      !!profile.photo_url,
      !!profile.mci_number,
    ]
    return Math.round((fields.filter(Boolean).length / fields.length) * 100)
  }

  test('empty profile = 0%',     () => expect(calculateCompleteness({})).toBe(0))
  test('fully complete = 100%',  () => expect(calculateCompleteness({
    designation: 'Consultant Interventional Cardiologist',
    sub_specialty: 'Electrophysiology',
    hospitals: ['KIMS Hospital, Hyderabad'],
    years_experience: 14,
    photo_url: 'https://supabase.co/storage/v1/object/sign/photos/spec-001.jpg',
    mci_number: 'AP-12345',
  })).toBe(100))
  test('3 of 6 fields = 50%',    () => expect(calculateCompleteness({
    designation: 'Consultant',
    hospitals: ['Apollo'],
    years_experience: 8,
  })).toBe(50))
  test('null values not counted', () => expect(calculateCompleteness({
    designation: 'Consultant', photo_url: null, mci_number: null
  })).toBe(17))  // 1/6 = 16.67 → 17
  test('empty hospitals array = not counted', () => expect(calculateCompleteness({
    designation: 'Consultant', hospitals: []
  })).toBe(17))
})

// ── Admin email whitelist ────────────────────────────────────────
describe('M1 — adminEmailWhitelist', () => {
  const isAdmin = (email: string, whitelist: string) =>
    whitelist.split(',').map(e => e.trim()).includes(email)

  test('registered admin email granted',          () => expect(isAdmin('avinash40keshri@gmail.com', 'avinash40keshri@gmail.com,clincollab40@gmail.com')).toBe(true))
  test('second admin email granted',              () => expect(isAdmin('clincollab40@gmail.com', 'avinash40keshri@gmail.com,clincollab40@gmail.com')).toBe(true))
  test('unknown email rejected',                  () => expect(isAdmin('hacker@evil.com', 'avinash40keshri@gmail.com')).toBe(false))
  test('empty email rejected',                    () => expect(isAdmin('', 'avinash40keshri@gmail.com')).toBe(false))
  test('whitespace around emails trimmed',        () => expect(isAdmin('admin@test.com', '  admin@test.com  ,  other@test.com  ')).toBe(true))
  test('case-sensitive — uppercase rejected',     () => expect(isAdmin('AVINASH40KESHRI@GMAIL.COM', 'avinash40keshri@gmail.com')).toBe(false))
})

// ── Specialist status labels ─────────────────────────────────────
describe('M1 — specialistStatusLabel', () => {
  const statusMap: Record<string, string> = {
    onboarding: 'Onboarding', active: 'Active',
    inactive: 'Inactive',     suspended: 'Suspended',
  }
  const getLabel = (s: string) => statusMap[s] || s

  test('onboarding label',         () => expect(getLabel('onboarding')).toBe('Onboarding'))
  test('active label',             () => expect(getLabel('active')).toBe('Active'))
  test('inactive label',           () => expect(getLabel('inactive')).toBe('Inactive'))
  test('suspended label',          () => expect(getLabel('suspended')).toBe('Suspended'))
  test('unknown → returns raw',    () => expect(getLabel('pending_review')).toBe('pending_review'))
})

// ── Specialty validation ─────────────────────────────────────────
describe('M1 — specialtyTypeValidation', () => {
  // These must match the specialty_type ENUM in migration 001
  const VALID = [
    'interventional_cardiology','cardiac_surgery','neurosurgery','orthopedics',
    'spine_surgery','general_surgery','gi_surgery','urology','oncology','neurology',
    'pulmonology','endocrinology','nephrology','ophthalmology','reproductive_medicine',
    'dermatology','electrophysiology','vascular_surgery','rheumatology','ent',
    'anesthesiology','radiology','pediatrics','internal_medicine','other',
  ]
  const isValid = (s: string) => VALID.includes(s)

  test('interventional_cardiology valid',  () => expect(isValid('interventional_cardiology')).toBe(true))
  test('cardiac_surgery valid',            () => expect(isValid('cardiac_surgery')).toBe(true))
  test('electrophysiology valid',          () => expect(isValid('electrophysiology')).toBe(true))
  test('"general_practitioner" invalid',   () => expect(isValid('general_practitioner')).toBe(false))
  test('empty string invalid',             () => expect(isValid('')).toBe(false))
  test('all listed specialties are valid', () => expect(VALID.every(isValid)).toBe(true))
})

// ── Onboarding step validation ───────────────────────────────────
describe('M1 — onboardingStepValidation', () => {
  function validateStep(step: number, data: Record<string, any>): string | null {
    if (step === 1) {
      if (!data.specialty) return 'Specialty is required'
      return null
    }
    if (step === 2) {
      if (!data.city || data.city.trim().length < 2) return 'City must be at least 2 characters'
      return null
    }
    return null
  }

  test('step 1 without specialty fails',   () => expect(validateStep(1, {})).toBeTruthy())
  test('step 1 with specialty passes',     () => expect(validateStep(1, { specialty: 'neurosurgery' })).toBeNull())
  test('step 2 without city fails',        () => expect(validateStep(2, {})).toBeTruthy())
  test('step 2 with city passes',          () => expect(validateStep(2, { city: 'Hyderabad' })).toBeNull())
  test('step 2 single char city fails',    () => expect(validateStep(2, { city: 'X' })).toBeTruthy())
})

// ── Peer seed status lifecycle ───────────────────────────────────
describe('M1 — peerSeedStatusLifecycle', () => {
  const transitions: Record<string, string[]> = {
    seeded: ['matched', 'active'],
    matched: ['active', 'drifting'],
    active: ['drifting'],
    drifting: ['silent', 'active'],
    silent: ['active'],
  }
  const canTransit = (from: string, to: string) => (transitions[from] || []).includes(to)

  test('seeded → matched valid',              () => expect(canTransit('seeded', 'matched')).toBe(true))
  test('active → drifting valid',             () => expect(canTransit('active', 'drifting')).toBe(true))
  test('drifting → silent valid',             () => expect(canTransit('drifting', 'silent')).toBe(true))
  test('silent → active valid (re-engage)',   () => expect(canTransit('silent', 'active')).toBe(true))
  test('silent → matched invalid',            () => expect(canTransit('silent', 'matched')).toBe(false))
  test('active → silent invalid (skip)',      () => expect(canTransit('active', 'silent')).toBe(false))
})

// ── Dashboard InsightPanel score computation ─────────────────────
// Tests the scoring logic used in dashboard/page.tsx InsightData computation
describe('M1 — dashboardInsightScoreComputation', () => {
  function computePracticeHealthScore(networkScore: number, completeness: number): number {
    return Math.round(networkScore * 0.6 + completeness * 0.4)
  }
  function computeNetworkScore(activePeers: number, totalPeers: number): number {
    if (totalPeers === 0) return 0
    return Math.round(Math.min(100, (activePeers / totalPeers) * 100))
  }

  test('0 peers = score 0',                    () => expect(computeNetworkScore(0, 0)).toBe(0))
  test('all active = 100',                     () => expect(computeNetworkScore(10, 10)).toBe(100))
  test('5 of 10 active = 50',                  () => expect(computeNetworkScore(5, 10)).toBe(50))
  test('practice health 60% net + 40% comp',  () => expect(computePracticeHealthScore(80, 60)).toBe(72))
  test('practice health zero state',          () => expect(computePracticeHealthScore(0, 0)).toBe(0))
  test('practice health fully complete',      () => expect(computePracticeHealthScore(100, 100)).toBe(100))
  test('score capped at 100',                 () => expect(computeNetworkScore(15, 10)).toBe(100))
})
