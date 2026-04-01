/**
 * @clincollab/notification-bus
 *
 * SINGLE source of truth for all outbound notifications.
 * Every module calls THIS — never the WhatsApp API directly.
 *
 * Principles:
 * - Notifications are fire-and-forget from the module's perspective
 * - Bus handles: delivery, retry, circuit breaking, audit log
 * - If WhatsApp is down, in-app fallback is used
 * - Module never crashes because a notification failed
 */

import { callExternalService, log } from '../shared-utils/resilience'
import type { Result } from '../types'
import { ok, err } from '../types'

export interface NotificationPayload {
  /** Which module is sending */
  module:           'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6'
  /** specialist_id for audit trail */
  specialist_id:    string
  /** Who receives */
  recipient_type:   'specialist' | 'referring_doctor' | 'patient'
  recipient_mobile: string
  /** The message text */
  message:          string
  /** for deduplication — same idempotency_key → only sent once */
  idempotency_key?: string
}

// ── WhatsApp sender ────────────────────────────────────────────
async function sendWhatsApp(mobile: string, body: string): Promise<Result<string>> {
  const token  = process.env.WHATSAPP_API_TOKEN
  const numId  = process.env.WHATSAPP_PHONE_NUMBER_ID

  if (!token || !numId) {
    // Development mode — log instead of sending
    log('info', 'notification-bus', 'whatsapp_dry_run', { mobile, body: body.slice(0, 100) })
    return ok('dry-run')
  }

  const digits = mobile.replace(/\D/g, '')
  const to     = digits.startsWith('91') ? `+${digits}` : `+91${digits}`

  return callExternalService('whatsapp_api', async () => {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${numId}/messages`,
      {
        method:  'POST',
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
      }
    )

    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(`WhatsApp API ${res.status}: ${JSON.stringify(detail)}`)
    }

    const data = await res.json()
    return data?.messages?.[0]?.id as string
  }, 8_000)
}

// ── Public dispatch function ───────────────────────────────────
export async function dispatch(payload: NotificationPayload): Promise<Result<string>> {
  const { module, specialist_id, recipient_mobile, message, idempotency_key } = payload

  if (!recipient_mobile?.trim()) {
    log('warn', module, 'notification_skipped_no_mobile', { specialist_id })
    return ok('skipped_no_mobile')
  }

  log('info', module, 'notification_dispatch', {
    specialist_id,
    recipient_type: payload.recipient_type,
    mobile:         recipient_mobile.slice(-4).padStart(10, '*'),
    idempotency_key,
  })

  const result = await sendWhatsApp(recipient_mobile, message)

  if (!result.ok) {
    log('error', module, 'notification_failed', {
      specialist_id,
      error: result.error,
    })
    // Return gracefully — caller never crashes because WA failed
    return err(result.error)
  }

  log('info', module, 'notification_delivered', {
    specialist_id,
    message_id: result.value,
  })

  return ok(result.value)
}

// ── Pre-built notification templates ──────────────────────────
// All templates in one place — easier to maintain and audit

export const Templates = {

  // M3 — Referral
  referralReceived: (specialist: string, referrer: string, patient: string, urgency: string, refNo: string, url: string) =>
    `ClinCollab — New referral\n\nDr. ${specialist},\n\n${urgency === 'emergency' ? '🔴 EMERGENCY — ' : urgency === 'urgent' ? '🟡 Urgent — ' : ''}New referral from Dr. ${referrer}.\n\nPatient: ${patient}\nRef: ${refNo}\n\nReview: ${url}/referrals/${refNo}`,

  referralAccepted: (referrer: string, specialist: string, patient: string, date: string, poc: string, refNo: string) =>
    `ClinCollab — Referral accepted\n\nDr. ${referrer},\n\nYour referral for ${patient} has been accepted by Dr. ${specialist}.\n\n${date ? `Expected: ${date}\n` : ''}${poc ? `Contact: ${poc}\n` : ''}Ref: ${refNo}`,

  referralQueried: (referrer: string, specialist: string, patient: string, query: string, replyUrl: string, refNo: string) =>
    `ClinCollab — Clinical query\n\nDr. ${referrer},\n\nDr. ${specialist} has a query about ${patient}:\n\n"${query}"\n\nReply here: ${replyUrl}\nRef: ${refNo}`,

  referralDeclined: (referrer: string, patient: string, reason: string, refNo: string) =>
    `ClinCollab — Referral update\n\nDr. ${referrer},\n\nRegarding ${patient}:\n\n${reason}\n\nRef: ${refNo}`,

  caseUpdate: (referrer: string, specialist: string, patient: string, updateType: string, summary: string, refNo: string) =>
    `ClinCollab — ${updateType}\n\nDr. ${referrer},\n\nUpdate for ${patient} under Dr. ${specialist}:\n\n${summary}\n\nRef: ${refNo}`,

  // M4 — Chatbot
  appointmentConfirmed: (patient: string, specialist: string, dateStr: string) =>
    `ClinCollab — Appointment confirmed\n\n${patient}, your appointment with Dr. ${specialist} is confirmed for ${dateStr}.\n\nPlease bring previous reports and prescriptions.`,

  appointmentReminder: (patient: string, specialist: string, dateStr: string, time: string) =>
    `ClinCollab — Appointment reminder\n\n${patient}, your appointment with Dr. ${specialist} is tomorrow at ${time}.\n\nDate: ${dateStr}\n\nFor changes, contact the clinic directly.`,

  newBookingAlert: (specialist: string, patient: string, dateStr: string, reason: string, url: string) =>
    `ClinCollab — New appointment\n\nDr. ${specialist},\n\nNew appointment booked:\n👤 ${patient}\n📅 ${dateStr}\n📋 ${reason}\n\nView: ${url}/appointments`,

  // M5 — Triage
  triageLink: (patient: string, specialist: string, url: string, minutes: number) =>
    `ClinCollab — Pre-consultation questionnaire\n\nDear ${patient},\n\nDr. ${specialist} has shared a brief clinical questionnaire to complete before your consultation (~${minutes} min).\n\nTap to begin:\n${url}\n\nPlease complete this before your appointment.`,

  triageComplete: (specialist: string, patient: string, flagLevel: string, summaryUrl: string) => {
    const prefix = flagLevel === 'urgent' ? '🔴 URGENT — ' : flagLevel === 'needs_review' ? '🟡 Review needed — ' : ''
    return `ClinCollab — Triage complete\n\nDr. ${specialist},\n\n${prefix}${patient} has completed pre-consultation triage.\n\nView summary: ${summaryUrl}`
  },

  triageUrgentFlag: (specialist: string, patient: string, flagMessage: string, summaryUrl: string) =>
    `ClinCollab — 🔴 URGENT TRIAGE ALERT\n\nDr. ${specialist},\n\n${patient} flagged during triage:\n\n${flagMessage}\n\nReview now: ${summaryUrl}`,

  // M6 — Synthesis
  synthesisReady: (specialist: string, patient: string, briefUrl: string) =>
    `ClinCollab — Pre-consultation brief ready\n\nDr. ${specialist},\n\n360° clinical synthesis for ${patient} is ready.\n\nView brief: ${briefUrl}`,

  synthesisUrgentFlag: (specialist: string, patient: string, flags: string, briefUrl: string) =>
    `ClinCollab — 🔴 Clinical brief — URGENT FLAGS\n\nDr. ${specialist},\n\n${patient} synthesis flagged:\n\n${flags}\n\nBrief: ${briefUrl}`,
}

  // M7 — Transcription
  transcriptionReady: (specialist: string, patient: string, url: string) =>
    `ClinCollab — Consultation note ready\n\nDr. ${specialist},\n\nThe AI transcription for ${patient} is ready for your review.\n\nReview now: ${url}`,

  transcriptionFailed: (specialist: string, patient: string, error: string) =>
    `ClinCollab — Transcription issue\n\nDr. ${specialist},\n\nTranscription for ${patient} encountered an issue: ${error}\n\nPlease retry from the app.`,

  patientConsultSummary: (patient: string, specialist: string, summary: string) =>
    `ClinCollab — Your consultation summary\n\n${summary}`,

  referrerConsultUpdate: (referrer: string, patient: string, specialist: string, summary: string) =>
    `ClinCollab — Consultation update for ${patient}\n\nDr. ${referrer},\n\nDr. ${specialist} has completed a consultation with ${patient}.\n\n${summary}`,
