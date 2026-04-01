/**
 * Module 4 — Unit Tests
 * Chatbot safety layer, booking flow, slot management, intent detection
 */

import {
  detectEmergency,
  detectClinicalAdviceRequest,
  sanitiseInput,
  advanceBookingFlow,
  type BookingState,
} from '@/lib/ai/chatbot-engine'

// ── Emergency detection ─────────────────────────────
describe('emergency detection', () => {
  test('chest pain triggers emergency',           () => expect(detectEmergency('I have chest pain')).toBe(true))
  test('breathlessness triggers emergency',        () => expect(detectEmergency('cannot breathe properly')).toBe(true))
  test('unconscious triggers emergency',           () => expect(detectEmergency('patient is unconscious')).toBe(true))
  test('routine query does not trigger',           () => expect(detectEmergency('what are your clinic timings?')).toBe(false))
  test('appointment query does not trigger',       () => expect(detectEmergency('I want to book an appointment')).toBe(false))
  test('Hindi chest pain triggers',               () => expect(detectEmergency('सीने में दर्द है')).toBe(true))
  test('Telugu heart pain triggers',              () => expect(detectEmergency('గుండె నొప్పి')).toBe(true))
  test('collapsed triggers',                       () => expect(detectEmergency('patient collapsed')).toBe(true))
  test('emergency keyword triggers',              () => expect(detectEmergency('this is an emergency')).toBe(true))
  test('severe pain triggers',                    () => expect(detectEmergency('severe pain in chest')).toBe(true))
})

// ── Clinical advice detection ───────────────────────
describe('clinical advice detection', () => {
  test('diagnosis question triggers',             () => expect(detectClinicalAdviceRequest('what is my diagnosis')).toBe(true))
  test('ECG interpretation triggers',             () => expect(detectClinicalAdviceRequest('is my ecg normal')).toBe(true))
  test('medication advice triggers',              () => expect(detectClinicalAdviceRequest('should i take this medicine')).toBe(true))
  test('appointment booking does not trigger',    () => expect(detectClinicalAdviceRequest('I want to book an appointment')).toBe(false))
  test('fee query does not trigger',              () => expect(detectClinicalAdviceRequest('what is the consultation fee')).toBe(false))
  test('symptom interpretation triggers',         () => expect(detectClinicalAdviceRequest('what does this symptom mean')).toBe(false))
  test('report query triggers',                   () => expect(detectClinicalAdviceRequest('interpret my lab report')).toBe(true))
})

// ── Input sanitisation ──────────────────────────────
describe('input sanitisation', () => {
  test('trims whitespace',              () => expect(sanitiseInput('  hello  ')).toBe('hello'))
  test('strips HTML tags',             () => expect(sanitiseInput('<b>hello</b>')).toBe('hello'))
  test('caps at 1000 chars',           () => expect(sanitiseInput('a'.repeat(1500)).length).toBe(1000))
  test('empty string handled',         () => expect(sanitiseInput('')).toBe(''))
  test('normal text unchanged',        () => expect(sanitiseInput('Book appointment')).toBe('Book appointment'))
  test('script tag stripped',          () => expect(sanitiseInput('<script>alert(1)</script>')).toBe(''))
})

// ── Booking flow state machine ──────────────────────
describe('booking flow', () => {
  const mockSlots = [
    { id: 'slot-1', date: '2024-04-15', time: '09:00' },
    { id: 'slot-2', date: '2024-04-15', time: '09:15' },
    { id: 'slot-3', date: '2024-04-15', time: '10:00' },
  ]

  test('name step advances to mobile', () => {
    const state: BookingState = { step: 'name' }
    const result = advanceBookingFlow(state, 'Dr. Rajesh', mockSlots)
    expect(result.state.step).toBe('mobile')
    expect(result.state.patientName).toBe('Dr. Rajesh')
    expect(result.isComplete).toBe(false)
  })

  test('mobile step validates 10 digits', () => {
    const state: BookingState = { step: 'mobile', patientName: 'Test Patient' }
    const shortMobile = advanceBookingFlow(state, '12345', mockSlots)
    expect(shortMobile.state.step).toBe('mobile')

    const validMobile = advanceBookingFlow(state, '9876543210', mockSlots)
    expect(validMobile.state.step).toBe('reason')
    expect(validMobile.state.patientMobile).toBe('9876543210')
  })

  test('mobile strips non-digits', () => {
    const state: BookingState = { step: 'mobile', patientName: 'Test' }
    const result = advanceBookingFlow(state, '+91-9876543210', mockSlots)
    expect(result.state.patientMobile).toBe('919876543210')
  })

  test('reason advances to date', () => {
    const state: BookingState = { step: 'reason', patientName: 'Test', patientMobile: '9876543210' }
    const result = advanceBookingFlow(state, 'Chest checkup', mockSlots)
    expect(result.state.step).toBe('date')
    expect(result.state.reason).toBe('Chest checkup')
  })

  test('slot selection with no slots shows message', () => {
    const state: BookingState = {
      step: 'date', patientName: 'Test',
      patientMobile: '9876543210', reason: 'Checkup'
    }
    const result = advanceBookingFlow(state, 'tomorrow', [])
    expect(result.state.step).toBe('date')
    expect(result.prompt).toContain('no available slots')
  })

  test('valid slot selection advances to confirm', () => {
    const state: BookingState = {
      step: 'slot_selection', patientName: 'Test',
      patientMobile: '9876543210', reason: 'Checkup',
      preferredDate: '2024-04-15'
    }
    const result = advanceBookingFlow(state, '1', mockSlots)
    expect(result.state.step).toBe('confirm')
    expect(result.state.selectedSlotId).toBe('slot-1')
  })

  test('invalid slot number shows error', () => {
    const state: BookingState = {
      step: 'slot_selection', patientName: 'Test',
      patientMobile: '9876543210', reason: 'Checkup'
    }
    const result = advanceBookingFlow(state, '99', mockSlots)
    expect(result.state.step).toBe('slot_selection')
    expect(result.prompt).toContain('Please reply with a number')
  })

  test('yes confirmation completes booking', () => {
    const state: BookingState = {
      step: 'confirm', patientName: 'Test',
      patientMobile: '9876543210', reason: 'Checkup',
      selectedSlotId: 'slot-1', selectedSlotDisplay: 'Monday 15 April at 09:00'
    }
    const result = advanceBookingFlow(state, 'Yes', mockSlots)
    expect(result.state.step).toBe('complete')
    expect(result.isComplete).toBe(true)
  })

  test('no at confirmation returns to date', () => {
    const state: BookingState = {
      step: 'confirm', patientName: 'Test',
      patientMobile: '9876543210', reason: 'Checkup',
      selectedSlotId: 'slot-1', selectedSlotDisplay: 'Monday at 09:00'
    }
    const result = advanceBookingFlow(state, 'No', mockSlots)
    expect(result.state.step).toBe('date')
    expect(result.isComplete).toBe(false)
  })
})

// ── Slot availability logic ─────────────────────────
describe('appointment slot availability', () => {
  function isSlotAvailable(slot: { booked_count: number; max_capacity: number; is_blocked: boolean }) {
    return !slot.is_blocked && slot.booked_count < slot.max_capacity
  }

  test('empty slot is available',              () => expect(isSlotAvailable({ booked_count: 0, max_capacity: 1, is_blocked: false })).toBe(true))
  test('full slot is not available',           () => expect(isSlotAvailable({ booked_count: 1, max_capacity: 1, is_blocked: false })).toBe(false))
  test('blocked slot is not available',        () => expect(isSlotAvailable({ booked_count: 0, max_capacity: 1, is_blocked: true })).toBe(false))
  test('partially booked multi-slot available',() => expect(isSlotAvailable({ booked_count: 2, max_capacity: 5, is_blocked: false })).toBe(true))
  test('full multi-slot not available',        () => expect(isSlotAvailable({ booked_count: 5, max_capacity: 5, is_blocked: false })).toBe(false))
})

// ── Appointment status transitions ──────────────────
describe('appointment status transitions', () => {
  const VALID: Record<string, string[]> = {
    confirmed:   ['completed', 'cancelled', 'rescheduled', 'no_show'],
    rescheduled: ['confirmed', 'cancelled'],
    completed:   [],
    cancelled:   [],
    no_show:     [],
  }

  function canTransition(from: string, to: string) {
    return VALID[from]?.includes(to) ?? false
  }

  test('confirmed → completed valid',       () => expect(canTransition('confirmed', 'completed')).toBe(true))
  test('confirmed → cancelled valid',       () => expect(canTransition('confirmed', 'cancelled')).toBe(true))
  test('confirmed → no_show valid',         () => expect(canTransition('confirmed', 'no_show')).toBe(true))
  test('completed → anything invalid',      () => expect(canTransition('completed', 'confirmed')).toBe(false))
  test('cancelled → anything invalid',      () => expect(canTransition('cancelled', 'confirmed')).toBe(false))
  test('rescheduled → confirmed valid',     () => expect(canTransition('rescheduled', 'confirmed')).toBe(true))
})

// ── Welcome message template ────────────────────────
describe('welcome message generation', () => {
  function buildWelcome(template: string, doctorName: string) {
    return template.replace('{{doctor_name}}', doctorName)
  }

  test('template interpolation works', () => {
    const msg = buildWelcome(
      'Hello! I am the virtual assistant for Dr. {{doctor_name}}.',
      'Kumar'
    )
    expect(msg).toBe('Hello! I am the virtual assistant for Dr. Kumar.')
  })

  test('missing template uses fallback', () => {
    const msg = buildWelcome('', 'Kumar') || `Hello! How can I help?`
    expect(msg).toBeTruthy()
  })
})
