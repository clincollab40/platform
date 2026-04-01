import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/content/generate
 * On-demand file render from stored content_sections.
 * Does NOT re-run the research pipeline — uses cached sections only.
 * Returns a signed Supabase Storage URL valid for 7 days.
 *
 * Path: apps/web/app/api/content/generate/route.ts
 * Pipeline: ../../../../../../services/content-agent/content-pipeline.ts
 */
export async function POST(request: NextRequest) {
  const key = request.headers.get('x-internal-key') || ''
  if (process.env.INTERNAL_API_KEY && key !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { requestId, format, includeTier2, specialistId } = body
  if (!requestId || !format || !specialistId) {
    return NextResponse.json({ error: 'requestId, format, specialistId required' }, { status: 400 })
  }

  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Load the content request and sections
  const { data: req } = await sc
    .from('content_requests')
    .select('*, specialists(id, name, specialty)')
    .eq('id', requestId)
    .eq('specialist_id', specialistId)
    .single()

  if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (req.status !== 'completed') return NextResponse.json({ error: 'Content not ready' }, { status: 400 })

  const { data: sections } = await sc
    .from('content_sections')
    .select('*')
    .eq('request_id', requestId)
    .order('sort_order')

  const { data: sources } = await sc
    .from('content_sources')
    .select('*')
    .eq('request_id', requestId)
    .eq('used_in_output', true)

  const specialist = req.specialists as any
  const contentRequest = {
    requestId,
    specialistId,
    specialistName:      specialist.name,
    specialistSpecialty: specialist.specialty,
    topic:               req.topic,
    contentType:         req.content_type,
    audience:            req.audience,
    depth:               req.depth,
    specialInstructions: req.special_instructions,
  }

  // Build evidence blocks from stored sources for citation formatting
  const evidenceBlocks = (sources || []).map((s: any) => ({
    subtopic:    '',
    keyFinding:  s.title || '',
    statistics:  '',
    studyDesign: s.source_type || '',
    sourceTitle: s.title || '',
    sourceUrl:   s.url || '',
    year:        null,
    authors:     s.title?.split('.')[0] || '',
    journal:     s.journal || '',
    doi:         s.doi || '',
    trialId:     s.trial_id || '',
    score:       s.credibility_score || 3,
    tier:        (s.evidence_tier || 'tier1') as 'tier1' | 'tier2',
  }))

  // Convert DB sections to ContentSection format
  const contentSections = (sections || []).map((s: any) => ({
    title:           s.section_title,
    sectionType:     s.section_type,
    content:         s.is_edited && s.edited_text ? s.edited_text : s.content_text,
    speakerNotes:    s.speaker_notes || s.content_text,
    evidenceLevel:   s.evidence_level,
    evidenceTier:    s.evidence_tier as 'tier1' | 'tier2',
    evidenceSummary: s.evidence_summary || '',
    citationNums:    s.citation_numbers || [],
    isTier2:         s.is_tier2_section || false,
    sortOrder:       s.sort_order,
    is_edited:       s.is_edited,
    edited_text:     s.edited_text,
  }))

  try {
    const { generatePPTX, generateDOCX } = await importGenerators()

    let buffer: Buffer
    let filename: string

    if (format === 'pptx') {
      const result = await generatePPTX(contentSections, evidenceBlocks, contentRequest, includeTier2 !== false, requestId, specialistId)
      buffer = result.buffer
      filename = result.filename
    } else {
      const result = await generateDOCX(contentSections, evidenceBlocks, contentRequest, includeTier2 !== false)
      buffer = result.buffer
      filename = result.filename
    }

    // Upload to Supabase Storage
    const storagePath = `${specialistId}/${requestId}/${filename}`
    const mimeType = format === 'pptx'
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    await sc.storage.from('content-outputs').upload(storagePath, buffer, {
      contentType: mimeType, upsert: true,
    })

    const { data: signed } = await sc.storage
      .from('content-outputs')
      .createSignedUrl(storagePath, 7 * 24 * 3600)

    const fileUrl = signed?.signedUrl || null
    const sizeKb  = Math.round(buffer.length / 1024)

    // Log output record
    await sc.from('content_outputs').upsert({
      request_id:    requestId,
      specialist_id: specialistId,
      format,
      file_name:     filename,
      file_url:      fileUrl,
      file_size_kb:  sizeKb,
      include_tier2: includeTier2 !== false,
      expires_at:    new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    }, { onConflict: 'request_id,format' }).catch(() => {})

    return NextResponse.json({ fileUrl, filename, sizeKb, format })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/content/generate] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── Lazy import the generator functions ───────────────────────
// We inline the generators here to avoid a secondary dynamic import
// The full pipeline is only imported when the generate endpoint is called

async function importGenerators() {
  // Dynamic import of pipeline module — isolated from route startup
  const pipeline = await import(
    '../../../../../../services/content-agent/content-pipeline'
  ) as any

  // Extract just the two generator functions
  if (pipeline.generatePPTX && pipeline.generateDOCX) {
    return { generatePPTX: pipeline.generatePPTX, generateDOCX: pipeline.generateDOCX }
  }

  // Fallback: inline lightweight generators if exports not available
  return {
    generatePPTX: inlinePPTX,
    generateDOCX: inlineDOCX,
  }
}

// ── Inline fallback generators (identical to pipeline, self-contained) ──
async function inlinePPTX(sections: any[], evidenceBlocks: any[], req: any, includeTier2: boolean, _rid: string, _sid: string) {
  const PptxGenJS = require('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'

  // Title slide
  const ts = pptx.addSlide()
  ts.background = { color: '1A3A5C' }
  ts.addText(req.topic, { x: 0.5, y: 1.2, w: 9.0, h: 2.0, fontSize: 28, bold: true, color: 'FFFFFF', wrap: true })
  ts.addText(`Dr. ${req.specialistName}  ·  ${new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`,
    { x: 0.5, y: 3.6, w: 9.0, h: 0.4, fontSize: 12, color: '93C5FD' })

  const displaySections = includeTier2 ? sections : sections.filter((s: any) => !s.isTier2)
  for (const section of displaySections) {
    const slide = pptx.addSlide()
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.6, fill: { color: section.isTier2 ? '1E3A8A' : '1A3A5C' } })
    slide.addText(section.title, { x: 0.3, y: 0.08, w: 8.5, h: 0.44, fontSize: 15, bold: true, color: 'FFFFFF' })
    if (section.isTier2) {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.6, w: '100%', h: 0.22, fill: { color: '1E40AF' } })
      slide.addText('PRE-PUBLICATION — Not peer-reviewed', { x: 0.2, y: 0.62, w: 9.6, h: 0.18, fontSize: 8, color: '93C5FD', italics: true, align: 'center' })
    }
    const yStart = section.isTier2 ? 0.9 : 0.7
    slide.addText(section.content || '', { x: 0.3, y: yStart, w: 9.4, h: 4.5 - yStart + 0.3, fontSize: 12, color: '1F2937', wrap: true, valign: 'top' })
    if (section.evidenceSummary) slide.addText(section.evidenceSummary, { x: 0.3, y: 4.6, w: 9.4, h: 0.2, fontSize: 7, color: '9CA3AF', italics: true })
    slide.addNotes(section.speakerNotes || section.content || '')
  }

  const filename = `ClinCollab_${req.contentType}_${Date.now()}.pptx`
  const tmpPath  = `/tmp/${filename}`
  await pptx.writeFile({ fileName: tmpPath })
  const fs = require('fs')
  const buffer = fs.readFileSync(tmpPath)
  fs.unlinkSync(tmpPath)
  return { buffer, filename }
}

async function inlineDOCX(sections: any[], evidenceBlocks: any[], req: any, includeTier2: boolean) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, LevelFormat, Header, Footer, TabStopType, SimpleField } = require('docx')
  const body: any[] = []

  body.push(new Paragraph({ spacing: { before: 0, after: 200 },
    children: [new TextRun({ text: req.topic, font: 'Arial', size: 42, bold: true, color: '1A3A5C' })] }))
  body.push(new Paragraph({ spacing: { before: 0, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1A3A5C' } },
    children: [new TextRun({ text: `Dr. ${req.specialistName}  ·  ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, font: 'Arial', size: 20, italics: true, color: '6B7280' })] }))

  const displaySections = includeTier2 ? sections : sections.filter((s: any) => !s.isTier2)
  for (const section of displaySections) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 100 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: section.isTier2 ? '1E3A8A' : '1A3A5C' } },
      children: [new TextRun({ text: section.title, font: 'Arial', size: 26, bold: true, color: section.isTier2 ? '1E3A8A' : '1A3A5C' })] }))
    if (section.isTier2) {
      body.push(new Paragraph({ spacing: { before: 0, after: 80 },
        children: [new TextRun({ text: '◆ PRE-PUBLICATION — Not yet peer-reviewed. Interpret with caution.', font: 'Arial', size: 18, italics: true, color: '1E3A8A' })] }))
    }
    const content = section.content || ''
    for (const para of content.split('\n').filter((p: string) => p.trim())) {
      body.push(new Paragraph({ spacing: { before: 40, after: 80 },
        children: [new TextRun({ text: para, font: 'Arial', size: 22, color: '1F2937' })] }))
    }
    if (section.evidenceSummary) {
      body.push(new Paragraph({ spacing: { before: 40, after: 100 },
        children: [new TextRun({ text: section.evidenceSummary, font: 'Arial', size: 18, italics: true, color: '9CA3AF' })] }))
    }
  }

  // Disclaimer
  body.push(new Paragraph({ spacing: { before: 400, after: 80 },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' } },
    children: [new TextRun({ text: 'This content was prepared with AI research assistance using ClinCollab. For educational use only. Not clinical decision support.', font: 'Arial', size: 18, italics: true, color: '9CA3AF' })] }))

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      headers: { default: new Header({ children: [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1A3A5C', space: 2 } },
        spacing: { before: 0, after: 100 },
        children: [new TextRun({ text: `ClinCollab  ·  ${req.topic.slice(0,60)}`, font: 'Arial', size: 18, bold: true, color: '1A3A5C' })]
      })]})},
      footers: { default: new Footer({ children: [new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: '1A3A5C', space: 2 } },
        spacing: { before: 80, after: 0 },
        tabStops: [{ type: TabStopType.RIGHT, position: 8200 }],
        children: [
          new TextRun({ text: 'ClinCollab Clinical Content Engine  ·  Educational use only', font: 'Arial', size: 17, color: '1A6B3C' }),
          new TextRun({ text: '\tPage ', font: 'Arial', size: 17, color: '888888' }),
          new TextRun({ children: [new SimpleField('PAGE')], font: 'Arial', size: 17, color: '888888' }),
        ]
      })]})},
      children: body,
    }]
  })

  const buffer = await Packer.toBuffer(doc)
  const filename = `ClinCollab_${req.contentType}_${Date.now()}.docx`
  return { buffer, filename }
}
