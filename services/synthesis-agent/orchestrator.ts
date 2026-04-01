/**
 * ClinCollab — Synthesis Agent Orchestrator
 *
 * Architectural pattern: parallel tool execution with graceful degradation.
 * The agent runs up to 5 data-gathering tools in parallel.
 * Each tool has its own circuit breaker.
 * Any tool can fail — the agent continues with whatever data it has.
 * Final synthesis LLM call happens only if at least ONE tool succeeded.
 *
 * This is the ONLY component that imports from agent-tools.ts.
 * The rest of the application talks to this orchestrator via:
 *   - server actions (app/actions/synthesis.ts)
 *   - API route (app/api/synthesis/route.ts)
 */

import Groq from 'groq-sdk'
import { createClient } from '@supabase/supabase-js'
import {
  triageDataTool,
  referralDataTool,
  appointmentHistoryTool,
  chatbotInteractionTool,
  specialistNotesTool,
  type ToolOutput,
  type TriageToolOutput,
  type ReferralToolOutput,
  type AppointmentToolOutput,
  type ChatbotToolOutput,
  type SpecialistNotesToolOutput,
} from './agent-tools'
import { callExternalService, log, moduleBoundary, withTimeout } from '../../packages/shared-utils/resilience'
import { dispatch as notify, Templates } from '../../packages/notification-bus'
import type { ClinCollab } from '../../packages/types'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// ── Orchestrator entry point ───────────────────────────────────
export async function runSynthesisJob(jobId: string): Promise<void> {
  const db = svc()

  // Fetch job
  const { data: job } = await db
    .from('synthesis_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (!job) { console.error('[Synthesis] Job not found:', jobId); return }
  if (job.status === 'completed') return

  // Mark running
  await db.from('synthesis_jobs').update({
    status: 'running', started_at: new Date().toISOString(),
  }).eq('id', jobId)

  log('info', 'M6', 'synthesis_started', { jobId, trigger: job.trigger })

  const { specialist_id, patient_name, triage_session_id, referral_case_id, appointment_id } = job

  // ── 1. Fetch specialist for notifications ─────────────────────
  const { data: specialist } = await db
    .from('specialists')
    .select('name, specialty, whatsapp_number')
    .eq('id', specialist_id)
    .single()

  // ── 2. Get patient mobile from context ────────────────────────
  let patientMobile: string | null = null
  if (triage_session_id) {
    const { data: ts } = await db.from('triage_sessions').select('patient_mobile').eq('id', triage_session_id).single()
    patientMobile = ts?.patient_mobile || null
  }

  // ── 3. Run all tools in parallel — each is fully isolated ─────
  const toolStart = Date.now()

  const [triageResult, referralResult, appointmentResult, chatbotResult, notesResult] =
    await Promise.allSettled([
      triage_session_id
        ? triageDataTool(triage_session_id, specialist_id)
        : Promise.resolve({ ok: false as const, error: 'no_triage_session' }),

      referral_case_id
        ? referralDataTool(referral_case_id, specialist_id)
        : Promise.resolve({ ok: false as const, error: 'no_referral' }),

      appointmentHistoryTool(patient_name, patientMobile, specialist_id),
      chatbotInteractionTool(patientMobile, specialist_id),
      specialistNotesTool(patient_name, referral_case_id, specialist_id),
    ])

  // ── 4. Write agent traces ─────────────────────────────────────
  const tools = [
    { name: 'triage_data',          result: triageResult,      source: 'triage_self_report' },
    { name: 'referral_summary',     result: referralResult,    source: 'referral_summary' },
    { name: 'appointment_history',  result: appointmentResult, source: 'appointment_history' },
    { name: 'chatbot_interactions', result: chatbotResult,     source: 'chatbot_interaction' },
    { name: 'specialist_notes',     result: notesResult,       source: 'specialist_notes' },
  ]

  const traces = tools.map(t => ({
    job_id:         jobId,
    specialist_id,
    tool_name:      t.name,
    tool_status:    t.result.status === 'fulfilled' && (t.result.value as any)?.ok
                      ? 'success' : 'failed',
    output_summary: t.result.status === 'fulfilled' && (t.result.value as any)?.ok
                      ? summariseTool(t.name, (t.result.value as any).value)
                      : (t.result.status === 'rejected' ? String(t.result.reason) : 'no data'),
    data_source:    t.source as any,
    duration_ms:    Date.now() - toolStart,
  }))

  await db.from('agent_traces').insert(traces)

  // ── 5. Collect successful results ─────────────────────────────
  const successfulOutputs: ToolOutput[] = []

  if (triageResult.status === 'fulfilled' && (triageResult.value as any).ok) {
    successfulOutputs.push((triageResult.value as any).value)
  }
  if (referralResult.status === 'fulfilled' && (referralResult.value as any).ok) {
    successfulOutputs.push((referralResult.value as any).value)
  }
  if (appointmentResult.status === 'fulfilled' && (appointmentResult.value as any).ok) {
    successfulOutputs.push((appointmentResult.value as any).value)
  }
  if (chatbotResult.status === 'fulfilled' && (chatbotResult.value as any).ok) {
    successfulOutputs.push((chatbotResult.value as any).value)
  }
  if (notesResult.status === 'fulfilled' && (notesResult.value as any).ok) {
    successfulOutputs.push((notesResult.value as any).value)
  }

  const dataCompleteness = Math.round((successfulOutputs.length / tools.length) * 100)

  if (successfulOutputs.length === 0) {
    await db.from('synthesis_jobs').update({
      status: 'failed', error_message: 'All data tools failed — no data to synthesise',
      completed_at: new Date().toISOString(),
    }).eq('id', jobId)
    return
  }

  // ── 6. Build synthesis context ────────────────────────────────
  const context = buildSynthesisContext(
    patient_name,
    specialist?.name || '',
    specialist?.specialty || '',
    successfulOutputs
  )

  // ── 7. LLM synthesis call ─────────────────────────────────────
  const synthesisResult = await callExternalService('groq_synthesis', async () => {
    const completion = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens:  800,
      messages: [{
        role:    'system',
        content: buildSystemPrompt(specialist?.name || '', specialist?.specialty || ''),
      }, {
        role:    'user',
        content: context,
      }],
      response_format: { type: 'json_object' },
    })
    return completion.choices[0]?.message?.content || '{}'
  }, 15_000)

  // ── 8. Parse synthesis output ─────────────────────────────────
  let synthesisOutput: ClinCollab.SynthesisOutput
  let clinicalBrief = ''

  if (synthesisResult.ok) {
    try {
      const raw = JSON.parse(synthesisResult.value)
      clinicalBrief = raw.clinical_brief || ''
      synthesisOutput = {
        clinical_brief:            raw.clinical_brief || '',
        key_findings:              raw.key_findings || [],
        recommended_focus_areas:   raw.recommended_focus_areas || [],
        data_completeness_score:   dataCompleteness,
        sources_used:              successfulOutputs.map(o => o.source) as ClinCollab.DataSource[],
        red_flags:                 raw.red_flags || [],
        generated_at:              new Date().toISOString(),
      }

      // Insert structured findings
      const findings = (raw.key_findings || []).map((f: any) => ({
        job_id:       jobId,
        specialist_id,
        category:     f.category || 'General',
        finding:      f.finding,
        significance: f.significance || 'routine',
        source:       f.source || 'triage_self_report',
        is_red_flag:  f.significance === 'critical',
        red_flag_message: f.significance === 'critical' ? f.finding : null,
      }))

      if (findings.length > 0) {
        await db.from('synthesis_findings').insert(findings)
      }
    } catch (e) {
      clinicalBrief = synthesisResult.value.slice(0, 500)
      synthesisOutput = buildFallbackOutput(successfulOutputs, dataCompleteness)
    }
  } else {
    // Groq failed — build a structured output from raw tool data
    log('warn', 'M6', 'groq_synthesis_failed', { jobId, error: synthesisResult.error })
    clinicalBrief = buildFallbackBrief(patient_name, successfulOutputs)
    synthesisOutput = buildFallbackOutput(successfulOutputs, dataCompleteness)
  }

  // ── 9. Detect synthesis-level red flags ───────────────────────
  const redFlags = extractRedFlags(successfulOutputs)
  const hasCritical = redFlags.some(f => f.level === 'urgent')

  // ── 10. Save job as completed ─────────────────────────────────
  await db.from('synthesis_jobs').update({
    status:           'completed',
    clinical_brief:   clinicalBrief,
    data_completeness:dataCompleteness,
    output_json:      synthesisOutput as any,
    completed_at:     new Date().toISOString(),
  }).eq('id', jobId)

  log('info', 'M6', 'synthesis_completed', {
    jobId, dataCompleteness, toolsSucceeded: successfulOutputs.length,
  })

  // ── 11. Notify specialist ─────────────────────────────────────
  const briefUrl = `${process.env.NEXT_PUBLIC_APP_URL}/synthesis/${jobId}`

  if (specialist?.whatsapp_number) {
    if (hasCritical && redFlags.length > 0) {
      const flagText = redFlags
        .filter(f => f.level === 'urgent')
        .map(f => `• ${f.description}`)
        .join('\n')

      await notify({
        module:           'M6',
        specialist_id,
        recipient_type:   'specialist',
        recipient_mobile: specialist.whatsapp_number,
        message: Templates.synthesisUrgentFlag(specialist.name, patient_name, flagText, briefUrl),
      })
    } else {
      await notify({
        module:           'M6',
        specialist_id,
        recipient_type:   'specialist',
        recipient_mobile: specialist.whatsapp_number,
        message: Templates.synthesisReady(specialist.name, patient_name, briefUrl),
      })
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────

function buildSystemPrompt(specialistName: string, specialty: string): string {
  return `You are a clinical synthesis assistant preparing a pre-consultation brief for Dr. ${specialistName}, a ${specialty.replace(/_/g, ' ')} specialist.

Your task is to synthesise patient information from multiple sources into a structured clinical brief.

Return ONLY valid JSON with this exact structure:
{
  "clinical_brief": "3-5 sentence structured clinical summary for the specialist. Include presenting complaint, key history, relevant findings, and any important flags.",
  "key_findings": [
    {
      "category": "string (e.g. Cardiac History, Medications, Vitals, Symptoms)",
      "finding": "string — specific clinical finding",
      "source": "one of: triage_self_report|referral_summary|appointment_history|chatbot_interaction|specialist_notes",
      "significance": "routine|notable|critical"
    }
  ],
  "recommended_focus_areas": ["string", "string"],
  "red_flags": [
    {
      "description": "string",
      "source": "data_source_string",
      "level": "needs_review|urgent"
    }
  ]
}

Rules:
- clinical_brief must be in third person, clinical language
- Do NOT provide diagnosis or treatment recommendations
- Do NOT include raw patient contact details
- Mark significance as "critical" only for objective clinical red flags
- recommended_focus_areas should be specific clinical topics for the consultation`
}

function buildSynthesisContext(
  patientName: string,
  specialistName: string,
  specialty: string,
  outputs: ToolOutput[]
): string {
  const sections: string[] = [`Patient: ${patientName}\nSpecialist: Dr. ${specialistName} (${specialty.replace(/_/g, ' ')})\n`]

  for (const output of outputs) {
    switch (output.source) {
      case 'triage_self_report': {
        const t = output as TriageToolOutput
        sections.push(`TRIAGE (self-reported by patient):\n${
          t.answers.slice(0, 15).map(a =>
            `- ${a.question_text}: ${a.answer_display || a.answer_value}${a.is_red_flag ? ' [FLAG]' : ''}`
          ).join('\n')
        }${t.redFlagSummary ? `\nTriage flags: ${t.redFlagSummary}` : ''}`)
        break
      }
      case 'referral_summary': {
        const r = output as ReferralToolOutput
        sections.push(`REFERRAL (from referring doctor):\nChief complaint: ${r.chiefComplaint}\n${r.soapNotes ? `Clinical notes: ${r.soapNotes}\n` : ''}${r.procedureRecommended ? `Procedure recommended: ${r.procedureRecommended}\n` : ''}Urgency: ${r.urgency}${r.allergies ? `\nAllergies: ${r.allergies}` : ''}${r.comorbidities ? `\nComorbidities: ${r.comorbidities}` : ''}${r.ecgFindings ? `\nECG: ${r.ecgFindings}` : ''}${r.labSummary ? `\nLabs: ${r.labSummary}` : ''}`)
        break
      }
      case 'appointment_history': {
        const a = output as AppointmentToolOutput
        sections.push(`APPOINTMENT HISTORY:\nTotal appointments with this specialist: ${a.totalAppointments}${a.upcomingAppointment ? `\nUpcoming: ${a.upcomingAppointment.slotDate} at ${a.upcomingAppointment.slotTime}${a.upcomingAppointment.reason ? ` — ${a.upcomingAppointment.reason}` : ''}` : ''}`)
        break
      }
      case 'chatbot_interaction': {
        const c = output as ChatbotToolOutput
        if (c.sessionCount > 0) {
          sections.push(`CHATBOT INTERACTIONS:\nPatient contacted clinic ${c.sessionCount} time(s) via chatbot.${c.topIntents.length > 0 ? `\nTop queries: ${c.topIntents.join(', ')}` : ''}${c.bookedViaChat ? '\nBooked appointment via chatbot.' : ''}`)
        }
        break
      }
      case 'specialist_notes': {
        const n = output as SpecialistNotesToolOutput
        if (n.caseMessages.length > 0) {
          sections.push(`CASE COMMUNICATIONS:\n${n.caseMessages.join('\n')}`)
        }
        break
      }
    }
  }

  return sections.join('\n\n')
}

function extractRedFlags(outputs: ToolOutput[]): ClinCollab.SynthesisRedFlag[] {
  const flags: ClinCollab.SynthesisRedFlag[] = []

  for (const output of outputs) {
    if (output.source === 'triage_self_report') {
      const t = output as TriageToolOutput
      if (t.redFlagLevel === 'urgent' || t.redFlagLevel === 'needs_review') {
        flags.push({
          description: t.redFlagSummary || 'Triage red flag',
          source:      'triage_self_report',
          level:       t.redFlagLevel,
        })
      }
    }
    if (output.source === 'referral_summary') {
      const r = output as ReferralToolOutput
      if (r.urgency === 'emergency') {
        flags.push({ description: 'Emergency referral urgency', source: 'referral_summary', level: 'urgent' })
      }
    }
  }

  return flags
}

function summariseTool(toolName: string, data: any): string {
  if (!data) return 'no data'
  switch (toolName) {
    case 'triage_data':
      return `${(data as TriageToolOutput).answers.length} answers, flag: ${(data as TriageToolOutput).redFlagLevel}`
    case 'referral_summary':
      return `ref: ${(data as ReferralToolOutput).referenceNo}, urgency: ${(data as ReferralToolOutput).urgency}`
    case 'appointment_history':
      return `${(data as AppointmentToolOutput).totalAppointments} appointments`
    case 'chatbot_interactions':
      return `${(data as ChatbotToolOutput).sessionCount} sessions`
    case 'specialist_notes':
      return `${(data as SpecialistNotesToolOutput).caseMessages.length} messages`
    default: return 'ok'
  }
}

function buildFallbackBrief(patientName: string, outputs: ToolOutput[]): string {
  const parts: string[] = []
  for (const o of outputs) {
    if (o.source === 'triage_self_report') {
      const t = o as TriageToolOutput
      const cc = t.answers.find(a => a.sort_order === 1)
      if (cc) parts.push(`Chief complaint: ${cc.answer_display || cc.answer_value}`)
      if (t.redFlagSummary) parts.push(`Flags: ${t.redFlagSummary}`)
    }
    if (o.source === 'referral_summary') {
      parts.push(`Referral complaint: ${(o as ReferralToolOutput).chiefComplaint}`)
    }
  }
  return parts.length > 0
    ? `${patientName}: ${parts.join('. ')}.`
    : `${patientName} — triage and referral data available. Full synthesis unavailable.`
}

function buildFallbackOutput(
  outputs: ToolOutput[],
  dataCompleteness: number
): ClinCollab.SynthesisOutput {
  return {
    clinical_brief:           '',
    key_findings:             [],
    recommended_focus_areas:  [],
    data_completeness_score:  dataCompleteness,
    sources_used:             outputs.map(o => o.source) as ClinCollab.DataSource[],
    red_flags:                [],
    generated_at:             new Date().toISOString(),
  }
}
