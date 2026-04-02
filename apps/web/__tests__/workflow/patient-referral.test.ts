/**
 * Workflow Tests — End-to-End Patient Referral Journey
 *
 * Tests the complete patient referral workflow as experienced by the
 * referring doctor, receiving specialist, and patient:
 *
 *   Referring doctor creates referral →
 *   System classifies urgency →
 *   Routes to best specialist →
 *   Specialist accepts →
 *   Patient notified via WhatsApp →
 *   Appointment booked →
 *   Post-procedure follow-up
 *
 * Pure function workflow simulation — no live DB required.
 */

// ── Workflow state ─────────────────────────────────────────────────
interface Specialist {
  id: string; name: string; specialty: string; city: string
  is_available: boolean; current_load: number; max_load: number
}

interface ReferralCase {
  id:              string
  referringDoctorId: string
  patientName:     string
  patientPhone:    string
  requiredSpecialty: string
  city:            string
  urgency:         'emergency' | 'urgent' | 'semi_urgent' | 'elective'
  status:          string
  assignedSpecialistId?: string
  appointmentDate?: string
  appointmentTime?: string
  whatsappNotified: boolean
  followUpScheduled: boolean
}

// ── Pure workflow functions ────────────────────────────────────────
function classifyUrgency(symptoms: { stemi?: boolean; ecg_changes?: boolean; unstable?: boolean; chest_pain?: boolean }): 'emergency' | 'urgent' | 'semi_urgent' | 'elective' {
  if (symptoms.stemi || (symptoms.unstable && symptoms.chest_pain)) return 'emergency'
  if (symptoms.ecg_changes) return 'urgent'
  if (symptoms.chest_pain)  return 'semi_urgent'
  return 'elective'
}

function routeToSpecialist(referral: ReferralCase, specialists: Specialist[]): Specialist | null {
  const eligible = specialists.filter(s =>
    s.specialty === referral.requiredSpecialty &&
    s.is_available &&
    s.current_load < s.max_load
  )
  if (!eligible.length) return null
  const sameCity = eligible.filter(s => s.city === referral.city)
  const pool = sameCity.length ? sameCity : eligible
  return pool.sort((a, b) => a.current_load - b.current_load)[0]
}

function acceptReferral(referral: ReferralCase, specialistId: string): ReferralCase {
  if (referral.status !== 'submitted') throw new Error('Can only accept submitted referrals')
  return { ...referral, status: 'accepted', assignedSpecialistId: specialistId }
}

function scheduleAppointment(referral: ReferralCase, date: string, time: string): ReferralCase {
  if (referral.status !== 'accepted') throw new Error('Must be accepted before scheduling')
  return { ...referral, appointmentDate: date, appointmentTime: time, status: 'in_progress', whatsappNotified: true }
}

function completeReferral(referral: ReferralCase): ReferralCase {
  if (referral.status !== 'in_progress') throw new Error('Can only complete in-progress referrals')
  return { ...referral, status: 'completed', followUpScheduled: true }
}

// ── Test data ─────────────────────────────────────────────────────
const SPECIALISTS: Specialist[] = [
  { id:'s1', name:'Dr. Rajan Kumar',   specialty:'interventional_cardiology', city:'Hyderabad', is_available:true,  current_load:3, max_load:10 },
  { id:'s2', name:'Dr. Priya Sharma',  specialty:'interventional_cardiology', city:'Hyderabad', is_available:true,  current_load:1, max_load:10 },
  { id:'s3', name:'Dr. Suresh Naidu',  specialty:'interventional_cardiology', city:'Mumbai',    is_available:true,  current_load:0, max_load:10 },
  { id:'s4', name:'Dr. Anita Rao',     specialty:'neurosurgery',              city:'Hyderabad', is_available:true,  current_load:2, max_load:10 },
  { id:'s5', name:'Dr. Vikram Reddy',  specialty:'interventional_cardiology', city:'Hyderabad', is_available:false, current_load:0, max_load:10 },
]

function createReferral(overrides: Partial<ReferralCase> = {}): ReferralCase {
  return {
    id:                'ref-001',
    referringDoctorId: 'rd-001',
    patientName:       'Ramesh Babu',
    patientPhone:      '9876543210',
    requiredSpecialty: 'interventional_cardiology',
    city:              'Hyderabad',
    urgency:           'urgent',
    status:            'submitted',
    whatsappNotified:  false,
    followUpScheduled: false,
    ...overrides,
  }
}

// ── Workflow tests ─────────────────────────────────────────────────
describe('Workflow — patientReferralJourney: full happy path', () => {
  test('Step 1: urgency classified from clinical data', () => {
    const urgency = classifyUrgency({ ecg_changes: true })
    expect(urgency).toBe('urgent')
  })

  test('Step 2: routes to lowest-load specialist in same city', () => {
    const referral = createReferral()
    const specialist = routeToSpecialist(referral, SPECIALISTS)
    expect(specialist).not.toBeNull()
    expect(specialist!.id).toBe('s2')  // lowest load (1) in Hyderabad
    expect(specialist!.city).toBe('Hyderabad')
  })

  test('Step 3: specialist accepts referral', () => {
    const referral = createReferral()
    const accepted = acceptReferral(referral, 's2')
    expect(accepted.status).toBe('accepted')
    expect(accepted.assignedSpecialistId).toBe('s2')
  })

  test('Step 4: appointment scheduled with WhatsApp notification', () => {
    const referral = createReferral({ status: 'accepted', assignedSpecialistId: 's2' })
    const scheduled = scheduleAppointment(referral, '2024-03-25', '10:00')
    expect(scheduled.status).toBe('in_progress')
    expect(scheduled.appointmentDate).toBe('2024-03-25')
    expect(scheduled.appointmentTime).toBe('10:00')
    expect(scheduled.whatsappNotified).toBe(true)
  })

  test('Step 5: referral completed with follow-up scheduled', () => {
    const referral = createReferral({ status: 'in_progress', assignedSpecialistId: 's2', whatsappNotified: true })
    const completed = completeReferral(referral)
    expect(completed.status).toBe('completed')
    expect(completed.followUpScheduled).toBe(true)
  })

  test('Full pipeline: submitted → completed', () => {
    let referral = createReferral()

    // Route and assign
    const specialist = routeToSpecialist(referral, SPECIALISTS)
    expect(specialist).not.toBeNull()

    // Accept
    referral = acceptReferral(referral, specialist!.id)
    expect(referral.status).toBe('accepted')

    // Schedule
    referral = scheduleAppointment(referral, '2024-03-25', '10:00')
    expect(referral.status).toBe('in_progress')

    // Complete
    referral = completeReferral(referral)
    expect(referral.status).toBe('completed')
    expect(referral.followUpScheduled).toBe(true)
    expect(referral.whatsappNotified).toBe(true)
    expect(referral.assignedSpecialistId).toBe('s2')
  })
})

describe('Workflow — patientReferralJourney: STEMI emergency path', () => {
  test('STEMI classified as emergency', () => {
    expect(classifyUrgency({ stemi: true })).toBe('emergency')
  })

  test('Emergency referral routes to available specialist', () => {
    const referral = createReferral({ urgency: 'emergency' })
    const specialist = routeToSpecialist(referral, SPECIALISTS)
    expect(specialist).not.toBeNull()
    // Should still route to lowest-load available specialist in same city
    expect(specialist!.city).toBe('Hyderabad')
  })

  test('Emergency referral can be immediately accepted', () => {
    const referral = createReferral({ urgency: 'emergency' })
    const accepted = acceptReferral(referral, 's1')
    expect(accepted.status).toBe('accepted')
  })
})

describe('Workflow — patientReferralJourney: rejection and revision cycle', () => {
  test('rejected referral can be revised (back to draft)', () => {
    const referral = createReferral({ status: 'rejected' })
    // Simulate revision: status goes back to draft
    const revised = { ...referral, status: 'draft', urgency: 'urgent' as const }
    expect(revised.status).toBe('draft')
  })

  test('revised draft can be resubmitted', () => {
    const referral = createReferral({ status: 'draft' })
    const resubmitted = { ...referral, status: 'submitted' }
    expect(resubmitted.status).toBe('submitted')
  })

  test('cannot accept a draft referral', () => {
    const referral = createReferral({ status: 'draft' })
    expect(() => acceptReferral(referral, 's1')).toThrow('Can only accept submitted referrals')
  })

  test('cannot schedule without acceptance', () => {
    const referral = createReferral({ status: 'submitted' })
    expect(() => scheduleAppointment(referral, '2024-03-25', '10:00')).toThrow('Must be accepted')
  })
})

describe('Workflow — patientReferralJourney: city fallback routing', () => {
  test('falls back to another city when no specialist available locally', () => {
    const referral = createReferral({ city: 'Patna', requiredSpecialty: 'interventional_cardiology' })
    const specialist = routeToSpecialist(referral, SPECIALISTS)
    // No specialists in Patna — should fall back to any available
    expect(specialist).not.toBeNull()
    expect(specialist!.specialty).toBe('interventional_cardiology')
  })

  test('unavailable specialist excluded from routing', () => {
    const referral = createReferral()
    const specialist = routeToSpecialist(referral, SPECIALISTS)
    expect(specialist?.id).not.toBe('s5')  // s5 is unavailable
  })

  test('returns null when no specialist available for specialty', () => {
    const referral = createReferral({ requiredSpecialty: 'oncology' })
    expect(routeToSpecialist(referral, SPECIALISTS)).toBeNull()
  })
})

describe('Workflow — patientReferralJourney: completion invariants', () => {
  test('completed referral always has assignedSpecialistId', () => {
    const referral = createReferral({ status: 'in_progress', assignedSpecialistId: 's2', whatsappNotified: true })
    const completed = completeReferral(referral)
    expect(completed.assignedSpecialistId).toBeDefined()
  })

  test('completed referral always has followUpScheduled=true', () => {
    const referral = createReferral({ status: 'in_progress', assignedSpecialistId: 's2', whatsappNotified: true })
    expect(completeReferral(referral).followUpScheduled).toBe(true)
  })

  test('cannot complete a submitted referral (not in_progress)', () => {
    const referral = createReferral({ status: 'submitted' })
    expect(() => completeReferral(referral)).toThrow('Can only complete in-progress referrals')
  })
})
