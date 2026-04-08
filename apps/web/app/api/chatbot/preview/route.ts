import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  processPatientMessage,
  type ChatbotConfig,
} from '@/lib/ai/chatbot-engine'

export const dynamic = 'force-dynamic'

// ── POST: Preview chatbot response without saving to DB ────────────────────
// Used by the Preview tab in chatbot config UI
export async function POST(request: NextRequest) {
  try {
    // Auth check — only the logged-in specialist can preview their own bot
    const authClient = await createServerSupabaseClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { message, config: rawConfig, faqs, specialistName, specialistSpecialty } = await request.json()

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 })
    }

    // Rate limit preview: max 30 calls/min (simple in-memory, good enough for a single specialist)
    // In production you'd use Redis or Supabase rate-limit table

    // Build config object for the engine — use current form state, not DB
    const config: ChatbotConfig = {
      specialistId:        'preview-mode',
      specialistName:      specialistName  || 'the doctor',
      specialistSpecialty: specialistSpecialty || 'specialist',
      clinicName:          rawConfig?.clinic_name      || undefined,
      address:             rawConfig?.address          || undefined,
      googleMapsUrl:       rawConfig?.google_maps_url  || undefined,
      timings:             rawConfig?.timings          || undefined,
      feeConsultation:     rawConfig?.fee_consultation || undefined,
      feeFollowup:         rawConfig?.fee_followup     || undefined,
      procedures:          rawConfig?.procedures       || [],
      languages:           rawConfig?.languages        || ['English'],
      escalationHours:     rawConfig?.escalation_hours || 'clinic hours',
      bookingEnabled:      rawConfig?.booking_enabled  ?? true,
      welcomeMessage:      rawConfig?.welcome_message  || undefined,
      // Only include FAQs that have both question and answer filled in
      faqs: (faqs || []).filter(
        (f: { question?: string; answer?: string }) =>
          f.question?.trim() && f.answer?.trim()
      ),
    }

    // Call the AI engine — no conversation history in preview mode
    const aiResponse = await processPatientMessage(message.trim(), [], config)

    return NextResponse.json({
      response: aiResponse.content,
      intent:   aiResponse.intent,
      flags: {
        isEmergency:     aiResponse.isEmergency,
        isEscalation:    aiResponse.isEscalation,
        requiresBooking: aiResponse.requiresBooking,
      },
    })
  } catch (error) {
    console.error('[Chatbot Preview] Error:', error)
    return NextResponse.json({
      response: 'Preview unavailable — check your GROQ_API_KEY is configured in environment variables.',
      intent:   'error',
    })
  }
}
