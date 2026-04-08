/**
 * ClinCollab Chatbot AI Engine
 * Safety-first, clinical-grade patient assistant
 *
 * Architecture:
 * 1. Emergency keyword check (pre-LLM, rule-based, <50ms)
 * 2. Clinical advice detection (pre-LLM)
 * 3. Input sanitisation
 * 4. LLM call (Groq, Llama 3.3 70B)
 * 5. Response validation
 * 6. Structured output parsing
 */

import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

// ── Safety constants ────────────────────────────────
const EMERGENCY_KEYWORDS = [
  // English
  'chest pain', 'chest tightness', 'heart attack', 'cardiac arrest',
  'can\'t breathe', 'cannot breathe', 'difficulty breathing', 'breathless',
  'collapsed', 'unconscious', 'not responding', 'seizure', 'stroke',
  'heavy bleeding', 'severe pain', 'emergency', 'ambulance',
  // Hindi (हिंदी)
  'सीने में दर्द', 'सांस नहीं', 'दिल का दौरा', 'बेहोश', 'एम्बुलेंस', 'आपातकाल', 'भारी रक्तस्राव',
  // Telugu (తెలుగు)
  'గుండె నొప్పి', 'శ్వాస తీసుకోలేను', 'అత్యవసర', 'అంబులెన్స్', 'స్పృహ కోల్పోయారు',
  // Kannada (ಕನ್ನಡ)
  'ಎದೆ ನೋವು', 'ಉಸಿರಾಟ ತೊಂದರೆ', 'ತುರ್ತು', 'ಆಂಬ್ಯುಲೆನ್ಸ್', 'ಎದೆ ಬಿಗಿ', 'ಎದೆ ಒತ್ತಡ',
  // Marathi (मराठी)
  'छातीत दुखणे', 'श्वास घेणे कठीण', 'तातडीचे', 'रुग्णवाहिका', 'हृदयविकाराचा झटका', 'बेशुद्ध',
  // Bengali (বাংলা)
  'বুকে ব্যথা', 'শ্বাস নিতে পারছি না', 'জরুরি', 'অ্যাম্বুলেন্স', 'হার্ট অ্যাটাক', 'অজ্ঞান',
]

const CLINICAL_ADVICE_KEYWORDS = [
  'is my ecg normal', 'is my report normal', 'what is my diagnosis',
  'do i have', 'should i take', 'is this medicine', 'my symptoms',
  'what does this mean', 'is it serious', 'should i be worried',
  'interpret my', 'what is wrong with', 'am i ok',
]

const PROFANITY_PATTERN = /\b(spam|abuse)\b/i // Minimal — expand as needed

// ── Type definitions ────────────────────────────────
export interface ChatbotConfig {
  specialistId: string
  specialistName: string
  specialistSpecialty: string
  clinicName?: string
  address?: string
  googleMapsUrl?: string
  timings?: Record<string, { open: string | null; close: string | null; closed: boolean }>
  feeConsultation?: number
  feeFollowup?: number
  procedures?: string[]
  languages?: string[]
  escalationMobile?: string
  escalationHours?: string
  bookingEnabled?: boolean
  faqs?: { question: string; answer: string }[]
  welcomeMessage?: string
}

export interface ChatMessage {
  role: 'patient' | 'assistant' | 'system'
  content: string
}

export interface ChatbotResponse {
  content: string
  intent: string
  confidence: number
  requiresBooking: boolean
  isEmergency: boolean
  isEscalation: boolean
  suggestWhatsApp: boolean
}

// ── Emergency detection (pre-LLM) ──────────────────
export function detectEmergency(input: string): boolean {
  const lower = input.toLowerCase()
  return EMERGENCY_KEYWORDS.some(kw => lower.includes(kw))
}

// ── Clinical advice detection (pre-LLM) ────────────
export function detectClinicalAdviceRequest(input: string): boolean {
  const lower = input.toLowerCase()
  return CLINICAL_ADVICE_KEYWORDS.some(kw => lower.includes(kw))
}

// ── Input sanitisation ──────────────────────────────
export function sanitiseInput(input: string): string {
  return input
    .trim()
    .slice(0, 1000) // Hard cap on input length
    .replace(/<[^>]*>/g, '') // Strip any HTML
    .replace(PROFANITY_PATTERN, '[removed]')
}

// ── Build system prompt from specialist config ─────
function buildSystemPrompt(config: ChatbotConfig): string {
  const dayTimings = config.timings
    ? Object.entries(config.timings)
        .map(([day, t]) =>
          t.closed
            ? `${day.charAt(0).toUpperCase() + day.slice(1)}: Closed`
            : `${day.charAt(0).toUpperCase() + day.slice(1)}: ${t.open} – ${t.close}`
        )
        .join(', ')
    : 'Please contact the clinic for timings'

  const faqSection = config.faqs && config.faqs.length > 0
    ? `\n\nFREQUENTLY ASKED QUESTIONS (answer these precisely as written):\n${
        config.faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')
      }`
    : ''

  const procedureSection = config.procedures && config.procedures.length > 0
    ? `\nProcedures performed: ${config.procedures.join(', ')}`
    : ''

  return `You are a patient assistant for Dr. ${config.specialistName}, a ${config.specialistSpecialty.replace(/_/g, ' ')} specialist.

CLINIC INFORMATION:
${config.clinicName ? `Clinic: ${config.clinicName}` : ''}
${config.address ? `Address: ${config.address}` : ''}
Timings: ${dayTimings}
${config.feeConsultation ? `Consultation fee: ₹${config.feeConsultation}` : ''}
${config.feeFollowup ? `Follow-up fee: ₹${config.feeFollowup}` : ''}
${procedureSection}
${faqSection}

YOUR ROLE:
- Help patients with clinic information, appointment booking, and general non-clinical queries
- Be warm, clear, and professional — like a helpful clinic receptionist
- Keep responses concise — 2-4 sentences maximum for most answers
- For appointment booking, collect: patient name, mobile number, reason for visit, preferred date

LANGUAGE RULES (critical — follow exactly):
- Detect the patient's language from their message and respond in that SAME language
- Supported: English, Hindi (हिंदी), Telugu (తెలుగు), Kannada (ಕನ್ನಡ), Marathi (मराठी), Bengali (বাংলা)
- If patient writes in Hinglish, Tanglish, or any regional-English mix — respond in their regional language
- NEVER ask patients to write in English — always accommodate their language
- NEVER translate their query to English internally — respond directly in detected language
- Common words like "appointment", "doctor", "fees" in an otherwise regional message means respond in that regional language

STRICT RULES — NEVER VIOLATE:
1. NEVER provide medical advice, diagnosis, or interpret test results
2. NEVER suggest or recommend any medication
3. NEVER comment on symptoms or whether they are serious
4. If asked for clinical advice, say: "I can help with clinic information and appointments. For medical questions, please consult Dr. ${config.specialistName} directly. You can book an appointment here."
5. Always recommend calling emergency services (112) for emergencies — never attempt to assess medical emergencies

ESCALATION:
If you cannot answer confidently, say: "Let me connect you with the clinic team for this query. They are available ${config.escalationHours || 'during clinic hours'}."

APPOINTMENT BOOKING:
${config.bookingEnabled ? 'You can help patients book appointments. Once you have their name, mobile, reason, and preferred date, confirm the booking.' : 'Appointment booking is not available via this channel. Direct patients to call the clinic.'}

Today is ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`
}

// ── Main chat function ──────────────────────────────
export async function processPatientMessage(
  userInput: string,
  conversationHistory: ChatMessage[],
  config: ChatbotConfig,
  availableSlots?: { id: string; date: string; time: string }[]
): Promise<ChatbotResponse> {
  const sanitised = sanitiseInput(userInput)

  // 1. Emergency check — pre-LLM, immediate response
  if (detectEmergency(sanitised)) {
    return {
      content: `⚠️ This sounds like a medical emergency. Please call 112 immediately or go to the nearest emergency room.\n\nDo not wait for an appointment — go to emergency now.`,
      intent: 'emergency',
      confidence: 1.0,
      requiresBooking: false,
      isEmergency: true,
      isEscalation: false,
      suggestWhatsApp: false,
    }
  }

  // 2. Clinical advice check — escalate before LLM
  if (detectClinicalAdviceRequest(sanitised)) {
    return {
      content: `I can help with clinic information and appointments, but I'm not able to interpret medical reports or provide clinical advice. Please book an appointment to discuss this with Dr. ${config.specialistName} directly.`,
      intent: 'clinical_advice_escalation',
      confidence: 1.0,
      requiresBooking: false,
      isEmergency: false,
      isEscalation: true,
      suggestWhatsApp: false,
    }
  }

  // 3. Build messages for LLM
  const systemPrompt = buildSystemPrompt(config)
  const slotContext = availableSlots && availableSlots.length > 0
    ? `\n\nAVAILABLE APPOINTMENT SLOTS:\n${
        availableSlots.map((s, i) =>
          `${i + 1}. ${new Date(s.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} at ${s.time}`
        ).join('\n')
      }\nIf patient wants to book, ask them to reply with the slot number.`
    : ''

  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt + slotContext },
    ...conversationHistory.slice(-10).map(m => ({
      role: m.role === 'patient' ? 'user' as const : 'assistant' as const,
      content: m.content,
    })),
    { role: 'user', content: sanitised },
  ]

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    })

    const raw = completion.choices[0]?.message?.content || '{}'
    let parsed: {
      response?: string
      intent?: string
      confidence?: number
      requires_booking?: boolean
      is_escalation?: boolean
    } = {}

    try {
      parsed = JSON.parse(raw)
    } catch {
      // Fallback if JSON parsing fails
      parsed = {
        response: raw,
        intent: 'general',
        confidence: 0.8,
        requires_booking: false,
        is_escalation: false,
      }
    }

    const confidence = parsed.confidence ?? 0.8
    const isEscalation = parsed.is_escalation || confidence < 0.5

    return {
      content: parsed.response || 'I\'m not sure about that. Let me connect you with the clinic team.',
      intent: parsed.intent || 'general',
      confidence,
      requiresBooking: parsed.requires_booking || false,
      isEmergency: false,
      isEscalation,
      suggestWhatsApp: false,
    }
  } catch (error) {
    console.error('[Chatbot] LLM error:', error)
    return {
      content: `I'm having trouble right now. Please call the clinic directly or try again in a moment.`,
      intent: 'error',
      confidence: 0,
      requiresBooking: false,
      isEmergency: false,
      isEscalation: true,
      suggestWhatsApp: false,
    }
  }
}

// ── Appointment booking flow ────────────────────────
export interface BookingState {
  step: 'name' | 'mobile' | 'reason' | 'date' | 'slot_selection' | 'confirm' | 'complete'
  patientName?: string
  patientMobile?: string
  reason?: string
  preferredDate?: string
  selectedSlotId?: string
  selectedSlotDisplay?: string
}

export function advanceBookingFlow(
  state: BookingState,
  userInput: string,
  availableSlots: { id: string; date: string; time: string }[]
): { state: BookingState; prompt: string; isComplete: boolean } {
  const input = userInput.trim()

  switch (state.step) {
    case 'name':
      return {
        state: { ...state, step: 'mobile', patientName: input },
        prompt: `Thank you, ${input}. What is your mobile number?`,
        isComplete: false,
      }

    case 'mobile':
      const digits = input.replace(/\D/g, '')
      if (digits.length < 10) {
        return {
          state,
          prompt: 'Please enter a valid 10-digit mobile number.',
          isComplete: false,
        }
      }
      return {
        state: { ...state, step: 'reason', patientMobile: digits },
        prompt: 'Thank you. Briefly, what is the reason for your visit?',
        isComplete: false,
      }

    case 'reason':
      return {
        state: { ...state, step: 'date', reason: input },
        prompt: 'Which date would you prefer? (e.g., "tomorrow", "Monday", or a date like "20 April")',
        isComplete: false,
      }

    case 'date':
      if (availableSlots.length === 0) {
        return {
          state: { ...state, step: 'date' },
          prompt: 'I\'m sorry, there are no available slots for that date. Would you like to try another date?',
          isComplete: false,
        }
      }
      const slotList = availableSlots
        .map((s, i) =>
          `${i + 1}. ${new Date(s.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} at ${s.time}`
        )
        .join('\n')

      return {
        state: { ...state, step: 'slot_selection', preferredDate: input },
        prompt: `Available slots:\n\n${slotList}\n\nReply with the number of your preferred slot.`,
        isComplete: false,
      }

    case 'slot_selection':
      const slotNum = parseInt(input, 10) - 1
      if (isNaN(slotNum) || slotNum < 0 || slotNum >= availableSlots.length) {
        return {
          state,
          prompt: `Please reply with a number between 1 and ${availableSlots.length}.`,
          isComplete: false,
        }
      }
      const slot = availableSlots[slotNum]
      const slotDisplay = `${new Date(slot.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} at ${slot.time}`
      return {
        state: {
          ...state,
          step: 'confirm',
          selectedSlotId: slot.id,
          selectedSlotDisplay: slotDisplay,
        },
        prompt: `Please confirm your appointment:\n\n📅 ${slotDisplay}\n👤 ${state.patientName}\n📋 ${state.reason}\n\nReply "Yes" to confirm or "No" to choose a different slot.`,
        isComplete: false,
      }

    case 'confirm':
      if (input.toLowerCase().startsWith('y')) {
        return {
          state: { ...state, step: 'complete' },
          prompt: `✅ Your appointment is confirmed!\n\n📅 ${state.selectedSlotDisplay}\n👤 ${state.patientName}\n\nYou will receive a reminder 24 hours before. Please bring any previous reports or prescriptions.\n\nFor any changes, contact the clinic directly.`,
          isComplete: true,
        }
      } else {
        return {
          state: { ...state, step: 'date' },
          prompt: 'No problem. Which date would you prefer instead?',
          isComplete: false,
        }
      }

    default:
      return { state, prompt: 'How can I help you?', isComplete: false }
  }
}

// ── Format WhatsApp message ─────────────────────────
export function formatWhatsAppResponse(text: string): string {
  // WhatsApp supports *bold* and _italic_ — keep responses clean
  return text.trim()
}
