import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  processPatientMessage,
  advanceBookingFlow,
  type ChatMessage,
  type ChatbotConfig,
  type BookingState,
} from '@/lib/ai/chatbot-engine'

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(request: NextRequest) {
  try {
    const { specialistId, sessionId, message, bookingState } = await request.json()

    if (!specialistId || !message?.trim()) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Rate limiting: max 20 messages per session per hour
    if (sessionId) {
      const { count } = await serviceSupabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .gte('created_at', new Date(Date.now() - 3600000).toISOString())

      if ((count ?? 0) > 40) {
        return NextResponse.json({
          response: 'You have sent too many messages. Please contact the clinic directly.',
          intent: 'rate_limited',
          sessionId,
        })
      }
    }

    // Fetch chatbot config
    const { data: config } = await serviceSupabase
      .from('chatbot_configs')
      .select(`
        *,
        specialists ( id, name, specialty ),
        chatbot_faqs ( question, answer )
      `)
      .eq('specialist_id', specialistId)
      .single()

    if (!config) {
      return NextResponse.json({
        response: 'This chat is not currently available.',
        intent: 'unavailable',
        sessionId,
      })
    }

    // Find or create web session
    let activeSessionId = sessionId
    if (!activeSessionId) {
      const { data: newSession } = await serviceSupabase
        .from('chat_sessions')
        .insert({
          specialist_id: specialistId,
          channel: 'web_widget',
        })
        .select('id')
        .single()

      activeSessionId = newSession?.id
    }

    // Fetch history
    const { data: history } = await serviceSupabase
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', activeSessionId)
      .order('created_at', { ascending: false })
      .limit(10)

    const conversationHistory: ChatMessage[] = (history || [])
      .reverse()
      .map(m => ({ role: m.role as 'patient' | 'assistant', content: m.content }))

    // Save incoming message
    await serviceSupabase.from('chat_messages').insert({
      session_id:    activeSessionId,
      specialist_id: specialistId,
      role:          'patient',
      content:       message,
    })

    const chatConfig: ChatbotConfig = {
      specialistId,
      specialistName:      config.specialists?.name || '',
      specialistSpecialty: config.specialists?.specialty || '',
      clinicName:          config.clinic_name,
      address:             config.address,
      timings:             config.timings,
      feeConsultation:     config.fee_consultation,
      procedures:          config.procedures,
      languages:           config.languages,
      escalationHours:     config.escalation_hours,
      bookingEnabled:      config.booking_enabled,
      faqs:                config.chatbot_faqs || [],
    }

    let responseText: string
    let intent = 'general'
    let newBookingState: BookingState | null = bookingState || null

    // Handle booking flow
    if (newBookingState && newBookingState.step !== 'complete') {
      const availableSlots = await getAvailableSlotsForDate(specialistId, message)
      const result = advanceBookingFlow(newBookingState, message, availableSlots)
      responseText   = result.prompt
      newBookingState = result.state

      if (result.isComplete && result.state.selectedSlotId) {
        await serviceSupabase.rpc('book_appointment_slot', {
          p_slot_id:        result.state.selectedSlotId,
          p_specialist_id:  specialistId,
          p_patient_name:   result.state.patientName,
          p_patient_mobile: 'web_widget',
          p_reason:         result.state.reason,
          p_channel:        'web_widget',
          p_session_id:     activeSessionId,
        })

        await serviceSupabase
          .from('chat_sessions')
          .update({ outcome: 'booked' })
          .eq('id', activeSessionId)

        newBookingState = null
        intent = 'appointment_booked'
      }
    } else {
      const aiResponse = await processPatientMessage(
        message,
        conversationHistory,
        chatConfig
      )

      responseText = aiResponse.content
      intent       = aiResponse.intent

      if (aiResponse.requiresBooking && chatConfig.bookingEnabled) {
        newBookingState = { step: 'name' }
        responseText = `I'd be happy to help you book an appointment. May I have your name please?`
        intent = 'appointment_booking_started'
      }

      if (aiResponse.isEscalation) {
        await serviceSupabase
          .from('chat_sessions')
          .update({ escalated: true })
          .eq('id', activeSessionId)
      }
    }

    // Save assistant response
    await serviceSupabase.from('chat_messages').insert({
      session_id:    activeSessionId,
      specialist_id: specialistId,
      role:          'assistant',
      content:       responseText,
      intent,
    })

    await serviceSupabase
      .from('chat_sessions')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', activeSessionId)

    return NextResponse.json({
      response:     responseText,
      intent,
      sessionId:    activeSessionId,
      bookingState: newBookingState,
    })
  } catch (error) {
    console.error('[Chat API] Error:', error)
    return NextResponse.json({
      response: 'I\'m having trouble right now. Please try again.',
      intent:   'error',
    })
  }
}

async function getAvailableSlotsForDate(
  specialistId: string,
  dateHint: string
): Promise<{ id: string; date: string; time: string }[]> {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const targetDate = tomorrow.toISOString().split('T')[0]

  const { data: slots } = await serviceSupabase
    .from('appointment_slots')
    .select('id, slot_date, slot_time')
    .eq('specialist_id', specialistId)
    .gte('slot_date', targetDate)
    .eq('is_blocked', false)
    .order('slot_date')
    .order('slot_time')
    .limit(8)

  return (slots || []).map(s => ({
    id: s.id, date: s.slot_date, time: s.slot_time,
  }))
}
