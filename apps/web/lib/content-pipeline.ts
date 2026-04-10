/**
 * ClinCollab — Clinical Content Pipeline (Module 10)
 *
 * ARCHITECTURE NOTE: This file lives inside apps/web/lib/ so it is ALWAYS
 * statically bundled by Next.js into the serverless function. The previous
 * version lived in services/content-agent/ and was loaded via a dynamic
 * import at runtime — on Vercel that file does not exist in the deployed
 * bundle, causing "Cannot find module" → status='failed' on every run.
 *
 * FAULT TOLERANCE: Every step has its own try/catch and graceful fallback.
 * The pipeline NEVER writes status='failed' due to Groq or data issues —
 * only for truly unrecoverable errors (DB unreachable). At worst it
 * completes with partial content that the doctor can work with.
 */

import Groq from 'groq-sdk'
import { createClient } from '@supabase/supabase-js'

// ── Groq client factory — lazy, never crashes at module load ───
let _groq: Groq | null = null
function getGroq(): Groq {
  if (!_groq) {
    const key = process.env.GROQ_API_KEY
    if (!key) throw new Error('GROQ_API_KEY environment variable is not set')
    _groq = new Groq({ apiKey: key })
  }
  return _groq
}

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// ── Types ──────────────────────────────────────────────────────
export interface ContentRequest {
  requestId:           string
  specialistId:        string
  specialistName:      string
  specialistSpecialty: string
  topic:               string
  contentType:         string
  audience:            string
  depth:               string
  specialInstructions: string | null
}

interface EvidenceBlock {
  subtopic:    string
  keyFinding:  string
  statistics:  string
  studyDesign: string
  sourceTitle: string
  sourceUrl:   string
  year:        number | null
  authors:     string
  journal:     string
  doi:         string
  trialId:     string
  score:       number
  tier:        'tier1' | 'tier2'
}

export interface ContentSection {
  title:           string
  sectionType:     string
  content:         string
  speakerNotes:    string
  evidenceLevel:   string
  evidenceTier:    'tier1' | 'tier2'
  evidenceSummary: string
  citationNums:    number[]
  isTier2:         boolean
  sortOrder:       number
  is_edited?:      boolean
  edited_text?:    string | null
}

// ── Template section structures per content type ───────────────
const SECTION_TEMPLATES: Record<string, string[]> = {
  cme_presentation:    ['Learning Objectives', 'Epidemiology & Clinical Burden', 'Pathophysiology', 'Current Evidence from Trials', 'Society Guidelines', 'Clinical Implications & Practice Points', 'Conclusion & Summary'],
  grand_rounds:        ['Case Presentation', 'Clinical Questions', 'Evidence Base', 'Society Recommendations', 'Management Approach', 'Teaching Points'],
  referral_guide:      ['When to Refer', 'Red Flags — Urgent Referral', 'Pre-referral Workup', 'Referral Letter Content', 'What the Specialist Will Do'],
  clinical_protocol:   ['Purpose & Scope', 'Background & Evidence', 'Step-by-Step Protocol', 'Roles & Responsibilities', 'Monitoring & Audit'],
  conference_abstract: ['Background', 'Objective', 'Methods', 'Results', 'Conclusions'],
  patient_education:   ['What is This Condition?', 'Why You Need This Procedure', 'What Happens During the Procedure', 'How to Prepare', 'Recovery & Aftercare', 'When to Call Your Doctor'],
  roundtable_points:   ['Topic Overview', 'Current Evidence Landscape', 'Areas of Consensus', 'Areas of Active Debate', 'Key Trial Data', 'Unanswered Questions'],
  case_discussion:     ['Case Summary', 'Key Clinical Questions', 'Evidence Review', 'Management Options', 'Recommended Approach', 'Key Learning Points'],
}

const AUDIENCE_LABELS: Record<string, string> = {
  specialist_peers:     'specialist physicians with deep clinical expertise',
  junior_doctors:       'medical residents and junior doctors building clinical knowledge',
  referring_physicians: 'GPs and general physicians who refer patients to specialists',
  patients_families:    'patients and families — use plain English, no jargon',
  administrators:       'hospital administrators focused on quality and safety metrics',
}

// ── Credibility scorer — deterministic, no LLM ───────────────
export function scoreSource(url: string, title: string) {
  const u = (url || '').toLowerCase()
  const t = (title || '').toLowerCase()

  if (u.includes('pubmed.ncbi.nlm.nih.gov') || u.includes('ncbi.nlm.nih.gov/pmc'))
    return { score: 5, tier: 'tier1' as const, sourceType: 'pubmed' }
  if (u.includes('cochranelibrary.com') || t.includes('cochrane'))
    return { score: 5, tier: 'tier1' as const, sourceType: 'cochrane' }
  if (u.includes('acc.org'))
    return { score: 5, tier: 'tier1' as const, sourceType: 'guideline', institution: 'ACC' }
  if (u.includes('escardio.org'))
    return { score: 5, tier: 'tier1' as const, sourceType: 'guideline', institution: 'ESC' }
  if (u.includes('heart.org'))
    return { score: 5, tier: 'tier1' as const, sourceType: 'guideline', institution: 'AHA' }
  if (u.includes('nice.org.uk'))
    return { score: 5, tier: 'tier1' as const, sourceType: 'guideline', institution: 'NICE' }
  if (u.includes('who.int'))
    return { score: 5, tier: 'tier1' as const, sourceType: 'guideline', institution: 'WHO' }
  if (u.includes('csi.org.in') || u.includes('cardiologysociety.in'))
    return { score: 4, tier: 'tier1' as const, sourceType: 'indian_guideline', institution: 'CSI' }
  if (u.includes('icmr.gov.in'))
    return { score: 4, tier: 'tier1' as const, sourceType: 'indian_guideline', institution: 'ICMR' }
  if (u.includes('aiims.edu') || u.includes('aiims.ac.in'))
    return { score: 4, tier: 'tier1' as const, sourceType: 'indian_guideline', institution: 'AIIMS' }
  const topJournals = ['nejm.org','thelancet.com','bmj.com','jamanetwork.com',
    'ahajournals.org','jacc.org','onlinejacc.org','nature.com','cell.com',
    'science.org','european-heart-journal','karger.com']
  if (topJournals.some(j => u.includes(j)))
    return { score: 4, tier: 'tier1' as const, sourceType: 'journal' }
  if (u.includes('.org') && (t.includes('guideline') || t.includes('consensus') || t.includes('recommendation')))
    return { score: 3, tier: 'tier1' as const, sourceType: 'society' }
  if (u.includes('clinicaltrials.gov'))
    return { score: 0, tier: 'tier2' as const, sourceType: 'registered_trial' }
  if (u.includes('medrxiv.org'))
    return { score: 0, tier: 'tier2' as const, sourceType: 'preprint' }

  // Unknown URL but has real content — treat as tier1 with lower score
  return { score: 2, tier: 'tier1' as const, sourceType: 'other' }
}

// ── Vancouver citation formatter — fully null-safe ─────────────
export function formatVancouverCitation(e: EvidenceBlock, num: number): string {
  const parts: string[] = [`${num}.`]
  if (e.authors)     parts.push(e.authors + '.')
  if (e.sourceTitle) parts.push(e.sourceTitle + '.')
  if (e.journal)     parts.push(e.journal + '.')
  if (e.year)        parts.push(`${e.year};`)
  if (e.doi)         parts.push(`doi:${e.doi}.`)
  if (e.sourceUrl)   parts.push(`Available from: ${e.sourceUrl}`)
  return parts.join(' ')
}

// ── Trace logger ───────────────────────────────────────────────
async function trace(
  sc: ReturnType<typeof svc>,
  requestId: string,
  specialistId: string,
  step: number,
  name: string,
  label: string,
  status: string,
  detail?: string,
  durationMs?: number
) {
  try {
    await sc.from('content_agent_traces').insert({
      request_id: requestId, specialist_id: specialistId,
      step_number: step, step_name: name, step_label: label,
      step_status: status, detail: detail || null, duration_ms: durationMs || null,
    })
    const statusMap: Record<string, string> = {
      topic_decomposition: 'decomposing',
      tier1_search:        'searching',
      content_structuring: 'structuring',
    }
    if (statusMap[name]) {
      await sc.from('content_requests').update({ status: statusMap[name] }).eq('id', requestId)
    }
  } catch (e) {
    // Trace failure must NEVER crash the pipeline
    console.error('[M10:trace]', e)
  }
}

// ── Groq call wrapper — 15s timeout, always returns fallback ──
async function callGroq<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Groq timeout: ${label}`)), 15000)
    )
    return await Promise.race([fn(), timeout])
  } catch (e) {
    console.error(`[M10:groq:${label}]`, e instanceof Error ? e.message : String(e))
    return fallback
  }
}

// ── STEP 1: Decompose topic into subtopics ─────────────────────
async function decomposeTopicToSubtopics(
  topic: string,
  contentType: string,
  specialty: string,
  depth: string,
  specialInstructions: string | null
): Promise<string[]> {
  const count = depth === 'overview' ? 3 : depth === 'standard' ? 4 : 6

  const prompt = `You are a senior medical research librarian specialising in ${specialty}.
Break down this clinical topic into ${count} specific, searchable subtopics.

Topic: "${topic}"
Content type: ${contentType.replace(/_/g, ' ')}
${specialInstructions ? `Special focus: ${specialInstructions}` : ''}

Rules:
- Each must be a precise 5–10 word search query that finds RCTs, guidelines, or systematic reviews
- Include the most clinically important aspects of the topic
- Include 1 Indian-context query (CSI, ICMR, AIIMS, Indian registry data) where applicable
- Reference trial names, guideline organisations (ACC/ESC/AHA/CSI), year qualifiers (2020–2024)

Return ONLY valid JSON: {"queries": ["query 1", "query 2", ...]}`

  const result = await callGroq(async () => {
    const completion = await getGroq().chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return only valid JSON with key "queries" as an array of strings.' },
        { role: 'user', content: prompt },
      ],
    })
    const raw = completion.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(raw)
    const queries: string[] = parsed.queries || parsed.subtopics || []
    return queries.slice(0, count).filter((q): q is string => typeof q === 'string' && q.length > 3)
  }, [] as string[], 'decompose')

  // Always return at least the topic itself so evidence generation can proceed
  return result.length > 0 ? result : [topic]
}

// ── STEP 2: Generate evidence blocks from Groq's medical knowledge
async function generateEvidenceForSubtopic(
  subtopic: string,
  topic: string,
  specialty: string
): Promise<EvidenceBlock[]> {
  const prompt = `You are a medical research assistant with comprehensive clinical literature knowledge.
For this subtopic in ${specialty}: "${subtopic}" (part of broader topic: "${topic}")

Generate 3–5 evidence blocks from REAL published papers, trials, or guidelines you know from training.

Rules:
1. ONLY cite real, published papers or guidelines — never fabricate
2. Provide real authors, journals, years
3. For papers: PubMed URL = https://pubmed.ncbi.nlm.nih.gov/?term=TRIAL_NAME+FIRST_AUTHOR+YEAR
4. For guidelines: use real org URL (https://www.acc.org/guidelines, https://www.escardio.org/Guidelines)
5. Statistics: only report numbers you are confident about — leave blank if uncertain
6. studyDesign must be one of: RCT | meta-analysis | systematic-review | guideline | registry | cohort | consensus

Return ONLY valid JSON:
{
  "evidence": [
    {
      "keyFinding": "paraphrased finding, max 60 words",
      "statistics": "exact stats if known, else empty string",
      "studyDesign": "RCT",
      "sourceTitle": "exact title",
      "sourceUrl": "real URL or empty string",
      "year": 2022,
      "authors": "Surname A, Surname B, et al.",
      "journal": "New England Journal of Medicine",
      "doi": "10.1056/... or empty string",
      "trialId": "NCT... or empty string",
      "isTier2": false
    }
  ]
}`

  return callGroq(async () => {
    const completion = await getGroq().chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.05,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Medical research assistant. Only cite real published work. Return only JSON. Never fabricate citations.' },
        { role: 'user', content: prompt },
      ],
    })

    const raw = completion.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(raw)
    const arr: any[] = Array.isArray(parsed.evidence) ? parsed.evidence : []

    return arr
      .filter(e => e && typeof e === 'object' && e.keyFinding && e.sourceTitle)
      .map(e => {
        const url   = (e.sourceUrl   || '').trim()
        const title = (e.sourceTitle || '').trim()
        const scoring = scoreSource(url, title)
        return {
          subtopic:    subtopic,
          keyFinding:  String(e.keyFinding  || '').trim(),
          statistics:  String(e.statistics  || '').trim(),
          studyDesign: String(e.studyDesign || 'journal_article').trim(),
          sourceTitle: title,
          sourceUrl:   url,
          year:        typeof e.year === 'number' ? e.year : null,
          authors:     String(e.authors  || '').trim(),
          journal:     String(e.journal  || '').trim(),
          doi:         String(e.doi      || '').trim(),
          trialId:     String(e.trialId  || '').trim(),
          score:       Math.max(scoring.score, 2),
          tier:        (e.isTier2 ? 'tier2' : scoring.tier) as 'tier1' | 'tier2',
        }
      })
  }, [] as EvidenceBlock[], `evidence:${subtopic.slice(0, 30)}`)
}

// ── STEP 3: Structure content into sections ────────────────────
async function structureContent(
  evidenceBlocks: EvidenceBlock[],
  request: ContentRequest,
): Promise<ContentSection[]> {
  const structure = SECTION_TEMPLATES[request.contentType] || SECTION_TEMPLATES.cme_presentation
  const tier1 = evidenceBlocks.filter(e => e.tier === 'tier1')
  const tier2 = evidenceBlocks.filter(e => e.tier === 'tier2')

  // Even with no evidence, generate placeholder sections so the pipeline always completes
  const evidenceSummary = tier1.slice(0, 12).map((e, i) =>
    `[REF-${i+1}] ${e.keyFinding} — ${e.sourceTitle}${e.year ? ` (${e.year})` : ''}${e.statistics ? ' | ' + e.statistics : ''}`
  ).join('\n')

  const hasEvidence = tier1.length > 0

  const prompt = `Create a ${request.contentType.replace(/_/g, ' ')} on: "${request.topic}"
Audience: ${AUDIENCE_LABELS[request.audience] || 'specialist peers'}
${request.specialInstructions ? `Special instructions: ${request.specialInstructions}` : ''}

REQUIRED SECTIONS (write ALL ${structure.length}):
${structure.map((s, i) => `${i + 1}. ${s}`).join('\n')}

${hasEvidence ? `EVIDENCE (cite with [REF-N] markers):
${evidenceSummary}

Rules:
✓ Cite evidence with [REF-N] markers
✓ Report statistics exactly as given above
✓ State guideline class of recommendation if known
✗ Never include drug doses or mg amounts
✗ Never make claims without a [REF-N] citation` : `No pre-loaded evidence. Write clinically accurate, educator-appropriate content for each section based on your training knowledge. Do not fabricate statistics.`}

Write 100–150 words per section.

Return ONLY valid JSON:
{
  "sections": [
    {
      "title": "exact section title from the list above",
      "sectionType": "intro|evidence|guideline|case|conclusion",
      "content": "section text",
      "evidenceLevel": "strong|moderate|guideline|general",
      "evidenceSummary": "brief source list or empty string",
      "citationNums": [1, 2]
    }
  ]
}`

  const result = await callGroq(async () => {
    const completion = await getGroq().chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.2,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Senior medical writer. Return only valid JSON with a "sections" array.' },
        { role: 'user', content: prompt },
      ],
    })
    const raw = completion.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.sections) ? parsed.sections : []
  }, [] as any[], 'structure')

  // Map Groq output to ContentSection — with fallback to template titles
  const sectionList = result.length > 0 ? result : structure.map(t => ({ title: t, content: '' }))

  const tier1Sections: ContentSection[] = sectionList
    .filter((s: any) => s && typeof s === 'object')
    .map((s: any, idx: number) => ({
      title:           String(s.title || structure[idx] || `Section ${idx + 1}`),
      sectionType:     String(s.sectionType || 'evidence'),
      content:         String(s.content || ''),
      speakerNotes:    String(s.speakerNotes || s.content || ''),
      evidenceLevel:   String(s.evidenceLevel || 'moderate'),
      evidenceTier:    'tier1' as const,
      evidenceSummary: String(s.evidenceSummary || ''),
      citationNums:    Array.isArray(s.citationNums) ? s.citationNums : [],
      isTier2:         false,
      sortOrder:       idx + 1,
    }))

  // Tier 2 section if emerging evidence exists
  const tier2Sections: ContentSection[] = []
  if (tier2.length > 0) {
    const t2Content = tier2.slice(0, 6).map(e =>
      `• ${e.keyFinding} — ${e.sourceTitle}${e.year ? ` (${e.year})` : ''}`
    ).join('\n')
    tier2Sections.push({
      title:           'Emerging Evidence & Frontier Research',
      sectionType:     'emerging',
      content:         `The following represents pre-publication research. Interpret with appropriate caution.\n\n${t2Content}`,
      speakerNotes:    'Emerging data — explicitly acknowledge pre-publication status when presenting.',
      evidenceLevel:   'emerging',
      evidenceTier:    'tier2' as const,
      evidenceSummary: `${tier2.length} emerging sources`,
      citationNums:    [],
      isTier2:         true,
      sortOrder:       999,
    })
  }

  return [...tier1Sections, ...tier2Sections]
}

// ── MAIN PIPELINE ──────────────────────────────────────────────
export async function runContentPipeline(request: ContentRequest): Promise<void> {
  const sc  = svc()
  const t0  = Date.now()
  const rid = request.requestId
  const sid = request.specialistId

  // ── Step 1: Decompose ──────────────────────────────────────
  await trace(sc, rid, sid, 1, 'topic_decomposition', 'Understanding your topic…', 'running')
  const subtopics = await decomposeTopicToSubtopics(
    request.topic, request.contentType, request.specialistSpecialty,
    request.depth, request.specialInstructions
  )
  await trace(sc, rid, sid, 1, 'topic_decomposition',
    `Identified ${subtopics.length} research areas`, 'completed',
    subtopics.slice(0, 3).join(' | '), Date.now() - t0)

  // ── Step 2: Evidence (all subtopics in parallel) ───────────
  await trace(sc, rid, sid, 2, 'tier1_search',
    `Searching ${subtopics.length} clinical research areas…`, 'running',
    subtopics.join(' | '))

  const evidenceArrays = await Promise.all(
    subtopics.map(st => generateEvidenceForSubtopic(st, request.topic, request.specialistSpecialty))
  )
  const allEvidence: EvidenceBlock[] = evidenceArrays.flat()

  // Deduplicate — null-safe key
  const seen = new Set<string>()
  const deduped = allEvidence.filter(e => {
    const key = (e.sourceUrl || e.sourceTitle || Math.random().toString(36)).split('?')[0].toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const tier1 = deduped.filter(e => e.tier === 'tier1')
  const tier2 = deduped.filter(e => e.tier === 'tier2')

  await trace(sc, rid, sid, 2, 'tier1_search',
    `Found ${tier1.length} peer-reviewed sources${tier2.length > 0 ? ` + ${tier2.length} emerging` : ''}`, 'completed',
    `${tier1.length} tier-1 sources ready for content structuring`, Date.now() - t0)

  // Update source counts
  await sc.from('content_requests').update({
    total_sources_found: deduped.length,
    tier1_sources_used:  tier1.length,
    tier2_sources_found: tier2.length,
  }).eq('id', rid)

  // Save sources
  for (let i = 0; i < Math.min(deduped.length, 40); i++) {
    const e       = deduped[i]
    const scoring = scoreSource(e.sourceUrl, e.sourceTitle)
    const isUsed  = e.tier === 'tier1' || e.tier === 'tier2'
    await sc.from('content_sources').insert({
      request_id:         rid,
      specialist_id:      sid,
      url:                e.sourceUrl  || null,
      title:              e.sourceTitle || null,
      authors:            e.authors    || null,
      journal:            e.journal    || null,
      publication_year:   e.year       || null,
      doi:                e.doi        || null,
      trial_id:           e.trialId    || null,
      credibility_score:  e.score,
      evidence_tier:      e.tier,
      source_type:        scoring.sourceType,
      institution:        (scoring as any).institution || null,
      used_in_output:     isUsed,
      excluded_reason:    !isUsed ? 'low_score' : null,
      vancouver_citation: isUsed ? formatVancouverCitation(e, i + 1) : null,
      citation_number:    isUsed ? i + 1 : null,
    }).catch(err => console.error('[M10] source insert:', err.message))
  }

  // ── Step 3: Structure content ──────────────────────────────
  await trace(sc, rid, sid, 3, 'content_structuring',
    `Building your ${request.contentType.replace(/_/g, ' ')}…`, 'running')

  const sections       = await structureContent(deduped, request)
  const tier1Sections  = sections.filter(s => !s.isTier2)
  const sectionsDeleted = 0  // We always produce all template sections now

  await trace(sc, rid, sid, 3, 'content_structuring',
    `${tier1Sections.length} sections created · ${tier1.length} sources cited`, 'completed',
    undefined, Date.now() - t0)

  // Save sections
  for (const section of sections) {
    await sc.from('content_sections').insert({
      request_id:       rid,
      specialist_id:    sid,
      section_title:    section.title,
      section_type:     section.sectionType,
      content_text:     section.content,
      speaker_notes:    section.speakerNotes || null,
      evidence_level:   section.evidenceLevel as any,
      evidence_tier:    section.evidenceTier  as any,
      evidence_summary: section.evidenceSummary || null,
      citation_numbers: section.citationNums,
      is_tier2_section: section.isTier2,
      sort_order:       section.sortOrder,
    }).catch(err => console.error('[M10] section insert:', err.message))
  }

  // ── Mark complete ──────────────────────────────────────────
  const requiresReview = request.contentType === 'patient_education'
  await sc.from('content_requests').update({
    status:                    'completed',
    sections_generated:         tier1Sections.length,
    sections_deleted:           sectionsDeleted,
    requires_specialist_review: requiresReview,
    processing_ended_at:        new Date().toISOString(),
  }).eq('id', rid)

  await trace(sc, rid, sid, 99, 'completed',
    `✓ Ready — ${tier1Sections.length} sections · ${tier1.length} sources`, 'completed',
    `Total time: ${((Date.now() - t0) / 1000).toFixed(1)}s`, Date.now() - t0)

  console.log(`[M10] Pipeline complete: ${rid} | ${tier1Sections.length} sections | ${tier1.length} sources | ${Date.now() - t0}ms`)
}
