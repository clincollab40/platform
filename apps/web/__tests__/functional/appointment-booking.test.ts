/**
 * Functional Tests — M4 Appointment Booking Flow
 *
 * Tests the complete appointment booking workflow:
 *   Patient → WhatsApp bot → slot selection → confirmation → reminder
 *
 * All logic is inlined (pure functions) — no live DB or API required.
 */

// ── Slot availability engine ──────────────────────────────────────
describe('Functional — appointmentSlotAvailability', () => {
  interface Slot {
    id: string
    date: string          // YYYY-MM-DD
    start_time: string    // HH:MM
    end_time: string
    is_available: boolean
    booked_by: string | null
  }

  function getAvailableSlots(slots: Slot[], date: string): Slot[] {
    return slots.filter(s => s.date === date && s.is_available && !s.booked_by)
  }

  function bookSlot(slots: Slot[], slotId: string, patientId: string): Slot[] {
    return slots.map(s =>
      s.id === slotId ? { ...s, is_available: false, booked_by: patientId } : s
    )
  }

  const today = '2024-03-20'
  const SLOTS: Slot[] = [
    { id: 'slot-1', date: today, start_time: '09:00', end_time: '09:30', is_available: true,  booked_by: null },
    { id: 'slot-2', date: today, start_time: '09:30', end_time: '10:00', is_available: true,  booked_by: null },
    { id: 'slot-3', date: today, start_time: '10:00', end_time: '10:30', is_available: false, booked_by: null },
    { id: 'slot-4', date: today, start_time: '11:00', end_time: '11:30', is_available: true,  booked_by: 'patient-99' },
    { id: 'slot-5', date: '2024-03-21', start_time: '09:00', end_time: '09:30', is_available: true, booked_by: null },
  ]

  test('returns only available slots for a given date',   () => {
    const available = getAvailableSlots(SLOTS, today)
    expect(available).toHaveLength(2)
    expect(available.map(s => s.id)).toEqual(['slot-1', 'slot-2'])
  })

  test('returns empty if no slots for date',              () => {
    expect(getAvailableSlots(SLOTS, '2024-04-01')).toHaveLength(0)
  })

  test('excludes already-booked slots',                   () => {
    const available = getAvailableSlots(SLOTS, today)
    expect(available.find(s => s.id === 'slot-4')).toBeUndefined()
  })

  test('booking a slot marks it unavailable',             () => {
    const updated = bookSlot(SLOTS, 'slot-1', 'patient-001')
    const slot1 = updated.find(s => s.id === 'slot-1')!
    expect(slot1.is_available).toBe(false)
    expect(slot1.booked_by).toBe('patient-001')
  })

  test('booking does not affect other slots',             () => {
    const updated = bookSlot(SLOTS, 'slot-1', 'patient-001')
    const slot2 = updated.find(s => s.id === 'slot-2')!
    expect(slot2.is_available).toBe(true)
    expect(slot2.booked_by).toBeNull()
  })

  test('double-booking same slot — second patient cannot get it', () => {
    let updated = bookSlot(SLOTS, 'slot-1', 'patient-001')
    const available = getAvailableSlots(updated, today)
    expect(available.find(s => s.id === 'slot-1')).toBeUndefined()
  })
})

// ── WhatsApp booking conversation state machine ───────────────────
describe('Functional — whatsappBookingConversationFlow', () => {
  type BotState =
    | 'greeting'
    | 'collecting_name'
    | 'collecting_phone'
    | 'showing_slots'
    | 'confirming_slot'
    | 'confirmed'
    | 'cancelled'

  interface Session {
    state: BotState
    name?: string
    phone?: string
    selectedSlot?: string
  }

  function processMessage(session: Session, message: string): Session {
    const m = message.trim().toLowerCase()

    switch (session.state) {
      case 'greeting':
        return { ...session, state: 'collecting_name' }

      case 'collecting_name':
        if (m.length < 2) return session  // ignore too-short input
        return { ...session, name: message.trim(), state: 'collecting_phone' }

      case 'collecting_phone':
        if (!/^\d{10}$/.test(m)) return session  // invalid phone
        return { ...session, phone: m, state: 'showing_slots' }

      case 'showing_slots':
        if (/^[1-5]$/.test(m)) {
          return { ...session, selectedSlot: `slot-${m}`, state: 'confirming_slot' }
        }
        return session

      case 'confirming_slot':
        if (['yes', 'confirm', 'ok', 'y'].includes(m)) return { ...session, state: 'confirmed' }
        if (['no', 'cancel', 'n'].includes(m))         return { ...session, state: 'cancelled' }
        return session

      default:
        return session
    }
  }

  test('greeting triggers name collection',         () => {
    const s = processMessage({ state: 'greeting' }, 'Hi')
    expect(s.state).toBe('collecting_name')
  })

  test('valid name advances to phone collection',   () => {
    const s = processMessage({ state: 'collecting_name' }, 'Ramesh Kumar')
    expect(s.state).toBe('collecting_phone')
    expect(s.name).toBe('Ramesh Kumar')
  })

  test('single char name ignored (too short)',      () => {
    const s = processMessage({ state: 'collecting_name' }, 'R')
    expect(s.state).toBe('collecting_name')
  })

  test('valid 10-digit phone advances to slots',    () => {
    const s = processMessage({ state: 'collecting_phone' }, '9876543210')
    expect(s.state).toBe('showing_slots')
    expect(s.phone).toBe('9876543210')
  })

  test('invalid phone ignored (8 digits)',          () => {
    const s = processMessage({ state: 'collecting_phone' }, '98765432')
    expect(s.state).toBe('collecting_phone')
  })

  test('slot selection 1–5 valid',                 () => {
    const s = processMessage({ state: 'showing_slots' }, '2')
    expect(s.state).toBe('confirming_slot')
    expect(s.selectedSlot).toBe('slot-2')
  })

  test('slot selection 0 ignored (out of range)',   () => {
    const s = processMessage({ state: 'showing_slots' }, '0')
    expect(s.state).toBe('showing_slots')
  })

  test('"yes" confirms booking',                   () => {
    const s = processMessage({ state: 'confirming_slot', selectedSlot: 'slot-2' }, 'yes')
    expect(s.state).toBe('confirmed')
  })

  test('"no" cancels booking',                     () => {
    const s = processMessage({ state: 'confirming_slot', selectedSlot: 'slot-2' }, 'no')
    expect(s.state).toBe('cancelled')
  })

  test('full booking flow from greeting to confirmed', () => {
    let s: Session = { state: 'greeting' }
    s = processMessage(s, 'Hello')
    s = processMessage(s, 'Ramesh Kumar')
    s = processMessage(s, '9876543210')
    s = processMessage(s, '1')
    s = processMessage(s, 'yes')
    expect(s.state).toBe('confirmed')
    expect(s.name).toBe('Ramesh Kumar')
    expect(s.phone).toBe('9876543210')
    expect(s.selectedSlot).toBe('slot-1')
  })
})

// ── Appointment reminder scheduling ──────────────────────────────
describe('Functional — appointmentReminderScheduling', () => {
  interface ReminderSchedule { sendAt: string; type: 'day_before' | 'hour_before' | 'post_appointment' }

  function buildReminderSchedule(appointmentDatetime: string): ReminderSchedule[] {
    const appt = new Date(appointmentDatetime)
    const dayBefore = new Date(appt); dayBefore.setDate(appt.getDate() - 1)
    const hourBefore = new Date(appt); hourBefore.setHours(appt.getHours() - 1)
    const postAppt = new Date(appt); postAppt.setDate(appt.getDate() + 1)

    return [
      { sendAt: dayBefore.toISOString(),  type: 'day_before' },
      { sendAt: hourBefore.toISOString(), type: 'hour_before' },
      { sendAt: postAppt.toISOString(),   type: 'post_appointment' },
    ]
  }

  test('3 reminders are scheduled per appointment', () => {
    const schedule = buildReminderSchedule('2024-03-20T09:00:00.000Z')
    expect(schedule).toHaveLength(3)
  })

  test('day-before reminder is 24h before',         () => {
    const schedule = buildReminderSchedule('2024-03-20T09:00:00.000Z')
    const dayBefore = schedule.find(r => r.type === 'day_before')!
    const diff = new Date('2024-03-20T09:00:00.000Z').getTime() - new Date(dayBefore.sendAt).getTime()
    expect(diff).toBe(24 * 60 * 60 * 1000)
  })

  test('hour-before reminder is 1h before',         () => {
    const schedule = buildReminderSchedule('2024-03-20T09:00:00.000Z')
    const hourBefore = schedule.find(r => r.type === 'hour_before')!
    const diff = new Date('2024-03-20T09:00:00.000Z').getTime() - new Date(hourBefore.sendAt).getTime()
    expect(diff).toBe(60 * 60 * 1000)
  })

  test('post-appointment is next day',              () => {
    const schedule = buildReminderSchedule('2024-03-20T09:00:00.000Z')
    const post = schedule.find(r => r.type === 'post_appointment')!
    const diff = new Date(post.sendAt).getTime() - new Date('2024-03-20T09:00:00.000Z').getTime()
    expect(diff).toBe(24 * 60 * 60 * 1000)
  })

  test('reminder types are all distinct',           () => {
    const schedule = buildReminderSchedule('2024-03-20T09:00:00.000Z')
    const types = schedule.map(r => r.type)
    expect(new Set(types).size).toBe(3)
  })
})
