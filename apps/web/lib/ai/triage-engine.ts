/**
 * ClinCollab Virtual Triage Nurse — AI Engine (SERVER-ONLY)
 *
 * This file imports from 'groq-sdk' which is Node.js-only.
 * DO NOT import this file in client components — it will crash the browser.
 *
 * Client-safe pure functions & types live in: lib/ai/triage-logic.ts
 *
 * This file exports:
 *  - generateClinicalSynopsis (Groq LLM call)
 *  - Re-exports everything from triage-logic for server-side convenience
 */

import Groq from 'groq-sdk'

let _groq: Groq | null = null
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  return _groq
}

// Re-export all pure logic so server files can import from one place
export {
  resolveVisibleQuestions,
  evaluateRedFlags,
  computeSessionRedFlagLevel,
  buildRedFlagSummary,
  formatAnswerForDisplay,
  getQuestionText,
  parseBP,
  computeCompletionPct,
  buildFhirQuestionnaireResponse,
} from './triage-logic'

export type {
  TriageQuestion,
  QuestionType,
  BranchRule,
  RedFlagRule,
  AnswerMap,
  RedFlagResult,
  Lang,
} from './triage-logic'

// ── AI clinical synopsis generator ───────────────────────────────────────────
/**
 * Generates a 2–3 sentence clinical summary for the specialist.
 * Called server-side only after triage completion.
 */
export async function generateClinicalSynopsis(
  specialistName: string,
  specialistSpecialty: string,
  patientName: string,
  patientAge: number | null,
  patientGender: string | null,
  questions: import('./triage-logic').TriageQuestion[],
  answers: import('./triage-logic').AnswerMap,
  redFlagSummary: string
): Promise<string> {
  const { formatAnswerForDisplay } = await import('./triage-logic')

  const qaPairs = questions
    .filter(q => q.question_type !== 'section_header')
    .filter(q => answers[q.id])
    .map(q => {
      const a = answers[q.id]
      const display = formatAnswerForDisplay(q, a)
      return `${q.question_text}: ${display}`
    })
    .join('\n')

  if (qaPairs.length === 0) return ''

  const prompt = `You are a clinical assistant preparing a pre-consultation brief for ${specialistName}, a ${specialistSpecialty.replace(/_/g, ' ')} specialist.

Patient: ${patientName}${patientAge ? `, ${patientAge} years` : ''}${patientGender ? `, ${patientGender}` : ''}

Triage answers:
${qaPairs}

${redFlagSummary ? `Red flags identified:\n${redFlagSummary}` : ''}

Write a concise 2–3 sentence clinical summary of this patient's presentation for the specialist. Use clinical language. Do not include a greeting or title. Do not provide diagnosis or clinical advice — summarise the presenting complaint, key history, and any important flags.`

  try {
    const completion = await getGroq().chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens:  200,
    })
    return completion.choices[0]?.message?.content?.trim() || ''
  } catch (error) {
    console.error('[Triage] AI synopsis error:', error)
    return ''
  }
}
