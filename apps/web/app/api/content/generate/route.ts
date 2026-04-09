import { NextRequest, NextResponse } from 'next/server'
export const dynamic    = 'force-dynamic'
export const maxDuration = 60   // seconds — increase limit for file generation

import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/content/generate
 * Generates PPTX or DOCX from stored content_sections and streams the file
 * directly back to the browser as a binary response.
 *
 * Approach: in-memory buffer → direct HTTP response
 * Avoids Supabase Storage upload/signed-URL chain which was causing timeouts.
 */
export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { requestId, format, includeTier2, specialistId } = body
  if (!requestId || !format || !specialistId) {
    return NextResponse.json({ error: 'requestId, format, specialistId required' }, { status: 400 })
  }
  if (!['pptx', 'docx'].includes(format)) {
    return NextResponse.json({ error: 'format must be pptx or docx' }, { status: 400 })
  }

  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Verify request belongs to this specialist
  const { data: req } = await sc
    .from('content_requests')
    .select('*, specialists(id, name, specialty)')
    .eq('id', requestId)
    .eq('specialist_id', specialistId)
    .single()

  if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (req.status !== 'completed') return NextResponse.json({ error: 'Content not ready yet' }, { status: 400 })

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
    specialistName:      specialist?.name      || 'Dr. Specialist',
    specialistSpecialty: specialist?.specialty  || '',
    topic:               req.topic,
    contentType:         req.content_type,
    audience:            req.audience,
    depth:               req.depth,
    specialInstructions: req.special_instructions,
  }

  const evidenceBlocks = (sources || []).map((s: any) => ({
    subtopic:    '',
    keyFinding:  s.title || '',
    statistics:  '',
    studyDesign: s.source_type || 'journal_article',
    sourceTitle: s.title || '',
    sourceUrl:   s.url || '',
    year:        s.publication_year || null,
    authors:     s.authors || '',
    journal:     s.journal || '',
    doi:         s.doi || '',
    trialId:     s.trial_id || '',
    score:       s.credibility_score || 3,
    tier:        (s.evidence_tier || 'tier1') as 'tier1' | 'tier2',
  }))

  const contentSections = (sections || []).map((s: any) => ({
    title:           s.section_title   || 'Section',
    sectionType:     s.section_type    || 'evidence',
    content:         (s.is_edited && s.edited_text) ? s.edited_text : (s.content_text || ''),
    speakerNotes:    s.speaker_notes   || s.content_text || '',
    evidenceLevel:   s.evidence_level  || 'moderate',
    evidenceTier:    (s.evidence_tier  || 'tier1') as 'tier1' | 'tier2',
    evidenceSummary: s.evidence_summary || '',
    citationNums:    s.citation_numbers || [],
    isTier2:         s.is_tier2_section || false,
    sortOrder:       s.sort_order || 0,
  }))

  try {
    let buffer: Buffer
    let filename: string
    const mimeType = format === 'pptx'
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    if (format === 'pptx') {
      const result = await buildPPTX(contentSections, evidenceBlocks, contentRequest, includeTier2 !== false)
      buffer   = result.buffer
      filename = result.filename
    } else {
      const result = await buildDOCX(contentSections, evidenceBlocks, contentRequest, includeTier2 !== false)
      buffer   = result.buffer
      filename = result.filename
    }

    // Log output record (best-effort, non-blocking)
    sc.from('content_outputs').upsert({
      request_id:    requestId,
      specialist_id: specialistId,
      format,
      file_name:     filename,
      file_url:      null,          // streamed directly, no Storage URL
      file_size_kb:  Math.round(buffer.length / 1024),
      include_tier2: includeTier2 !== false,
      expires_at:    new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    }, { onConflict: 'request_id,format' }).catch(() => {})

    // Stream the file directly to the browser
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type':        mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      buffer.length.toString(),
        'Cache-Control':       'no-store',
      },
    })

  } catch (err: any) {
    console.error('[/api/content/generate]', err)
    return NextResponse.json({ error: err?.message || 'File generation failed' }, { status: 500 })
  }
}

// ── PPTX builder — in-memory, no filesystem ──────────────────
async function buildPPTX(
  sections: any[],
  evidence: any[],
  req: any,
  includeTier2: boolean
): Promise<{ buffer: Buffer; filename: string }> {
  const PptxGenJS = require('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'

  const NAVY   = '1A3A5C'
  const WHITE  = 'FFFFFF'
  const LIGHT  = 'E8EEF5'
  const GREEN  = '1E8449'
  const BLUE   = '93C5FD'

  // ── Title slide ──
  const ts = pptx.addSlide()
  ts.background = { color: NAVY }
  ts.addText(req.topic || 'Clinical Presentation', {
    x: 0.5, y: 0.8, w: 9.0, h: 2.8,
    fontSize: 26, bold: true, color: WHITE, wrap: true, valign: 'middle',
  })
  ts.addText([
    { text: `Dr. ${req.specialistName}`, options: { bold: true } },
    { text: `  ·  ${req.specialistSpecialty || 'Clinical Specialist'}`, options: { bold: false } },
  ], { x: 0.5, y: 3.8, w: 9.0, h: 0.4, fontSize: 13, color: BLUE })
  ts.addText(
    new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
    { x: 0.5, y: 4.3, w: 9.0, h: 0.3, fontSize: 11, color: LIGHT }
  )
  ts.addText('Prepared with ClinCollab Clinical Content Engine · For educational use only',
    { x: 0.5, y: 4.8, w: 9.0, h: 0.25, fontSize: 8, color: BLUE, italics: true })
  ts.addNotes('Opening slide. Briefly introduce yourself, your institution, and the relevance of this topic to your audience.')

  // ── Content slides ──
  const displaySections = includeTier2
    ? sections
    : sections.filter((s: any) => !s.isTier2)

  for (const section of displaySections.slice(0, 20)) { // cap at 20 slides
    const slide = pptx.addSlide()
    const isTier2 = section.isTier2

    // Header bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: '100%', h: 0.55,
      fill: { color: isTier2 ? '1E3A8A' : NAVY },
    })
    slide.addText(section.title || 'Section', {
      x: 0.3, y: 0.06, w: 8.5, h: 0.43,
      fontSize: 14, bold: true, color: WHITE,
    })

    // Tier-2 warning banner
    if (isTier2) {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.55, w: '100%', h: 0.22, fill: { color: '1E40AF' } })
      slide.addText('◆ EMERGING EVIDENCE — Pre-publication. Not yet peer-reviewed. Interpret with caution.', {
        x: 0.2, y: 0.56, w: 9.6, h: 0.20, fontSize: 8, color: BLUE, italics: true, align: 'center',
      })
    }

    // Content
    const yBody = isTier2 ? 0.85 : 0.65
    const cleanContent = (section.content || '')
      .replace(/\[REF-\d+\]/g, '')   // remove citation markers for slides
      .trim()
    slide.addText(cleanContent || '(No content)', {
      x: 0.3, y: yBody, w: 9.4, h: 4.4 - yBody,
      fontSize: 13, color: '1F2937', wrap: true, valign: 'top',
    })

    // Evidence summary footer
    if (section.evidenceSummary) {
      slide.addText(section.evidenceSummary, {
        x: 0.3, y: 4.65, w: 9.4, h: 0.22,
        fontSize: 7, color: '9CA3AF', italics: true,
      })
    }

    slide.addNotes(section.speakerNotes || section.content || '')
  }

  // ── References slide ──
  const usedEvidence = evidence.filter(e => e.tier === 'tier1').slice(0, 12)
  if (usedEvidence.length > 0) {
    const rs = pptx.addSlide()
    rs.background = { color: 'F8FAFC' }
    rs.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.55, fill: { color: NAVY } })
    rs.addText('References', { x: 0.3, y: 0.06, w: 8.5, h: 0.43, fontSize: 14, bold: true, color: WHITE })
    const refText = usedEvidence.map((e, i) => {
      const parts = [`${i+1}.`]
      if (e.authors)     parts.push(e.authors + '.')
      if (e.sourceTitle) parts.push(e.sourceTitle + '.')
      if (e.journal)     parts.push(e.journal + '.')
      if (e.year)        parts.push(String(e.year) + '.')
      return parts.join(' ')
    }).join('\n')
    rs.addText(refText, {
      x: 0.3, y: 0.65, w: 9.4, h: 4.6,
      fontSize: 8, color: '374151', wrap: true, valign: 'top',
    })
  }

  // ── Closing slide ──
  const cs = pptx.addSlide()
  cs.background = { color: NAVY }
  cs.addText('Thank You', { x: 0.5, y: 1.5, w: 9.0, h: 0.8, fontSize: 36, bold: true, color: WHITE, align: 'center' })
  cs.addText('Questions & Discussion', { x: 0.5, y: 2.5, w: 9.0, h: 0.5, fontSize: 18, color: BLUE, align: 'center' })
  cs.addText('This presentation was prepared with AI research assistance via ClinCollab. Content is for educational purposes only and does not constitute clinical advice.',
    { x: 0.5, y: 4.5, w: 9.0, h: 0.4, fontSize: 8, color: LIGHT, italics: true, align: 'center' })

  // Generate in-memory buffer (no filesystem)
  const arrayBuffer = await pptx.write({ outputType: 'arraybuffer' })
  const buffer = Buffer.from(arrayBuffer)
  const filename = `ClinCollab_${(req.contentType || 'presentation').replace(/_/g, '-')}_${Date.now()}.pptx`
  return { buffer, filename }
}

// ── DOCX builder — in-memory ──────────────────────────────────
async function buildDOCX(
  sections: any[],
  evidence: any[],
  req: any,
  includeTier2: boolean
): Promise<{ buffer: Buffer; filename: string }> {
  const {
    Document, Packer, Paragraph, TextRun,
    HeadingLevel, BorderStyle, Header, Footer, TabStopType, SimpleField,
  } = require('docx')

  const body: any[] = []

  // Title
  body.push(new Paragraph({
    spacing: { before: 0, after: 240 },
    children: [new TextRun({ text: req.topic || 'Clinical Document', font: 'Arial', size: 40, bold: true, color: '1A3A5C' })],
  }))
  body.push(new Paragraph({
    spacing: { before: 0, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1A3A5C', space: 4 } },
    children: [
      new TextRun({ text: `Dr. ${req.specialistName}`, font: 'Arial', size: 22, bold: true, color: '1A3A5C' }),
      new TextRun({ text: `  ·  ${req.specialistSpecialty || ''}  ·  `, font: 'Arial', size: 22, color: '6B7280' }),
      new TextRun({ text: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }), font: 'Arial', size: 22, italics: true, color: '6B7280' }),
    ],
  }))

  const displaySections = includeTier2 ? sections : sections.filter((s: any) => !s.isTier2)

  for (const section of displaySections) {
    // Section heading
    body.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 320, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: section.isTier2 ? '1E3A8A' : '1A3A5C', space: 3 } },
      children: [new TextRun({
        text: section.title || 'Section',
        font: 'Arial', size: 26, bold: true,
        color: section.isTier2 ? '1E3A8A' : '1A3A5C',
      })],
    }))

    if (section.isTier2) {
      body.push(new Paragraph({
        spacing: { before: 0, after: 80 },
        children: [new TextRun({ text: '◆ EMERGING EVIDENCE — Pre-publication data. Not yet peer-reviewed. Interpret with caution.', font: 'Arial', size: 18, italics: true, color: '1E3A8A' })],
      }))
    }

    // Section content — split on newlines
    const paras = (section.content || '').split('\n').filter((p: string) => p.trim())
    if (paras.length === 0) paras.push('(Content pending)')
    for (const para of paras) {
      const isBullet = para.trimStart().startsWith('- ') || para.trimStart().startsWith('• ')
      const text = para.replace(/^[-•]\s/, '').trim()
      body.push(new Paragraph({
        bullet: isBullet ? { level: 0 } : undefined,
        spacing: { before: 40, after: 80 },
        children: [new TextRun({ text, font: 'Arial', size: 22, color: '1F2937' })],
      }))
    }

    // Evidence summary
    if (section.evidenceSummary) {
      body.push(new Paragraph({
        spacing: { before: 40, after: 120 },
        children: [new TextRun({ text: section.evidenceSummary, font: 'Arial', size: 18, italics: true, color: '9CA3AF' })],
      }))
    }
  }

  // References section
  const usedEvidence = evidence.filter(e => e.tier === 'tier1')
  if (usedEvidence.length > 0) {
    body.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '1A3A5C', space: 3 } },
      children: [new TextRun({ text: 'References', font: 'Arial', size: 26, bold: true, color: '1A3A5C' })],
    }))
    usedEvidence.forEach((e, i) => {
      const parts: string[] = [`${i+1}.`]
      if (e.authors)     parts.push(e.authors + '.')
      if (e.sourceTitle) parts.push(e.sourceTitle + '.')
      if (e.journal)     parts.push(e.journal + '.')
      if (e.year)        parts.push(String(e.year) + '.')
      if (e.doi)         parts.push('doi:' + e.doi + '.')
      if (e.sourceUrl)   parts.push('Available from: ' + e.sourceUrl)
      body.push(new Paragraph({
        spacing: { before: 40, after: 60 },
        children: [new TextRun({ text: parts.join(' '), font: 'Arial', size: 18, color: '374151' })],
      }))
    })
  }

  // Disclaimer
  body.push(new Paragraph({
    spacing: { before: 480, after: 0 },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0', space: 4 } },
    children: [new TextRun({
      text: 'This document was prepared with AI research assistance via ClinCollab. For educational use only. Not intended as clinical decision support.',
      font: 'Arial', size: 16, italics: true, color: '9CA3AF',
    })],
  }))

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{
      properties: {
        page: {
          size:   { width: 11906, height: 16838 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1A3A5C', space: 2 } },
            spacing: { before: 0, after: 80 },
            children: [
              new TextRun({ text: 'ClinCollab Clinical Content  ·  ', font: 'Arial', size: 18, bold: true, color: '1A3A5C' }),
              new TextRun({ text: (req.topic || '').slice(0, 55), font: 'Arial', size: 18, color: '4A5568' }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: '1A3A5C', space: 2 } },
            spacing: { before: 60, after: 0 },
            tabStops: [{ type: TabStopType.RIGHT, position: 8200 }],
            children: [
              new TextRun({ text: 'ClinCollab  ·  Educational use only', font: 'Arial', size: 17, color: '1E8449' }),
              new TextRun({ text: '\tPage ', font: 'Arial', size: 17, color: '888888' }),
              new TextRun({ children: [new SimpleField('PAGE')], font: 'Arial', size: 17, color: '888888' }),
            ],
          })],
        }),
      },
      children: body,
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  const filename = `ClinCollab_${(req.contentType || 'document').replace(/_/g, '-')}_${Date.now()}.docx`
  return { buffer, filename }
}
