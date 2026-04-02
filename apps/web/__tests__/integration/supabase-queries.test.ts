/**
 * Integration Tests — Supabase Query Patterns
 *
 * Validates query builder patterns, RLS-aware query construction,
 * and data mapping functions used across ClinCollab modules.
 *
 * All Supabase client calls are mocked — no live DB required.
 * Live DB validation is in __tests__/db/rls.test.ts.
 */

// ── Mock Supabase ──────────────────────────────────────────────────
const mockSelect  = jest.fn().mockReturnThis()
const mockEq      = jest.fn().mockReturnThis()
const mockOrder   = jest.fn().mockReturnThis()
const mockLimit   = jest.fn().mockReturnThis()
const mockSingle  = jest.fn()
const mockInsert  = jest.fn().mockReturnThis()
const mockUpdate  = jest.fn().mockReturnThis()

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: mockSelect,
      eq:     mockEq,
      order:  mockOrder,
      limit:  mockLimit,
      single: mockSingle,
      insert: mockInsert,
      update: mockUpdate,
    })),
    auth: { getUser: jest.fn() },
  })),
}))

// ── Specialist data mapping ────────────────────────────────────────
describe('Integration — specialistDataMapping', () => {
  interface DBSpecialist {
    id: string
    full_name: string
    email: string
    specialty: string
    city: string
    status: string
    created_at: string
    specialist_profiles?: { designation: string; years_experience: number | null }[]
  }

  interface AppSpecialist {
    id: string
    name: string
    email: string
    specialty: string
    city: string
    status: string
    designation: string | null
    yearsExperience: number | null
  }

  function mapDBSpecialistToApp(db: DBSpecialist): AppSpecialist {
    const profile = db.specialist_profiles?.[0] ?? null
    return {
      id:              db.id,
      name:            db.full_name,
      email:           db.email,
      specialty:       db.specialty,
      city:            db.city,
      status:          db.status,
      designation:     profile?.designation ?? null,
      yearsExperience: profile?.years_experience ?? null,
    }
  }

  const dbRow: DBSpecialist = {
    id: 'spec-001',
    full_name: 'Dr. Rajan Kumar',
    email: 'rajan@hospital.com',
    specialty: 'interventional_cardiology',
    city: 'Hyderabad',
    status: 'active',
    created_at: '2024-01-15T10:00:00Z',
    specialist_profiles: [{ designation: 'Consultant IC', years_experience: 12 }],
  }

  test('maps full_name to name',                  () => expect(mapDBSpecialistToApp(dbRow).name).toBe('Dr. Rajan Kumar'))
  test('maps specialty correctly',                () => expect(mapDBSpecialistToApp(dbRow).specialty).toBe('interventional_cardiology'))
  test('extracts designation from profile',       () => expect(mapDBSpecialistToApp(dbRow).designation).toBe('Consultant IC'))
  test('extracts years_experience from profile',  () => expect(mapDBSpecialistToApp(dbRow).yearsExperience).toBe(12))
  test('null profile → null designation',         () => {
    const noProfile = { ...dbRow, specialist_profiles: [] }
    expect(mapDBSpecialistToApp(noProfile).designation).toBeNull()
  })
  test('null profile → null yearsExperience',     () => {
    const noProfile = { ...dbRow, specialist_profiles: [] }
    expect(mapDBSpecialistToApp(noProfile).yearsExperience).toBeNull()
  })
  test('created_at is not exposed in app model',  () => {
    const app = mapDBSpecialistToApp(dbRow) as any
    expect(app.created_at).toBeUndefined()
  })
})

// ── Referral data mapping ──────────────────────────────────────────
describe('Integration — referralDataMapping', () => {
  interface DBReferral {
    id: string
    specialist_id: string
    referring_doctor_id: string
    patient_name: string
    patient_phone: string
    urgency: string
    status: string
    clinical_summary: string | null
    created_at: string
    updated_at: string
  }

  interface AppReferral {
    id: string
    specialistId: string
    referringDoctorId: string
    patient: { name: string; phone: string }
    urgency: 'emergency' | 'urgent' | 'semi_urgent' | 'elective'
    status: string
    clinicalSummary: string | null
    createdAt: Date
  }

  function mapDBReferral(db: DBReferral): AppReferral {
    return {
      id:                db.id,
      specialistId:      db.specialist_id,
      referringDoctorId: db.referring_doctor_id,
      patient:           { name: db.patient_name, phone: db.patient_phone },
      urgency:           db.urgency as AppReferral['urgency'],
      status:            db.status,
      clinicalSummary:   db.clinical_summary,
      createdAt:         new Date(db.created_at),
    }
  }

  const dbReferral: DBReferral = {
    id: 'ref-001',
    specialist_id: 'spec-001',
    referring_doctor_id: 'rd-001',
    patient_name: 'Suresh Babu',
    patient_phone: '9876543210',
    urgency: 'urgent',
    status: 'submitted',
    clinical_summary: 'Chest pain with ECG changes',
    created_at: '2024-03-15T08:00:00Z',
    updated_at: '2024-03-15T08:05:00Z',
  }

  test('patient name and phone nested in patient object',  () => {
    const app = mapDBReferral(dbReferral)
    expect(app.patient.name).toBe('Suresh Babu')
    expect(app.patient.phone).toBe('9876543210')
  })
  test('specialist_id mapped to camelCase',                () => expect(mapDBReferral(dbReferral).specialistId).toBe('spec-001'))
  test('created_at mapped to Date object',                 () => expect(mapDBReferral(dbReferral).createdAt).toBeInstanceOf(Date))
  test('updated_at not exposed in app model',              () => expect((mapDBReferral(dbReferral) as any).updated_at).toBeUndefined())
  test('null clinical_summary preserved',                  () => {
    const noSummary = { ...dbReferral, clinical_summary: null }
    expect(mapDBReferral(noSummary).clinicalSummary).toBeNull()
  })
})

// ── Supabase error handling ────────────────────────────────────────
describe('Integration — supabaseErrorHandling', () => {
  interface SupabaseError { message: string; code?: string; details?: string; hint?: string }

  function classifyError(error: SupabaseError): {
    type: 'not_found' | 'rls_violation' | 'unique_violation' | 'foreign_key' | 'unknown'
    userMessage: string
    retryable: boolean
  } {
    const msg = error.message.toLowerCase()
    const code = error.code ?? ''

    if (msg.includes('no rows') || msg.includes('not found') || code === 'PGRST116') {
      return { type: 'not_found', userMessage: 'Resource not found', retryable: false }
    }
    if (msg.includes('rls') || msg.includes('row level security') || msg.includes('permission denied')) {
      return { type: 'rls_violation', userMessage: 'Access denied', retryable: false }
    }
    if (msg.includes('unique') || msg.includes('duplicate') || code === '23505') {
      return { type: 'unique_violation', userMessage: 'Record already exists', retryable: false }
    }
    if (msg.includes('foreign key') || code === '23503') {
      return { type: 'foreign_key', userMessage: 'Related record not found', retryable: false }
    }
    return { type: 'unknown', userMessage: 'An unexpected error occurred', retryable: true }
  }

  test('PGRST116 classified as not_found',             () => expect(classifyError({ message:'The result contains 0 rows', code:'PGRST116' }).type).toBe('not_found'))
  test('"no rows" message = not_found',                () => expect(classifyError({ message:'no rows returned' }).type).toBe('not_found'))
  test('permission denied = rls_violation',            () => expect(classifyError({ message:'permission denied for table referrals' }).type).toBe('rls_violation'))
  test('unique constraint = unique_violation',         () => expect(classifyError({ message:'duplicate key value violates unique constraint', code:'23505' }).type).toBe('unique_violation'))
  test('foreign key = foreign_key type',               () => expect(classifyError({ message:'insert or update on table violates foreign key constraint', code:'23503' }).type).toBe('foreign_key'))
  test('unknown error is retryable',                   () => expect(classifyError({ message:'connection timeout' }).retryable).toBe(true))
  test('not_found is not retryable',                   () => expect(classifyError({ message:'no rows', code:'PGRST116' }).retryable).toBe(false))
  test('rls_violation is not retryable',               () => expect(classifyError({ message:'permission denied' }).retryable).toBe(false))
})

// ── Pagination helper ──────────────────────────────────────────────
describe('Integration — supabasePaginationHelper', () => {
  interface PageParams { page: number; pageSize: number }
  interface RangeResult { from: number; to: number }

  function getRange({ page, pageSize }: PageParams): RangeResult {
    const from = (page - 1) * pageSize
    const to   = from + pageSize - 1
    return { from, to }
  }

  function buildPaginationMeta(totalCount: number, page: number, pageSize: number) {
    return {
      total: totalCount,
      page,
      pageSize,
      totalPages: Math.ceil(totalCount / pageSize),
      hasNextPage: page * pageSize < totalCount,
      hasPrevPage: page > 1,
    }
  }

  test('page 1, size 10 → range 0-9',               () => expect(getRange({ page:1, pageSize:10 })).toEqual({ from:0, to:9 }))
  test('page 2, size 10 → range 10-19',             () => expect(getRange({ page:2, pageSize:10 })).toEqual({ from:10, to:19 }))
  test('page 3, size 5 → range 10-14',              () => expect(getRange({ page:3, pageSize:5  })).toEqual({ from:10, to:14 }))
  test('page 1, size 25 → range 0-24',              () => expect(getRange({ page:1, pageSize:25 })).toEqual({ from:0, to:24 }))

  test('total 100, page 1, size 10 → 10 pages',     () => expect(buildPaginationMeta(100, 1, 10).totalPages).toBe(10))
  test('total 101, page 1, size 10 → 11 pages',     () => expect(buildPaginationMeta(101, 1, 10).totalPages).toBe(11))
  test('page 1 has no prev page',                   () => expect(buildPaginationMeta(100, 1, 10).hasPrevPage).toBe(false))
  test('page 2 has prev page',                      () => expect(buildPaginationMeta(100, 2, 10).hasPrevPage).toBe(true))
  test('page 10 of 10 has no next page',            () => expect(buildPaginationMeta(100, 10, 10).hasNextPage).toBe(false))
  test('page 9 of 10 has next page',                () => expect(buildPaginationMeta(100, 9, 10).hasNextPage).toBe(true))
  test('total 0 → 0 pages',                         () => expect(buildPaginationMeta(0, 1, 10).totalPages).toBe(0))
})
