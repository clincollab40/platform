import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'
import {
  processPatientMessage,
  advanceBookingFlow,
  formatWhatsAppResponse,
  detectEmergency,
  type BookingState,
  type ChatMessage,
  type ChatbotConfig,
} from '@/lib/ai/chatbot-engine'

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

// ── Verify Meta webhook signature ──────────────────
function verifyWebhookSignature(body: string, signature: string): boolean {
  const secret = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || ''
  const expected = createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex')
  return `sha256=${expected}` === signature
}

// ── GET: Meta webhook verification challenge ───────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }

  return new NextResponse('Forbidden', { status: 403 })
}

// ── POST: Incoming WhatsApp message ───────────────
export async function POST(request: NextRequest) {
  const bodyText = await request.text()

  // Verify signature
  const signature = request.headers.get('x-hub-signature-256') || ''
  if (process.env.NODE_ENV === 'production' && !verifyWebhookSignature(bodyText, signature)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Acknowledge webhook immediately (Meta requires <5s)
  const responsePromise = processWebhookPayload(bodyText)

  // Return 200 immediately — process async
  responsePromise.catch(err => console.error('[Webhook] Processing error:', err))

  return new NextResponse('OK', { status: 200 })
}

// ── Async webhook processing ──────────────────────
async function processWebhookPayload(bodyText: string) {
  let payload: any
  try {
    payload = JSON.parse(bodyText)
  } catch {
    console.error('[Webhook] Invalid JSON payload')
    return
  }

  const entry   = payload?.entry?.[0]
  const change  = entry?.changes?.[0]
  const value   = change?.value

  if (change?.field !== 'messages') return

  const message = value?.messages?.[0]
  if (!message || message.type !== 'text') return

  const fromNumber  = message.from         // Patient's WhatsApp number
  const messageText = message.text?.body   // Patient's message
  const waMessageId = message.id
  const contactName = value?.contacts?.[0]?.profile?.name

  if (!fromNumber || !messageText) return

  // Find specialist by their WhatsApp business number
  const phoneNumberId = value?.metadata?.phone_number_id
  const { data: config } = await serviceSupabase
    .from('chatbot_configs')
    .select(`
      *,
      specialists ( id, name, specialty, whatsapp_number ),
      chatbot_faqs ( question, answer )
    `)
    .eq('whatsapp_number', phoneNumberId)
    .eq('is_live', true)
    .single()

  if (!config || !config.specialists) {
    console.log('[Webhook] No active config for phone_number_id:', phoneNumberId)
    return
  }

  const specialistId = config.specialists.id

  // Find or create session (within 24h window)
  const { data: existingSession } = await serviceSupabase
    .from('chat_sessions')
    .select('*')
    .eq('specialist_id', specialistId)
    .eq('patient_mobile', fromNumber)
    .gte('last_message_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .order('last_message_at', { ascending: false })
    .limit(1)
    .single()

  let sessionId: string
  let bookingState: BookingState | null = null

  if (existingSession) {
    sessionId = existingSession.id
    // Restore booking state if in progress
    if (existingSession.intent_summary?.startsWith('booking:')) {
      try {
        bookingState = JSON.parse(existingSession.intent_summary.slice(8))
      } catch { bookingState = null }
    }
  } else {
    const { data: newSession } = await serviceSupabase
      .from('chat_sessions')
      .insert({
        specialist_id:   specialistId,
        channel:         'whatsapp',
        patient_mobile:  fromNumber,
        wa_contact_name: contactName,
      })
      .select('id')
      .single()

    if (!newSession) return
    sessionId = newSession.id
  }

  // Save incoming message
  await serviceSupabase.from('chat_messages').insert({
    session_id:   sessionId,
    specialist_id:specialistId,
    role:         'patient',
    content:      messageText,
    wa_message_id:waMessageId,
  })

  // Fetch conversation history (last 10 messages)
  const { data: history } = await serviceSupabase
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(10)

  const conversationHistory: ChatMessage[] = (history || [])
    .reverse()
    .map(m => ({ role: m.role as 'patient' | 'assistant', content: m.content }))

  // Build chatbot config
  const chatConfig: ChatbotConfig = {
    specialistId,
    specialistName:      config.specialists.name,
    specialistSpecialty: config.specialists.specialty,
    clinicName:          config.clinic_name,
    address:             config.address,
    googleMapsUrl:       config.google_maps_url,
    timings:             config.timings,
    feeConsultation:     config.fee_consultation,
    feeFollowup:         config.fee_followup,
    procedures:          config.procedures,
    languages:           config.languages,
    escalationMobile:    config.escalation_mobile,
    escalationHours:     config.escalation_hours,
    bookingEnabled:      config.booking_enabled,
    faqs:                config.chatbot_faqs || [],
  }

  let responseText: string
  let intent = 'general'
  let confidence = 0.8
  let isEscalation = false

  // Handle booking flow
  if (bookingState && bookingState.step !== 'complete') {
    // Fetch available slots for date context
    const slots = await getAvailableSlots(specialistId, messageText)

    const { state: newState, prompt, isComplete } = advanceBookingFlow(
      bookingState, messageText, slots
    )

    responseText = prompt

    if (isComplete && newState.selectedSlotId) {
      // Execute the booking
      const { data: booking } = await serviceSupabase.rpc('book_appointment_slot', {
        p_slot_id:        newState.selectedSlotId,
        p_specialist_id:  specialistId,
        p_patient_name:   newState.patientName,
        p_patient_mobile: fromNumber,
        p_reason:         newState.reason,
        p_channel:        'whatsapp',
        p_session_id:     sessionId,
      })

      const bookingResult = booking?.[0]
      if (bookingResult?.success) {
        intent = 'appointment_booked'
        await serviceSupabase
          .from('chat_sessions')
          .update({
            outcome:        'booked',
            appointment_id: bookingResult.appointment_id,
            intent_summary: null,
          })
          .eq('id', sessionId)

        // Notify specialist
        await notifySpecialistNewBooking(specialistId, newState)
      } else {
        responseText = `I'm sorry, that slot is no longer available. ${prompt} Please choose another slot.`
      }
    } else {
      // Save booking state to session
      await serviceSupabase
        .from('chat_sessions')
        .update({ intent_summary: `booking:${JSON.stringify(newState)}` })
        .eq('id', sessionId)
    }
  } else {
    // Regular chatbot processing
    const aiResponse = await processPatientMessage(
      messageText,
      conversationHistory,
      chatConfig
    )

    responseText  = aiResponse.content
    intent        = aiResponse.intent
    confidence    = aiResponse.confidence
    isEscalation  = aiResponse.isEscalation

    // If booking intent detected, start booking flow
    if (aiResponse.requiresBooking && chatConfig.bookingEnabled) {
      const newBookingState: BookingState = { step: 'name' }
      await serviceSupabase
        .from('chat_sessions')
        .update({ intent_summary: `booking:${JSON.stringify(newBookingState)}` })
        .eq('id', sessionId)

      responseText = `I'd be happy to help you book an appointment with Dr. ${chatConfig.specialistName}. May I have your name please?`
      intent = 'appointment_booking_started'
    }

    // Handle escalation
    if (isEscalation && chatConfig.escalationMobile) {
      await triggerEscalation(sessionId, specialistId, chatConfig, fromNumber, messageText)
      await serviceSupabase
        .from('chat_sessions')
        .update({ escalated: true, outcome: 'escalated' })
        .eq('id', sessionId)
    }

    if (aiResponse.isEmergency) {
      await serviceSupabase
        .from('chat_sessions')
        .update({ outcome: 'emergency' })
        .eq('id', sessionId)
    }
  }

  // Send WhatsApp response
  await sendWhatsAppReply(fromNumber, formatWhatsAppResponse(responseText))

  // Save assistant message
  await serviceSupabase.from('chat_messages').insert({
    session_id:   sessionId,
    specialist_id:specialistId,
    role:         'assistant',
    content:      responseText,
    intent,
    confidence,
  })

  // Update session
  await serviceSupabase
    .from('chat_sessions')
    .update({
      last_message_at: new Date().toISOString(),
      message_count:   (existingSession?.message_count ?? 0) + 2,
      patient_name:    existingSession?.patient_name || contactName || null,
    })
    .eq('id', sessionId)
}

// ── Get available slots for a date ────────────────
async function getAvailableSlots(
  specialistId: string,
  dateHint: string
): Promise<{ id: string; date: string; time: string }[]> {
  // Parse date from hint (simplified — enhance with chrono-node in production)
  const targetDate = parseDateHint(dateHint)
  if (!targetDate) return []

  const { data: slots } = await serviceSupabase
    .from('appointment_slots')
    .select('id, slot_date, slot_time, booked_count, max_capacity')
    .eq('specialist_id', specialistId)
    .eq('slot_date', targetDate)
    .eq('is_blocked', false)
    .lt('booked_count', 1) // Available slots only
    .order('slot_time')
    .limit(10)

  return (slots || []).map(s => ({
    id:   s.id,
    date: s.slot_date,
    time: s.slot_time,
  }))
}

// ── Simplified date parser ─────────────────────────
function parseDateHint(hint: string): string | null {
  const lower = hint.toLowerCase()
  const today = new Date()

  if (lower.includes('today'))     return formatDate(today)
  if (lower.includes('tomorrow')) {
    const t = new Date(today); t.setDate(t.getDate() + 1)
    return formatDate(t)
  }

  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  for (let i = 0; i < days.length; i++) {
    if (lower.includes(days[i])) {
      const target = new Date(today)
      const diff = (i - today.getDay() + 7) % 7 || 7
      target.setDate(target.getDate() + diff)
      return formatDate(target)
    }
  }

  // Try to parse explicit date
  const match = hint.match(/(\d{1,2})[\/\-\s](\w+)/)
  if (match) {
    const parsed = new Date(`${match[2]} ${match[1]} ${today.getFullYear()}`)
    if (!isNaN(parsed.getTime())) return formatDate(parsed)
  }

  return null
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

// ── Send WhatsApp reply ─────────────────────────────
async function sendWhatsAppReply(to: string, body: string) {
  const token         = process.env.WHATSAPP_API_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID

  if (!token || !phoneNumberId) {
    console.log('[WhatsApp] Not configured — would send to', to, ':', body)
    return
  }

  await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    }),
  })
}

// ── Notify specialist of new booking ──────────────
async function notifySpecialistNewBooking(
  specialistId: string,
  state: BookingState
) {
  const { data: spec } = await serviceSupabase
    .from('specialists')
    .select('whatsapp_number, name')
    .eq('id', specialistId)
    .single()

  if (!spec?.whatsapp_number) return

  const msg = `ClinCollab — New appointment\n\nDr. ${spec.name},\n\nNew appointment booked:\n👤 ${state.patientName}\n📅 ${state.selectedSlotDisplay}\n📋 ${state.reason}\n\nView in dashboard: ${process.env.NEXT_PUBLIC_APP_URL}/appointments`

  await sendWhatsAppReply(spec.whatsapp_number, msg)
}

// ── Escalation trigger ─────────────────────────────
async function triggerEscalation(
  sessionId: string,
  specialistId: string,
  config: ChatbotConfig,
  patientMobile: string,
  lastMessage: string
) {
  if (!config.escalationMobile) return

  const msg = `ClinCollab — Patient query escalated\n\nA patient query needs your attention:\n\n"${lastMessage.slice(0, 200)}"\n\nPatient: ${patientMobile}\n\nView conversation: ${process.env.NEXT_PUBLIC_APP_URL}/chatbot/sessions/${sessionId}`

  await sendWhatsAppReply(config.escalationMobile, msg)
}
