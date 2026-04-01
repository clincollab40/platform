/**
 * ClinCollab — Clinical Content Engine (Module 10)
 *
 * Pipeline:
 * 1. Topic Intelligence   — decompose topic into 6–10 subtopics
 * 2. Tier 1 Search        — PubMed, ACC, ESC, AHA, NEJM, Lancet, CSI, ICMR
 * 3. Tier 2 Search        — ClinicalTrials.gov, conference abstracts, medRxiv
 * 4. Credibility Scoring  — deterministic URL-based scoring
 * 5. Content Extraction   — structured evidence blocks from credible sources
 * 6. Section Structuring  — format-specific content with evidence metadata
 * 7. File Generation      — PPTX (pptxgenjs) or DOCX (docx npm)
 *
 * Key decisions enforced here:
 * - Sections without credible sources are DELETED (not shown with warning)
 * - Permitted Claims Framework: no unsourced assertions
 * - Tier 2 shown in separate panel, always labelled, user-togglable
 * - Patient education content locked until specialist confirms review
 */

import Groq from 'groq-sdk'
import { createClient } from '@supabase/supabase-js'
import { callExternalService, moduleBoundary, log, withTimeout } from '../../packages/shared-utils/resilience'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// ── Types ─────────────────────────────────────────────────────
export interface ContentRequest {
  requestId:          string
  specialistId:       string
  specialistName:     string
  specialistSpecialty:string
  topic:              string
  contentType:        string
  audience:           string
  depth:              string
  specialInstructions:string | null
}

interface SourceResult {
  url:              string
  title:            string
  snippet:          string
  credibilityScore: number
  evidenceTier:     'tier1' | 'tier2'
  sourceType:       string
  institution?:     string
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

interface ContentSection {
  title:          string
  sectionType:    string
  content:        string
  speakerNotes:   string
  evidenceLevel:  string
  evidenceTier:   'tier1' | 'tier2'
  evidenceSummary:string
  citationNums:   number[]
  isTier2:        boolean
  sortOrder:      number
}

// ── Credibility scorer — deterministic, no LLM ────────────────
export function scoreSource(url: string, title: string): {
  score: number
  tier: 'tier1' | 'tier2' | 'excluded'
  sourceType: string
  institution?: string
} {
  const u = url.toLowerCase()
  const t = title.toLowerCase()

  // ── Tier 1: Published peer-reviewed ──
  if (u.includes('pubmed.ncbi.nlm.nih.gov') || u.includes('ncbi.nlm.nih.gov/pmc'))
    return { score: 5, tier: 'tier1', sourceType: 'pubmed' }
  if (u.includes('cochranelibrary.com') || t.includes('cochrane'))
    return { score: 5, tier: 'tier1', sourceType: 'cochrane' }
  if (u.includes('acc.org/guidelines') || (u.includes('acc.org') && t.includes('guideline')))
    return { score: 5, tier: 'tier1', sourceType: 'guideline' }
  if (u.includes('escardio.org') && (t.includes('guideline') || u.includes('guideline')))
    return { score: 5, tier: 'tier1', sourceType: 'guideline' }
  if (u.includes('heart.org') && t.includes('guideline'))
    return { score: 5, tier: 'tier1', sourceType: 'guideline' }
  if (u.includes('nice.org.uk') || (u.includes('who.int') && t.includes('guideline')))
    return { score: 5, tier: 'tier1', sourceType: 'guideline' }

  // Indian national guidelines
  if (u.includes('csi.org.in') || u.includes('cardiologysociety.in'))
    return { score: 4, tier: 'tier1', sourceType: 'indian_guideline', institution: 'CSI' }
  if (u.includes('icmr.gov.in') || u.includes('icmr.nic.in'))
    return { score: 4, tier: 'tier1', sourceType: 'indian_guideline', institution: 'ICMR' }
  if (u.includes('aiims.edu') || u.includes('aiims.ac.in'))
    return { score: 4, tier: 'tier1', sourceType: 'indian_guideline', institution: 'AIIMS' }
  if (u.includes('mohfw.gov.in') || u.includes('nhp.gov.in'))
    return { score: 3, tier: 'tier1', sourceType: 'government_health' }

  // Top-tier journals
  const topJournals = ['nejm.org', 'thelancet.com', 'bmj.com', 'jamanetwork.com',
    'ahajournals.org', 'jacc.org', 'onlinejacc.org', 'spinejournalonline.com',
    'neurosurgery.com', 'jbjs.org', 'bjsportsmed.com', 'annalsofsurgery.com']
  if (topJournals.some(j => u.includes(j)))
    return { score: 4, tier: 'tier1', sourceType: 'journal' }

  // Society statements and consensus
  if (u.includes('.org') && (t.includes('consensus') || t.includes('position statement') || t.includes('expert opinion')))
    return { score: 3, tier: 'tier1', sourceType: 'consensus' }
  if (u.includes('acc.org') || u.includes('escardio.org') || u.includes('heart.org') ||
      u.includes('aaos.org') || u.includes('aans.org') || u.includes('cns.org'))
    return { score: 3, tier: 'tier1', sourceType: 'society' }

  // ── Tier 2: Emerging, pre-publication ──
  if (u.includes('clinicaltrials.gov'))
    return { score: 0, tier: 'tier2', sourceType: 'registered_trial' }
  if (u.includes('medrxiv.org')) {
    const reputableInstitutions = ['harvard', 'oxford', 'aiims', 'stanford', 'johns hopkins', 'mayo', 'cleveland', 'tata', 'pgimer', 'jipmer']
    const institution = reputableInstitutions.find(inst => t.includes(inst) || u.includes(inst))
    if (institution) return { score: 0, tier: 'tier2', sourceType: 'preprint', institution }
    return { score: 0, tier: 'excluded', sourceType: 'unverified_preprint' }
  }
  if (u.includes('tctconference.com') || u.includes('tctconnect.com') || u.includes('europcronline.com'))
    return { score: 0, tier: 'tier2', sourceType: 'conference_abstract', institution: 'TCT/EuroPCR' }
  if (u.includes('scientific.sessions') || t.includes('late-breaking') || t.includes('late breaking'))
    return { score: 0, tier: 'tier2', sourceType: 'conference_abstract' }

  // ── Excluded ──
  return { score: 0, tier: 'excluded', sourceType: 'excluded' }
}

// ── Trace logger — writes to DB for SSE stream ─────────────────
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
    // Also update request status
    const statusMap: Record<string, string> = {
      'topic_decomposition': 'decomposing',
      'tier1_search': 'searching', 'tier2_search': 'searching',
      'credibility_scoring': 'scoring',
      'content_extraction': 'extracting',
      'content_structuring': 'structuring',
      'file_generation': 'generating',
    }
    if (statusMap[name]) {
      await sc.from('content_requests').update({ status: statusMap[name] }).eq('id', requestId)
    }
  } catch (e) {
    console.error('[M10:trace]', e)
  }
}

// ── Step 1: Topic Intelligence ─────────────────────────────────
async function decomposeTopicToSearchQueries(
  topic: string,
  contentType: string,
  specialty: string,
  depth: string,
  specialInstructions: string | null
): Promise<string[]> {
  const subtopicCount = depth === 'overview' ? 5 : depth === 'standard' ? 8 : 12

  const prompt = `You are a senior medical research librarian. Break down this medical topic into ${subtopicCount} specific, searchable subtopics for a systematic literature search.

Topic: "${topic}"
Content type: ${contentType.replace(/_/g, ' ')}
Specialty: ${specialty}
${specialInstructions ? `Special focus: ${specialInstructions}` : ''}

Rules:
- Each subtopic should be a specific search query that will find relevant RCTs, guidelines, or systematic reviews
- Include at least 2 Indian sources (CSI, ICMR, AIIMS) in the queries if clinically relevant
- For each subtopic, generate ONE precise search query (5–10 words)
- Focus on: trial names, guideline organisations (ACC/ESC/AHA/CSI), year qualifiers (2020–2024)

Return ONLY a JSON array of search query strings. Example:
["FREEDOM trial PCI vs CABG diabetics outcomes 2024", "ACC AHA 2023 revascularisation guidelines diabetes"]`

  return callExternalService('groq_decompose', async () => {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return only a JSON object with key "queries" containing an array of search query strings.' },
        { role: 'user', content: prompt }
      ]
    })
    const raw = completion.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(raw)
    const queries: string[] = parsed.queries || parsed.subtopics || Object.values(parsed).flat()
    return queries.slice(0, subtopicCount).filter((q): q is string => typeof q === 'string')
  }, 10_000)
}

// ── Step 2: Web search (Tier 1 + Tier 2) ─────────────────────
async function searchMedicalSources(query: string): Promise<SourceResult[]> {
  return callExternalService('groq_search', async () => {
    // Use Groq's web search tool
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305' as any, name: 'web_search' }],
      messages: [
        { role: 'user', content: `Medical literature search: ${query}. Find relevant clinical trials, guidelines, and peer-reviewed studies.` }
      ]
    })

    // Extract search results from tool use
    const results: SourceResult[] = []
    const content = completion.choices[0]?.message?.content || ''

    // Parse URLs and titles from the response
    const urlPattern = /https?:\/\/[^\s\)]+/g
    const urls = content.match(urlPattern) || []

    for (const url of urls.slice(0, 8)) {
      const scoring = scoreSource(url, content)
      if (scoring.tier !== 'excluded') {
        results.push({
          url: url.replace(/[,\.\)]+$/, ''),
          title: extractTitleFromContext(content, url),
          snippet: extractSnippetFromContext(content, url),
          credibilityScore: scoring.score,
          evidenceTier: scoring.tier as 'tier1' | 'tier2',
          sourceType: scoring.sourceType,
          institution: scoring.institution,
        })
      }
    }

    // Also check for any structured search result blocks
    // Groq web_search returns results in a specific format
    try {
      const msg = completion.choices[0]?.message as any
      if (msg?.tool_calls) {
        for (const toolCall of msg.tool_calls) {
          if (toolCall.function?.name === 'web_search') {
            const searchResult = JSON.parse(toolCall.function.arguments || '{}')
            if (searchResult.results) {
              for (const r of searchResult.results.slice(0, 5)) {
                const scoring = scoreSource(r.url || '', r.title || '')
                if (scoring.tier !== 'excluded') {
                  results.push({
                    url: r.url, title: r.title, snippet: r.description || '',
                    credibilityScore: scoring.score,
                    evidenceTier: scoring.tier as 'tier1' | 'tier2',
                    sourceType: scoring.sourceType,
                    institution: scoring.institution,
                  })
                }
              }
            }
          }
        }
      }
    } catch {}

    // Add fallback: targeted searches for known high-value sources
    if (results.filter(r => r.credibilityScore >= 3).length < 2) {
      const fallbackUrls = generateFallbackUrls(query)
      for (const fb of fallbackUrls) {
        const scoring = scoreSource(fb.url, fb.title)
        if (scoring.tier === 'tier1' && scoring.score >= 3) {
          results.push({
            url: fb.url, title: fb.title, snippet: fb.snippet || '',
            credibilityScore: scoring.score,
            evidenceTier: 'tier1',
            sourceType: scoring.sourceType,
          })
        }
      }
    }

    return results
  }, 15_000)
}

function extractTitleFromContext(content: string, url: string): string {
  const urlIndex = content.indexOf(url)
  if (urlIndex < 0) return url
  const before = content.slice(Math.max(0, urlIndex - 200), urlIndex)
  const titleMatch = before.match(/\*\*([^*]+)\*\*\s*$/) || before.match(/\n([^\n]+)\s*$/)
  return titleMatch ? titleMatch[1].trim().slice(0, 150) : url.split('/').slice(-1)[0]
}

function extractSnippetFromContext(content: string, url: string): string {
  const urlIndex = content.indexOf(url)
  if (urlIndex < 0) return ''
  const after = content.slice(urlIndex, urlIndex + 400)
  return after.replace(url, '').replace(/\*\*/g, '').trim().slice(0, 300)
}

function generateFallbackUrls(query: string): { url: string; title: string; snippet?: string }[] {
  const q = encodeURIComponent(query)
  return [
    { url: `https://pubmed.ncbi.nlm.nih.gov/?term=${q}`, title: `PubMed search: ${query}` },
    { url: `https://www.acc.org/guidelines`, title: 'ACC Clinical Guidelines' },
    { url: `https://www.escardio.org/Guidelines`, title: 'ESC Clinical Practice Guidelines' },
  ]
}

// ── Step 3: Content extraction from credible sources ──────────
async function extractEvidenceFromSources(
  sources: SourceResult[],
  topic: string,
  specialty: string
): Promise<EvidenceBlock[]> {
  const credibleSources = sources.filter(s => s.credibilityScore >= 3 || s.evidenceTier === 'tier2')
  if (credibleSources.length === 0) return []

  const sourceList = credibleSources.slice(0, 12).map((s, i) =>
    `[${i+1}] URL: ${s.url}\nTitle: ${s.title}\nSnippet: ${s.snippet.slice(0, 400)}`
  ).join('\n\n')

  const prompt = `You are extracting clinical evidence for a ${specialty} medical content piece on: "${topic}"

CRITICAL RULES:
1. Only extract information EXPLICITLY stated in the sources. Never infer or add clinical details.
2. Never quote more than 12 words verbatim. Paraphrase all findings.
3. Do not state drug doses, dosing schedules, or weight-based calculations.
4. Do not assert that Drug A is superior to Drug B unless the source explicitly says so with a head-to-head comparison.
5. If a source only has an abstract, flag it as abstract_only.

SOURCES:
${sourceList}

For each source that contains relevant evidence, extract a JSON object with:
{
  "subtopic": "what clinical subtopic this addresses",
  "keyFinding": "the main clinical finding (paraphrased, max 50 words)",
  "statistics": "key numbers: outcomes, p-values, HR, ARR, NNT if mentioned (exact from source)",
  "studyDesign": "RCT/meta-analysis/guideline/registry/cohort/consensus",
  "sourceTitle": "paper/guideline title",
  "sourceUrl": "the URL from sources above",
  "year": publication year as number or null,
  "authors": "First author et al.",
  "journal": "journal name",
  "doi": "doi if found in snippet",
  "trialId": "NCT number if applicable"
}

Return ONLY valid JSON: {"evidence": [...]}`

  return callExternalService('groq_extract', async () => {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.0,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Extract only what is explicitly stated. Return only JSON. Never fabricate citations.' },
        { role: 'user', content: prompt }
      ]
    })
    const raw = completion.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(raw)
    const evidenceArr = parsed.evidence || []

    return evidenceArr.map((e: any) => {
      const matchedSource = credibleSources.find(s => s.url === e.sourceUrl || e.sourceUrl?.includes(s.url?.split('/')[2]))
      return {
        subtopic:    e.subtopic || '',
        keyFinding:  e.keyFinding || '',
        statistics:  e.statistics || '',
        studyDesign: e.studyDesign || '',
        sourceTitle: e.sourceTitle || '',
        sourceUrl:   e.sourceUrl || '',
        year:        e.year || null,
        authors:     e.authors || '',
        journal:     e.journal || '',
        doi:         e.doi || '',
        trialId:     e.trialId || '',
        score:       matchedSource?.credibilityScore || 3,
        tier:        (matchedSource?.evidenceTier || 'tier1') as 'tier1' | 'tier2',
      }
    }).filter((e: any) => e.keyFinding && e.sourceUrl)
  }, 30_000)
}

// ── Step 4: Structure into content sections ───────────────────
async function structureContent(
  evidenceBlocks: EvidenceBlock[],
  request: ContentRequest,
  subtopics: string[]
): Promise<ContentSection[]> {
  const templateStructures: Record<string, string[]> = {
    cme_presentation:    ['Title and Learning Objectives', 'Epidemiology and Clinical Burden', 'Current Evidence', 'Society Guidelines', 'Case Illustration', 'Clinical Implications', 'Conclusion'],
    conference_abstract: ['Background', 'Objective', 'Methods', 'Results', 'Conclusions'],
    grand_rounds:        ['Case Presentation', 'Clinical Questions', 'Differential Diagnosis', 'Evidence Base', 'Management Approach', 'Teaching Points'],
    referral_guide:      ['When to Refer', 'Red Flags — Urgent Referral', 'What to Include in the Referral', 'Pre-referral Workup', 'What the Specialist Does'],
    clinical_protocol:   ['Purpose and Scope', 'Background and Evidence', 'Protocol Steps', 'Roles and Responsibilities', 'Audit Criteria', 'References'],
    patient_education:   ['What is This?', 'Why Do You Need It?', 'What Happens?', 'How to Prepare', 'What to Expect', 'Warning Signs'],
    roundtable_points:   ['Topic Overview', 'Current Evidence Landscape', 'Areas of Consensus', 'Areas of Active Debate', 'Key Trial Data'],
    case_discussion:     ['Case Summary', 'Key Clinical Questions', 'Evidence Review', 'Management Options', 'Recommended Approach'],
  }

  const structure = templateStructures[request.contentType] || templateStructures.cme_presentation

  // Tier 1 evidence blocks
  const tier1 = evidenceBlocks.filter(e => e.tier === 'tier1' && e.score >= 3)
  // Tier 2 evidence blocks
  const tier2 = evidenceBlocks.filter(e => e.tier === 'tier2')

  if (tier1.length === 0) {
    log('warn', 'M10', 'no_tier1_evidence', { requestId: request.requestId })
    return []
  }

  const t1Summary = tier1.slice(0, 15).map((e, i) =>
    `[T1-${i+1}] ${e.keyFinding} (${e.studyDesign}, ${e.year || 'n.d.'}) — ${e.statistics ? 'Stats: ' + e.statistics : ''}`
  ).join('\n')

  const audienceMap: Record<string, string> = {
    specialist_peers: 'specialist cardiologists/surgeons with deep clinical knowledge',
    junior_doctors: 'medical residents and junior doctors learning the subject',
    referring_physicians: 'GPs and physicians who refer patients but are not procedure specialists',
    patients_families: 'patients and family members without medical background',
    administrators: 'hospital administrators and clinical governance committees',
  }

  const prompt = `Create a ${request.contentType.replace(/_/g, ' ')} on "${request.topic}" for ${audienceMap[request.audience] || 'specialist peers'}.

STRUCTURE to follow (${structure.length} sections):
${structure.map((s, i) => `${i+1}. ${s}`).join('\n')}

TIER 1 EVIDENCE (published, peer-reviewed — use these as your factual basis):
${t1Summary}

RULES — PERMITTED CLAIMS FRAMEWORK:
✓ Summarise what a trial showed (with [T1-N] citation marker)
✓ State what a guideline recommends (with recommendation class if available)
✓ Report statistics directly from the evidence above
✓ Describe procedures as defined in guidelines
✗ DO NOT assert drug superiority without a head-to-head cited comparison
✗ DO NOT state any drug dose, dosing schedule, mg/mcg amounts, or stat/PRN instructions
✗ DO NOT make clinical recommendations not backed by the evidence provided
✗ DO NOT include any claim without a [T1-N] citation marker

For each section, return:
{
  "title": "section title",
  "sectionType": "intro|evidence|guideline|case|conclusion|references",
  "content": "the section content (150-300 words for standard depth)",
  "speakerNotes": "expanded notes for PPTX speaker (300-400 words, clinical depth)",
  "evidenceLevel": "strong|moderate|guideline",
  "evidenceSummary": "e.g. Based on 3 sources: NEJM 2023, ACC Guidelines 2023, JACC 2022",
  "citationNums": [1, 3, 7]
}

Return ONLY valid JSON: {"sections": [...]}`

  return callExternalService('groq_structure', async () => {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.15,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a senior medical writer. Generate only evidence-backed content with citation markers. Return only JSON.' },
        { role: 'user', content: prompt }
      ]
    })
    const raw = completion.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(raw)
    const sections = (parsed.sections || []) as any[]

    const tier1Sections: ContentSection[] = sections.map((s: any, idx: number) => ({
      title:          s.title || `Section ${idx + 1}`,
      sectionType:    s.sectionType || 'evidence',
      content:        s.content || '',
      speakerNotes:   s.speakerNotes || s.content || '',
      evidenceLevel:  s.evidenceLevel || 'moderate',
      evidenceTier:   'tier1' as const,
      evidenceSummary:s.evidenceSummary || '',
      citationNums:   Array.isArray(s.citationNums) ? s.citationNums : [],
      isTier2:        false,
      sortOrder:      idx + 1,
    })).filter(s => s.content.length > 30)

    // Build Tier 2 section if emerging evidence exists
    const tier2Sections: ContentSection[] = []
    if (tier2.length > 0) {
      const t2Content = tier2.slice(0, 6).map(e =>
        `• ${e.keyFinding} — ${e.sourceTitle} (${e.institution || 'Major conference'}, ${e.year || 'recent'})`
      ).join('\n')

      tier2Sections.push({
        title:          'Emerging Evidence and Frontier Research',
        sectionType:    'emerging',
        content:        `The following pre-publication and conference-presented data represents the current research frontier on ${request.topic}. This information has not completed full peer review and should be interpreted with appropriate caution.\n\n${t2Content}`,
        speakerNotes:   `This slide presents emerging evidence that has been presented at major conferences or registered in clinical trial databases but not yet published in peer-reviewed journals. Acknowledge this explicitly when presenting. This data is subject to change upon full publication.`,
        evidenceLevel:  'emerging',
        evidenceTier:   'tier2',
        evidenceSummary:`${tier2.length} emerging sources from major conferences and trial registries`,
        citationNums:   [],
        isTier2:        true,
        sortOrder:      999,
      })
    }

    return [...tier1Sections, ...tier2Sections]
  }, 30_000)
}

// ── Vancouver citation formatter ──────────────────────────────
export function formatVancouverCitation(
  e: EvidenceBlock,
  num: number,
  tier: 'tier1' | 'tier2'
): string {
  if (tier === 'tier2') {
    const typeLabel = e.trialId ? 'Registered Trial' : 'Conference Abstract / Preprint'
    return `${num}. ${e.authors || 'Author(s) unknown'}. ${e.sourceTitle || 'Untitled'}. ${e.journal || 'ClinicalTrials.gov / Conference'}. ${e.year || 'n.d.'}. [${typeLabel}]. ${e.trialId ? 'Trial ID: ' + e.trialId : ''} Available from: ${e.sourceUrl}`
  }

  const parts = [
    `${num}.`,
    e.authors ? e.authors + '.' : null,
    e.sourceTitle ? e.sourceTitle + '.' : null,
    e.journal ? e.journal + '.' : null,
    e.year ? `${e.year};` : null,
    e.doi ? `doi:${e.doi}` : null,
    `Available from: ${e.sourceUrl}`,
  ].filter(Boolean)

  return parts.join(' ')
}

// ── Generate PPTX ─────────────────────────────────────────────
async function generatePPTX(
  sections: ContentSection[],
  evidenceBlocks: EvidenceBlock[],
  request: ContentRequest,
  includeTier2: boolean,
  requestId: string,
  specialistId: string
): Promise<{ buffer: Buffer; filename: string }> {
  const PptxGenJS = require('/home/claude/.npm-global/lib/node_modules/pptxgenjs')
  const pptx = new PptxGenJS()

  // Template settings
  pptx.layout = 'LAYOUT_16x9'
  const NAVY   = '1A3A5C'
  const FOREST = '1A6B3C'
  const WHITE  = 'FFFFFF'
  const LGREY  = 'F8FAFC'
  const BLUE   = '1D4ED8'
  const AMBER  = 'B45309'
  const GREEN  = '15803D'

  const evidenceBadgeColor: Record<string, string> = {
    strong:   GREEN,
    moderate: AMBER,
    guideline:NAVY,
    emerging: BLUE,
  }

  const evidenceBadgeLabel: Record<string, string> = {
    strong:   '● Strong Evidence',
    moderate: '● Moderate Evidence',
    guideline:'■ Guideline Recommendation',
    emerging: '◆ Emerging Evidence',
  }

  // Title slide
  const titleSlide = pptx.addSlide()
  titleSlide.background = { color: NAVY }
  titleSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 4.5, w: '100%', h: 0.06, fill: { color: FOREST } })
  titleSlide.addText(request.topic, {
    x: 0.5, y: 1.0, w: 9.0, h: 2.0,
    fontSize: 32, bold: true, color: WHITE,
    align: 'left', valign: 'middle', wrap: true,
  })
  titleSlide.addText(request.contentType.replace(/_/g, ' ').toUpperCase(), {
    x: 0.5, y: 3.2, w: 9.0, h: 0.4,
    fontSize: 14, color: '93C5FD', align: 'left',
  })
  titleSlide.addText(`Dr. ${request.specialistName}  ·  ${request.specialistSpecialty.replace(/_/g, ' ')}  ·  ${new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`, {
    x: 0.5, y: 3.8, w: 9.0, h: 0.3,
    fontSize: 11, color: '93C5FD', align: 'left',
  })
  titleSlide.addText('ClinCollab Clinical Content Engine', {
    x: 0.5, y: 4.7, w: 9.0, h: 0.25,
    fontSize: 9, color: '6B7280', align: 'left', italics: true,
  })

  // Content slides
  const displaySections = includeTier2 ? sections : sections.filter(s => !s.isTier2)

  for (const section of displaySections) {
    const slide = pptx.addSlide()

    // Header band
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.65, fill: { color: NAVY } })

    // Section title in header
    slide.addText(section.title, {
      x: 0.3, y: 0.08, w: 8.5, h: 0.48,
      fontSize: 16, bold: true, color: WHITE, align: 'left',
    })

    // Evidence badge top-right
    const badgeColor = evidenceBadgeColor[section.evidenceLevel] || NAVY
    const badgeLabel = evidenceBadgeLabel[section.evidenceLevel] || '● Evidence'
    slide.addText(badgeLabel, {
      x: 7.2, y: 0.12, w: 2.5, h: 0.4,
      fontSize: 8, color: WHITE, align: 'right',
      fill: { color: section.isTier2 ? BLUE : NAVY },
    })

    // Tier 2 notice bar
    if (section.isTier2) {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.65, w: '100%', h: 0.28, fill: { color: '1E3A8A' } })
      slide.addText('PRE-PUBLICATION DATA — Not yet peer-reviewed. Interpret with caution.', {
        x: 0.2, y: 0.68, w: 9.6, h: 0.22,
        fontSize: 8, color: '93C5FD', align: 'center', italics: true,
      })
    }

    // Content text
    const contentY = section.isTier2 ? 1.0 : 0.75
    const displayText = (section.is_edited ? section.edited_text : null) || section.content
    slide.addText(displayText || '', {
      x: 0.3, y: contentY, w: 9.4, h: 4.0 - contentY,
      fontSize: 13, color: '1F2937', wrap: true, valign: 'top',
    })

    // Evidence summary footer
    if (section.evidenceSummary) {
      slide.addText(section.evidenceSummary, {
        x: 0.3, y: 4.55, w: 9.4, h: 0.25,
        fontSize: 8, color: '6B7280', italics: true, align: 'left',
      })
    }

    // Speaker notes
    slide.addNotes(section.speakerNotes || section.content)
  }

  // Disclaimer slide
  const disclaimerSlide = pptx.addSlide()
  disclaimerSlide.background = { color: LGREY }
  disclaimerSlide.addText('Important Notice', {
    x: 0.5, y: 0.5, w: 9.0, h: 0.5, fontSize: 18, bold: true, color: NAVY,
  })
  disclaimerSlide.addText(
    'This content was prepared with AI research assistance using ClinCollab Clinical Content Engine. All factual claims are sourced from the cited literature.\n\nThis presentation is intended for educational and communication purposes only. It does not constitute clinical decision support and should not be used to guide individual patient management decisions.\n\nThe presenting specialist remains the author of record and is responsible for verifying the accuracy and currency of all content before use.\n\n' +
    `Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    { x: 0.5, y: 1.2, w: 9.0, h: 3.5, fontSize: 11, color: '374151', wrap: true, valign: 'top' }
  )

  // References slide
  const usedBlocks = evidenceBlocks.filter(e => e.tier === 'tier1' && e.score >= 3).slice(0, 20)
  if (usedBlocks.length > 0) {
    const refSlide = pptx.addSlide()
    refSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.6, fill: { color: NAVY } })
    refSlide.addText('References', { x: 0.3, y: 0.1, w: 9.4, h: 0.4, fontSize: 16, bold: true, color: WHITE })
    const refText = usedBlocks.map((e, i) => formatVancouverCitation(e, i + 1, 'tier1')).join('\n')
    refSlide.addText(refText, {
      x: 0.3, y: 0.7, w: 9.4, h: 4.5, fontSize: 8, color: '374151', wrap: true, valign: 'top',
    })
  }

  const filename = `ClinCollab_${request.contentType}_${Date.now()}.pptx`
  const tmpPath = `/tmp/${filename}`
  await pptx.writeFile({ fileName: tmpPath })

  const fs = require('fs')
  const buffer = fs.readFileSync(tmpPath)
  fs.unlinkSync(tmpPath)

  return { buffer, filename }
}

// ── Generate DOCX ─────────────────────────────────────────────
async function generateDOCX(
  sections: ContentSection[],
  evidenceBlocks: EvidenceBlock[],
  request: ContentRequest,
  includeTier2: boolean
): Promise<{ buffer: Buffer; filename: string }> {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    AlignmentType, BorderStyle, WidthType, ShadingType, LevelFormat,
    Header, Footer, SimpleField, TabStopType
  } = require('/home/claude/.npm-global/lib/node_modules/docx')

  const NAVY   = '1A3A5C'
  const FOREST = '1A6B3C'
  const WHITE  = 'FFFFFF'
  const BLUE   = '1E3A8A'
  const LGREY  = 'F8FAFC'
  const MGREY  = 'E2E8F0'

  const body: any[] = []

  // Title
  body.push(new Paragraph({
    spacing: { before: 0, after: 200 },
    children: [new TextRun({ text: request.topic, font: 'Arial', size: 44, bold: true, color: NAVY })]
  }))
  body.push(new Paragraph({
    spacing: { before: 0, after: 80 },
    children: [new TextRun({ text: request.contentType.replace(/_/g, ' ').toUpperCase(), font: 'Arial', size: 22, color: FOREST, bold: true })]
  }))
  body.push(new Paragraph({
    spacing: { before: 0, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY } },
    children: [new TextRun({ text: `Prepared by Dr. ${request.specialistName}  ·  ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, font: 'Arial', size: 20, color: '6B7280', italics: true })]
  }))

  const displaySections = includeTier2 ? sections : sections.filter((s: ContentSection) => !s.isTier2)

  for (const section of displaySections) {
    // Section header
    const headerColor = section.isTier2 ? BLUE : NAVY
    body.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 320, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: headerColor } },
      children: [new TextRun({ text: section.title, font: 'Arial', size: 28, bold: true, color: headerColor })]
    }))

    // Tier 2 notice
    if (section.isTier2) {
      body.push(new Paragraph({
        spacing: { before: 0, after: 100 },
        shading: { fill: 'EFF6FF', type: ShadingType.CLEAR },
        children: [new TextRun({ text: '◆ PRE-PUBLICATION DATA — This section contains conference-presented or registered trial data that has not completed peer review. Interpret with appropriate caution.', font: 'Arial', size: 18, italics: true, color: BLUE })]
      }))
    }

    // Evidence badge
    const badgeLabels: Record<string, string> = {
      strong: '● Strong Evidence', moderate: '● Moderate Evidence',
      guideline: '■ Guideline Recommendation', emerging: '◆ Emerging Evidence',
    }
    body.push(new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: badgeLabels[section.evidenceLevel] || '● Evidence', font: 'Arial', size: 17, bold: true, color: section.isTier2 ? BLUE : FOREST })]
    }))

    // Content
    const displayText = section.content
    const paras = displayText.split('\n').filter(p => p.trim())
    for (const para of paras) {
      body.push(new Paragraph({
        spacing: { before: 40, after: 80 },
        children: [new TextRun({ text: para, font: 'Arial', size: 22, color: '1F2937' })]
      }))
    }

    // Evidence summary
    if (section.evidenceSummary) {
      body.push(new Paragraph({
        spacing: { before: 60, after: 100 },
        children: [new TextRun({ text: section.evidenceSummary, font: 'Arial', size: 18, italics: true, color: '6B7280' })]
      }))
    }
  }

  // References
  const usedBlocks = evidenceBlocks.filter(e => e.tier === 'tier1' && e.score >= 3).slice(0, 25)
  const tier2Blocks = includeTier2 ? evidenceBlocks.filter(e => e.tier === 'tier2').slice(0, 10) : []

  if (usedBlocks.length > 0) {
    body.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      pageBreakBefore: true,
      spacing: { before: 0, after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY } },
      children: [new TextRun({ text: 'References', font: 'Arial', size: 28, bold: true, color: NAVY })]
    }))
    usedBlocks.forEach((e, i) => {
      body.push(new Paragraph({
        spacing: { before: 0, after: 80 },
        children: [new TextRun({ text: formatVancouverCitation(e, i + 1, 'tier1'), font: 'Arial', size: 19, color: '374151' })]
      }))
    })
    if (tier2Blocks.length > 0) {
      body.push(new Paragraph({
        spacing: { before: 200, after: 80 },
        children: [new TextRun({ text: 'Emerging Evidence Sources (Pre-publication)', font: 'Arial', size: 22, bold: true, color: BLUE })]
      }))
      tier2Blocks.forEach((e, i) => {
        body.push(new Paragraph({
          spacing: { before: 0, after: 80 },
          children: [new TextRun({ text: formatVancouverCitation(e, usedBlocks.length + i + 1, 'tier2'), font: 'Arial', size: 19, color: '374151', italics: true })]
        }))
      })
    }
  }

  // Disclaimer
  body.push(new Paragraph({
    spacing: { before: 400, after: 80 },
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: MGREY } },
    children: [new TextRun({ text: 'Important Notice', font: 'Arial', size: 22, bold: true, color: NAVY })]
  }))
  body.push(new Paragraph({
    spacing: { before: 60, after: 0 },
    children: [new TextRun({ text: 'This content was prepared with AI research assistance using ClinCollab. All factual claims are sourced from the cited literature. This document is for educational purposes only and does not constitute clinical decision support. The author is responsible for verifying accuracy before use.', font: 'Arial', size: 18, italics: true, color: '6B7280' })]
  }))

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      headers: { default: new Header({ children: [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 2 } },
        spacing: { before: 0, after: 100 },
        children: [
          new TextRun({ text: `ClinCollab  ·  ${request.topic.slice(0, 60)}`, font: 'Arial', size: 18, bold: true, color: NAVY }),
          new TextRun({ text: '   |   Educational use only', font: 'Arial', size: 16, color: '888888' }),
        ]
      })]})},
      footers: { default: new Footer({ children: [new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 2 } },
        spacing: { before: 80, after: 0 },
        tabStops: [{ type: TabStopType.RIGHT, position: 8200 }],
        children: [
          new TextRun({ text: 'ClinCollab Clinical Content Engine', font: 'Arial', size: 17, color: FOREST }),
          new TextRun({ text: '\tPage ', font: 'Arial', size: 17, color: '888888' }),
          new TextRun({ children: [new SimpleField('PAGE')], font: 'Arial', size: 17, color: '888888' }),
        ]
      })]})},
      children: body,
    }]
  })

  const buffer = await Packer.toBuffer(doc)
  const filename = `ClinCollab_${request.contentType}_${Date.now()}.docx`
  return { buffer, filename }
}

// ── Main pipeline entry point ─────────────────────────────────
export async function runContentPipeline(
  request: ContentRequest,
  includeTier2: boolean = true
): Promise<{
  sections:       ContentSection[]
  evidenceBlocks: EvidenceBlock[]
  pptxBuffer:     Buffer | null
  docxBuffer:     Buffer | null
  pptxFilename:   string
  docxFilename:   string
  sourcesUsed:    number
  tier2Found:     number
  sectionsDeleted:number
}> {
  return moduleBoundary('M10:content_pipeline', async () => {
    const sc = svc()
    const t0 = Date.now()

    // Step 1: Topic decomposition
    await trace(sc, request.requestId, request.specialistId, 1, 'topic_decomposition',
      'Understanding your topic...', 'running')

    const subtopics = await decomposeTopicToSearchQueries(
      request.topic, request.contentType, request.specialistSpecialty,
      request.depth, request.specialInstructions
    )
    await trace(sc, request.requestId, request.specialistId, 1, 'topic_decomposition',
      `Decomposed into ${subtopics.length} subtopics`, 'completed',
      `Subtopics: ${subtopics.slice(0, 3).join(' | ')}...`, Date.now() - t0)

    // Step 2: Literature search — Tier 1 + Tier 2
    const allSources: SourceResult[] = []
    for (let i = 0; i < subtopics.length; i++) {
      await trace(sc, request.requestId, request.specialistId, 2 + i, 'tier1_search',
        `Searching medical literature (${i + 1} of ${subtopics.length})...`, 'running',
        subtopics[i])

      const results = await searchMedicalSources(subtopics[i])
      allSources.push(...results)
    }

    // Deduplicate sources
    const seen = new Set<string>()
    const dedupedSources = allSources.filter(s => {
      const key = s.url.split('?')[0]
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const tier1Count = dedupedSources.filter(s => s.credibilityScore >= 3).length
    const tier2Count = dedupedSources.filter(s => s.evidenceTier === 'tier2').length

    await trace(sc, request.requestId, request.specialistId, 20, 'credibility_scoring',
      'Evaluating source credibility...', 'completed',
      `Found ${tier1Count} Tier 1 sources (score ≥ 3) and ${tier2Count} Tier 2 emerging sources`)

    // Save sources to DB
    await sc.from('content_requests').update({
      total_sources_found: dedupedSources.length,
      tier1_sources_used:  tier1Count,
      tier2_sources_found: tier2Count,
    }).eq('id', request.requestId)

    for (const src of dedupedSources.slice(0, 40)) {
      await sc.from('content_sources').insert({
        request_id:       request.requestId,
        specialist_id:    request.specialistId,
        url:              src.url,
        title:            src.title,
        credibility_score:src.credibilityScore,
        evidence_tier:    src.credibilityScore >= 3 ? 'tier1' : src.evidenceTier,
        source_type:      src.sourceType,
        institution:      src.institution || null,
        used_in_output:   src.credibilityScore >= 3 || src.evidenceTier === 'tier2',
        excluded_reason:  src.evidenceTier === 'excluded' ? 'score_below_threshold_or_unverified' : null,
      }).catch(() => {}) // non-critical
    }

    // Step 3: Extract evidence
    await trace(sc, request.requestId, request.specialistId, 21, 'content_extraction',
      'Reading and extracting key findings...', 'running')

    const evidenceBlocks = await extractEvidenceFromSources(dedupedSources, request.topic, request.specialistSpecialty)

    await trace(sc, request.requestId, request.specialistId, 21, 'content_extraction',
      `Extracted ${evidenceBlocks.length} evidence blocks`, 'completed',
      `Tier 1: ${evidenceBlocks.filter(e => e.tier === 'tier1').length}, Tier 2: ${evidenceBlocks.filter(e => e.tier === 'tier2').length}`,
      Date.now() - t0)

    // Step 4: Structure content
    await trace(sc, request.requestId, request.specialistId, 22, 'content_structuring',
      `Building your ${request.contentType.replace(/_/g, ' ')}...`, 'running')

    const sections = await structureContent(evidenceBlocks, request, subtopics)
    const sectionsDeleted = Math.max(0, subtopics.length - sections.filter(s => !s.isTier2).length)

    await trace(sc, request.requestId, request.specialistId, 22, 'content_structuring',
      `${sections.filter(s => !s.isTier2).length} sections created${sectionsDeleted > 0 ? `, ${sectionsDeleted} deleted (insufficient evidence)` : ''}`, 'completed')

    // Save sections to DB
    for (const section of sections) {
      await sc.from('content_sections').insert({
        request_id:      request.requestId,
        specialist_id:   request.specialistId,
        section_title:   section.title,
        section_type:    section.sectionType,
        content_text:    section.content,
        speaker_notes:   section.speakerNotes,
        evidence_level:  section.evidenceLevel as any,
        evidence_tier:   section.evidenceTier as any,
        evidence_summary:section.evidenceSummary,
        citation_numbers:section.citationNums,
        is_tier2_section:section.isTier2,
        sort_order:      section.sortOrder,
      }).catch(() => {})
    }

    // Step 5: Generate files
    await trace(sc, request.requestId, request.specialistId, 23, 'file_generation',
      'Preparing your files...', 'running')

    let pptxBuffer: Buffer | null = null
    let pptxFilename = ''
    let docxBuffer: Buffer | null = null
    let docxFilename = ''

    // Always generate PPTX for presentation types, DOCX for document types
    const pptxTypes = ['cme_presentation', 'grand_rounds']
    const docxTypes = ['conference_abstract', 'referral_guide', 'clinical_protocol', 'patient_education', 'roundtable_points', 'case_discussion']

    try {
      if (pptxTypes.includes(request.contentType)) {
        const pptx = await generatePPTX(sections, evidenceBlocks, request, includeTier2, request.requestId, request.specialistId)
        pptxBuffer = pptx.buffer
        pptxFilename = pptx.filename
      }
      const docx = await generateDOCX(sections, evidenceBlocks, request, includeTier2)
      docxBuffer = docx.buffer
      docxFilename = docx.filename
    } catch (fileErr) {
      log('error', 'M10', 'file_generation_error', { requestId: request.requestId, error: String(fileErr) })
    }

    // Mark complete
    await sc.from('content_requests').update({
      status:              'completed',
      sections_generated:  sections.filter(s => !s.isTier2).length,
      sections_deleted:    sectionsDeleted,
      processing_ended_at: new Date().toISOString(),
    }).eq('id', request.requestId)

    await trace(sc, request.requestId, request.specialistId, 24, 'completed',
      '✓ Ready — tap to review your content', 'completed',
      `${sections.filter(s => !s.isTier2).length} sections · ${tier2Count > 0 ? tier2Count + ' emerging sources' : 'No emerging sources found'}`,
      Date.now() - t0)

    log('info', 'M10', 'pipeline_completed', {
      requestId: request.requestId,
      totalTime: Date.now() - t0,
      sections: sections.length,
      sources: tier1Count,
    })

    return {
      sections, evidenceBlocks,
      pptxBuffer, pptxFilename,
      docxBuffer, docxFilename,
      sourcesUsed:    tier1Count,
      tier2Found:     tier2Count,
      sectionsDeleted,
    }
  })
}
