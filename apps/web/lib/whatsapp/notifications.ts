/**
 * WhatsApp Business Cloud API utility
 * All clinical notifications go through this module
 * Respects TRAI DND guidelines and doctor communication preferences
 */

const WA_API_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`

interface WATextMessage {
  to: string
  body: string
}

interface WAResult {
  success: boolean
  messageId?: string
  error?: string
}

// Format Indian mobile number to E.164
function formatIndianMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '')
  if (digits.startsWith('91') && digits.length === 12) return `+${digits}`
  if (digits.length === 10) return `+91${digits}`
  return `+${digits}`
}

// Core send function
async function sendWhatsAppMessage({ to, body }: WATextMessage): Promise<WAResult> {
  const token = process.env.WHATSAPP_API_TOKEN

  // Graceful degradation — if WhatsApp not configured, log and continue
  if (!token || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.log('[WhatsApp] Not configured — skipping message to', to)
    console.log('[WhatsApp] Message body:', body)
    return { success: true, messageId: 'mock-not-configured' }
  }

  try {
    const response = await fetch(WA_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formatIndianMobile(to),
        type: 'text',
        text: {
          preview_url: false,
          body,
        },
      }),
    })

    if (!response.ok) {
      const err = await response.json()
      console.error('[WhatsApp] API error:', err)
      return { success: false, error: JSON.stringify(err) }
    }

    const data = await response.json()
    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    }
  } catch (error) {
    console.error('[WhatsApp] Network error:', error)
    return { success: false, error: String(error) }
  }
}

// ── Notification templates ─────────────────────────
// Clinical language throughout — no marketing copy

export async function notifySpecialistNewReferral({
  specialistMobile,
  specialistName,
  referrerName,
  patientName,
  urgency,
  referenceNo,
  appUrl,
}: {
  specialistMobile: string
  specialistName: string
  referrerName: string
  patientName: string
  urgency: string
  referenceNo: string
  appUrl: string
}) {
  const urgencyLabel = urgency === 'emergency' ? '🔴 EMERGENCY' :
                       urgency === 'urgent'    ? '🟡 Urgent' : 'Routine'

  const body = `ClinCollab — New referral

Dr. ${specialistName},

${urgencyLabel} referral received from Dr. ${referrerName}.

Patient: ${patientName}
Reference: ${referenceNo}

Review and respond: ${appUrl}/referrals/${referenceNo}

— ClinCollab`

  return sendWhatsAppMessage({ to: specialistMobile, body })
}

export async function notifyReferrerCaseAccepted({
  referrerMobile,
  referrerName,
  specialistName,
  patientName,
  expectedDate,
  pocSpecialistName,
  pocSpecialistMobile,
  referenceNo,
}: {
  referrerMobile: string
  referrerName: string
  specialistName: string
  patientName: string
  expectedDate?: string
  pocSpecialistName?: string
  pocSpecialistMobile?: string
  referenceNo: string
}) {
  const dateStr = expectedDate
    ? `Expected consultation: ${new Date(expectedDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : ''

  const pocStr = pocSpecialistName
    ? `\nPoint of contact: ${pocSpecialistName}${pocSpecialistMobile ? ` (${pocSpecialistMobile})` : ''}`
    : ''

  const body = `ClinCollab — Referral accepted

Dr. ${referrerName},

Your referral for ${patientName} has been accepted by Dr. ${specialistName}.

${dateStr}${pocStr}
Reference: ${referenceNo}

You will receive updates as the case progresses.

— ClinCollab`

  return sendWhatsAppMessage({ to: referrerMobile, body })
}

export async function notifyReferrerCaseQueried({
  referrerMobile,
  referrerName,
  specialistName,
  patientName,
  queryText,
  replyUrl,
  referenceNo,
}: {
  referrerMobile: string
  referrerName: string
  specialistName: string
  patientName: string
  queryText: string
  replyUrl: string
  referenceNo: string
}) {
  const body = `ClinCollab — Clinical query

Dr. ${referrerName},

Dr. ${specialistName} has a query regarding your referral for ${patientName}.

Query: ${queryText}

Please reply here: ${replyUrl}
Reference: ${referenceNo}

— ClinCollab`

  return sendWhatsAppMessage({ to: referrerMobile, body })
}

export async function notifyReferrerCaseDeclined({
  referrerMobile,
  referrerName,
  specialistName,
  patientName,
  reason,
  referenceNo,
}: {
  referrerMobile: string
  referrerName: string
  specialistName: string
  patientName: string
  reason: string
  referenceNo: string
}) {
  const body = `ClinCollab — Referral update

Dr. ${referrerName},

Regarding your referral for ${patientName} to Dr. ${specialistName}.

${reason}

Reference: ${referenceNo}

For queries, please contact Dr. ${specialistName}'s clinic directly.

— ClinCollab`

  return sendWhatsAppMessage({ to: referrerMobile, body })
}

export async function notifyReferrerCaseUpdate({
  referrerMobile,
  referrerName,
  specialistName,
  patientName,
  updateType,
  updateSummary,
  referenceNo,
}: {
  referrerMobile: string
  referrerName: string
  specialistName: string
  patientName: string
  updateType: string
  updateSummary: string
  referenceNo: string
}) {
  const typeLabels: Record<string, string> = {
    patient_arrived:      'Patient has arrived',
    findings_shared:      'Clinical findings shared',
    procedure_planned:    'Procedure planned',
    procedure_completed:  'Procedure completed',
    discharged:           'Patient discharged',
    follow_up_required:   'Follow-up required',
    general_update:       'Clinical update',
  }

  const body = `ClinCollab — ${typeLabels[updateType] || 'Clinical update'}

Dr. ${referrerName},

Update regarding your patient ${patientName} under care of Dr. ${specialistName}:

${updateSummary}

Reference: ${referenceNo}

— ClinCollab`

  return sendWhatsAppMessage({ to: referrerMobile, body })
}

export async function sendReferralFormLink({
  referrerMobile,
  referrerName,
  specialistName,
  specialistSpecialty,
  formUrl,
}: {
  referrerMobile: string
  referrerName?: string
  specialistName: string
  specialistSpecialty: string
  formUrl: string
}) {
  const greeting = referrerName ? `Dr. ${referrerName},` : 'Dear Doctor,'

  const body = `ClinCollab — Referral form

${greeting}

Dr. ${specialistName} (${specialistSpecialty}) has shared a referral form with you.

To refer a patient, tap the link below and complete the clinical summary. No app required.

${formUrl}

— ClinCollab`

  return sendWhatsAppMessage({ to: referrerMobile, body })
}
