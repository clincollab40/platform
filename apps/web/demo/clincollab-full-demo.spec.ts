/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║       ClinCollab — Full Platform Demo Script (OBS Edition)       ║
 * ║                                                                  ║
 * ║  Run alongside OBS Studio to produce a polished demo video.      ║
 * ║  Each module is self-paced with on-screen chapter cards,         ║
 * ║  feature banners, and pulse highlights.                          ║
 * ║                                                                  ║
 * ║  Usage:                                                          ║
 * ║    npx playwright test demo/clincollab-full-demo.spec.ts \       ║
 * ║      --project=chromium --headed                                 ║
 * ║                                                                  ║
 * ║  Target: https://app.clincollab.com                              ║
 * ║  Duration: ~12–15 minutes (all 11 modules)                       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { test } from '@playwright/test'
import {
  T, showChapter, showFeature, highlight,
  setSectionLabel, clearSectionLabel,
  gotoAndWait, smoothScrollDown, scrollToTop, slowType,
} from './demo-helpers'

// ── Override timeout for the full demo ────────────────────────────
test.setTimeout(20 * 60 * 1000)   // 20 minutes max

// ─────────────────────────────────────────────────────────────────
// INTRO CARD
// ─────────────────────────────────────────────────────────────────
test('00 — Intro: ClinCollab Platform Overview', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await gotoAndWait(page, '/')

  await page.evaluate(() => {
    const el = document.createElement('div')
    el.style.cssText = `
      position:fixed;inset:0;z-index:99999;
      background:linear-gradient(135deg,#020817 0%,#0c1a3a 50%,#0a1628 100%);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    `
    el.innerHTML = `
      <div style="color:#3b82f6;font-size:11px;font-weight:700;letter-spacing:5px;text-transform:uppercase;margin-bottom:24px;">
        Product Demo — 2026
      </div>
      <div style="color:#ffffff;font-size:56px;font-weight:900;letter-spacing:-2px;text-align:center;line-height:1;">
        Clin<span style="color:#3b82f6">Collab</span>
      </div>
      <div style="color:#64748b;font-size:20px;margin-top:16px;text-align:center;max-width:520px;line-height:1.6;">
        Clinical Peer Engagement Platform for<br>Procedural Specialists in India
      </div>
      <div style="margin-top:48px;display:flex;gap:24px;flex-wrap:wrap;justify-content:center;">
        ${['11 Modules','AI-Powered','WhatsApp Native','Built for India'].map(t =>
          `<div style="border:1px solid rgba(59,130,246,0.3);border-radius:20px;padding:8px 20px;color:#93c5fd;font-size:14px;">${t}</div>`
        ).join('')}
      </div>
    `
    document.body.appendChild(el)
  })

  await page.waitForTimeout(5000)
})

// ─────────────────────────────────────────────────────────────────
// M1 — IDENTITY, AUTH & ONBOARDING
// ─────────────────────────────────────────────────────────────────
test('01 — M1: Identity, Auth & Onboarding', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })

  await showChapter(page, '1', 'Identity & Onboarding', 'Google OAuth · Specialty Profiling · Profile Completeness Score')
  await setSectionLabel(page, 'M1 — Identity & Onboarding')

  // ── Login Page ──────────────────────────────────────────────────
  await gotoAndWait(page, '/auth/login')
  await showFeature(page, 'Login — Google OAuth', 'One-click Google Sign-In. No passwords stored. MCI verification on first login.')
  await page.waitForTimeout(T.read)

  // ── Dashboard (logged-in state) ─────────────────────────────────
  await gotoAndWait(page, '/dashboard')
  await showFeature(page, 'Clinical Command Center', 'Your personalised dashboard — Practice Health Score, peer network pulse, and AI insights at a glance.')
  await page.waitForTimeout(T.longRead)

  // Highlight Practice Health Score
  await highlight(page, '.metric-card', T.feature)
  await showFeature(page, 'Practice Health Score', 'Real-time composite score: 60% network activity + 40% profile completeness. Updates live as you engage.')
  await page.waitForTimeout(T.read)

  // Highlight AI Insight Panel
  await highlight(page, 'aside', T.feature)
  await showFeature(page, 'AI Insight Panel', 'Groq LLaMA 3.3 70B generates contextual recommendations for your practice — refreshed every session.')
  await page.waitForTimeout(T.read)

  // Sidebar navigation
  await highlight(page, 'nav', T.feature)
  await showFeature(page, 'Sidebar Navigation', '11 modules accessible from the left sidebar. Module access controlled by organisation plan tier.')
  await page.waitForTimeout(T.read)

  await clearSectionLabel(page)
})

// ─────────────────────────────────────────────────────────────────
// M2 — PEER NETWORK
// ─────────────────────────────────────────────────────────────────
test('02 — M2: Peer Network', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })

  await showChapter(page, '2', 'Peer Network', 'Active · Drifting · Silent Peer Classification · City Benchmarks')
  await setSectionLabel(page, 'M2 — Peer Network')

  await gotoAndWait(page, '/network')
  await showFeature(page, 'Peer Network Dashboard', 'Your complete peer ecosystem — specialists who refer to you and who you refer to.')
  await page.waitForTimeout(T.longRead)

  // Network health score
  await highlight(page, 'aside', T.feature)
  await showFeature(page, 'Network Health Score', 'AI computes your network health against city benchmarks. Hyderabad benchmark: 14 active peers.')
  await page.waitForTimeout(T.read)

  // Peer status classification
  await showFeature(page, 'Peer Status Classification', 'Active (< 30 days) · Drifting (30–90 days) · Silent (> 90 days). Re-engage with one click.')
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.read)

  // Add Colleague
  const addBtn = page.getByRole('link', { name: /Add/i }).or(page.getByRole('button', { name: /Add/i }))
  if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await highlight(page, 'a[href*="add"], button', T.feature)
  }
  await showFeature(page, 'Add Colleague', 'Add referring doctors by name + hospital. System auto-classifies specialty and seeds the peer relationship.')
  await page.waitForTimeout(T.read)

  // Add colleague page
  await gotoAndWait(page, '/network/add')
  await showFeature(page, 'Colleague Onboarding Form', 'Doctor name, hospital, specialty, and city. ClinCollab generates a seed referral link automatically.')
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})

// ─────────────────────────────────────────────────────────────────
// M3 — REFERRALS
// ─────────────────────────────────────────────────────────────────
test('03 — M3: Referrals', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })

  await showChapter(page, '3', 'Referral Management', 'Emergency · Urgent · Semi-Urgent · Elective · Document Upload · WhatsApp Notify')
  await setSectionLabel(page, 'M3 — Referral Management')

  await gotoAndWait(page, '/referrals')
  await showFeature(page, 'Referral Inbox', 'All inbound referrals with urgency classification, status lifecycle, and document attachments.')
  await page.waitForTimeout(T.longRead)

  // Urgency color coding
  await showFeature(page, 'Urgency Classification', '🔴 Emergency (STEMI / unstable) · 🟠 Urgent (ECG changes) · 🟡 Semi-Urgent · 🟢 Elective. Auto-classified by AI triage.')
  await page.waitForTimeout(T.longRead)

  // Conversion score
  await highlight(page, 'aside', T.feature)
  await showFeature(page, 'Referral Conversion Score', 'AI tracks referral-to-appointment conversion rate. Identifies drop-off points in your referral funnel.')
  await page.waitForTimeout(T.read)

  await smoothScrollDown(page, 200)
  await page.waitForTimeout(T.read)

  // Status lifecycle
  await showFeature(page, 'Status Lifecycle', 'Draft → Submitted → Accepted → In Progress → Completed. Full audit trail with timestamps.')
  await page.waitForTimeout(T.longRead)

  // Public referral link
  await gotoAndWait(page, '/refer/tok_demo_clincollab_2024')
  await showFeature(page, 'Public Referral Form', 'Referring doctors submit referrals via a personalised token link — no login required. Secured by token expiry.')
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})

// ─────────────────────────────────────────────────────────────────
// M4 — AI CHATBOT & APPOINTMENTS
// ─────────────────────────────────────────────────────────────────
test('04 — M4: AI Chatbot & Appointments', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })

  await showChapter(page, '4', 'AI Chatbot & Appointments', 'WhatsApp Bot · Appointment Slots · FAQ Engine · Conversation State Machine')
  await setSectionLabel(page, 'M4 — AI Chatbot')

  await gotoAndWait(page, '/chatbot/config')
  await showFeature(page, 'Chatbot Configuration', 'Configure your WhatsApp bot: clinic name, hours, specialty focus, welcome message, and escalation rules.')
  await page.waitForTimeout(T.longRead)

  await highlight(page, 'aside', T.feature)
  await showFeature(page, 'Bot Readiness Score', 'AI scores your bot completeness. Incomplete FAQ or slot coverage lowers the score with specific guidance.')
  await page.waitForTimeout(T.read)

  await smoothScrollDown(page, 400)
  await page.waitForTimeout(T.read)

  await showFeature(page, 'FAQ Engine', 'Pre-programmed answers for common patient questions — medications, preparation, discharge, follow-up. Editable per specialty.')
  await page.waitForTimeout(T.longRead)

  // Appointments page
  await gotoAndWait(page, '/appointments')
  await showFeature(page, 'Appointment Slot Manager', 'Define available slots per day/time. WhatsApp bot auto-presents available slots and books on confirmation.')
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 300)
  await showFeature(page, 'WhatsApp Booking Flow', 'Patient texts → Bot presents slots → Patient confirms → Slot booked → Pre-procedure reminders sent automatically (D-1, H-1).')
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})

// ─────────────────────────────────────────────────────────────────
// M5 — CLINICAL TRIAGE
// ─────────────────────────────────────────────────────────────────
test('05 — M5: Clinical Triage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })

  await showChapter(page, '5', 'Clinical Triage', 'AI-Guided Symptom Triage · Red Flag Detection · 4 Specialty Templates')
  await setSectionLabel(page, 'M5 — Clinical Triage')

  await gotoAndWait(page, '/triage/sessions')
  await showFeature(page, 'Triage Sessions Dashboard', 'All WhatsApp triage sessions — urgency outcome, escalation status, and specialist assignment.')
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 200)
  await page.waitForTimeout(T.read)

  // Triage builder
  await gotoAndWait(page, '/triage/builder')
  await showFeature(page, 'Triage Protocol Builder', 'Build adaptive symptom questionnaires with branching logic. Preloaded templates for IC, cardiac surgery, neurosurgery, ortho.')
  await page.waitForTimeout(T.longRead)

  await highlight(page, 'main', T.feature)
  await showFeature(page, 'Red Flag Detection', 'Any red-flag response (chest pain + diaphoresis, neuro deficits) immediately escalates to Emergency — bypasses standard flow.')
  await page.waitForTimeout(T.longRead)

  await showFeature(page, '4 Specialty Templates Included', 'Interventional Cardiology · Cardiac Surgery · Neurosurgery · Orthopaedics. Customisable per doctor preference.')
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})

// ─────────────────────────────────────────────────────────────────
// M6 — 360° SYNTHESIS
// ─────────────────────────────────────────────────────────────────
test('06 — M6: 360° Synthesis', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })

  await showChapter(page, '6', '360° Synthesis', 'AI Patient Summary · Groq LLaMA 3.3 · Red Flag Extraction · Multi-source Aggregation')
  await setSectionLabel(page, 'M6 — 360° Synthesis')

  await gotoAndWait(page, '/synthesis')
  await showFeature(page, '360° Patient Synthesis', 'AI aggregates patient records, referral notes, triage responses, and prior consultation data into a single clinical summary.')
  await page.waitForTimeout(T.longRead)

  await highlight(page, 'aside', T.feature)
  await showFeature(page, 'Synthesis Score', 'Tracks how many of your cases have a complete AI synthesis. Incomplete summaries are flagged for attention.')
  await page.waitForTimeout(T.read)

  await smoothScrollDown(page, 300)
  await showFeature(page, 'Agent Traces', 'Every synthesis step is logged: source ingestion → extraction → synthesis → red flag check → output. Full explainability.')
  await page.waitForTimeout(T.longRead)

  await showFeature(page, 'Red Flag Extraction', 'AI automatically surfaces critical findings: abnormal vitals, drug interactions, contraindications — highlighted in synthesis output.')
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})

// ─────────────────────────────────────────────────────────────────
// M7 — TRANSCRIPTION
// ─────────────────────────────────────────────────────────────────
test('07 — M7: Transcription & Consultation Notes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })

  await showChapter(page, '7', 'AI Transcription', 'Groq Whisper · SOAP Notes · Note Templates · Voice-to-Clinical-Record')
  await setSectionLabel(page, 'M7 — Transcription')

  await gotoAndWait(page, '/transcription')
  await showFeature(page, 'Transcription Dashboard', 'All consultation recordings and generated SOAP notes. AI confidence score per note. One-click download.')
  await page.waitForTimeout(T.longRead)

  await highlight(page, 'aside', T.feature)
  await showFeature(page, 'Approval Score', 'Tracks what % of AI-generated notes have been reviewed and approved by the specialist. Target: 100%.')
  await page.waitForTimeout(T.read)

  // Templates page
  await gotoAndWait(page, '/transcription/templates')
  await showFeature(page, 'Note Templates', 'Specialty-specific templates: SOAP, procedure notes, discharge summaries, follow-up notes. Customise per consultation type.')
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 300)
  await showFeature(page, 'Groq Whisper Transcription', 'Record in any Indian language mix — English, Hindi, Telugu, Tamil. Whisper auto-transcribes and AI converts to clinical SOAP format.')
  await page.waitForTimeout(T.longRead)

  await showFeature(page, 'AI Confidence Score', 'Each generated note carries a 0–100% AI confidence score. Low-confidence notes are flagged for mandatory specialist review.')
  await page.waitForTimeout(T.read)

  await clearSectionLabel(page)
})

// ─────────────────────────────────────────────────────────────────
// M8 — PROCEDURE PLANNER
// ─────────────────────────────────────────────────────────────────
test('08 — M8: Procedure Planner', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })

  await showChapter(page, '8', 'Procedure Planner', 'Pre-Op Workup · Consent Tracking · 5-Gate Readiness Check · Resource Booking')
  await setSectionLabel(page, 'M8 — Procedure Planner')

  await gotoAndWait(page, '/procedures')
  await showFeature(page, 'Procedure Plans Dashboard', 'All active procedure plans with readiness gate status. Red/Amber/Green care plan alerts based on days to procedure.')
  await page.waitForTimeout(T.longRead)

  await highlight(page, 'aside', T.feature)
  await showFeature(page, 'Checklist Compliance Score', 'Percentage of plans where both workup AND consent are complete. The gold standard safety metric.')
  await page.waitForTimeout(T.read)

  await smoothScrollDown(page, 300)
  await showFeature(page, '5-Gate Readiness Check', 'Plan is READY only when: ✅ Workup complete · ✅ Consent signed · ✅ Anaesthesia confirmed · ✅ Resources booked · ✅ Date set')
  await page.waitForTimeout(T.longRead)

  await showFeature(page, 'Consent Lifecycle', 'Not Started → Sent for Review → Reviewed → Signed (or Waived). Every transition logged with timestamp and user.')
  await page.waitForTimeout(T.longRead)

  await showFeature(page, 'Medication Hold Alerts', 'Auto-calculates medication hold dates: Warfarin (5 days), NOAC (2 days), Aspirin (7 days). Sent to patient via WhatsApp.')
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})

// ─────────────────────────────────────────────────────────────────
// M9 — PROCEDURE COMMUNICATIONS
// ─────────────────────────────────────────────────────────────────
test('09 — M9: Procedure Communications', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })

  await showChapter(page, '9', 'Procedure Communications', 'WhatsApp Stakeholder Threads · SLA Tracking · Post-Procedure Milestones')
  await setSectionLabel(page, 'M9 — Procedure Comms')

  await gotoAndWait(page, '/procedures/communications')
  await showFeature(page, 'Stakeholder Communications Hub', 'WhatsApp message threads for every stakeholder: patient, family, referring doctor, theatre team.')
  await page.waitForTimeout(T.longRead)

  await showFeature(page, 'WhatsApp Reply Intent Parser', 'AI parses patient replies: "yes" / "haan" = confirm · "arrived" / "pahuncha" = checked-in · "help" = distress escalation.')
  await page.waitForTimeout(T.longRead)

  await showFeature(page, 'SLA Breach Detection', 'Critical confirmations: 2-hour SLA · Routine confirmations: 24-hour SLA. Automatic escalation on breach.')
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 300)
  await showFeature(page, 'Post-Procedure Milestones', 'Day 0: discharge instructions · Day 1: check call · Day 7: wound review · Day 30: final follow-up. All automated via WhatsApp.')
  await page.waitForTimeout(T.longRead)

  await showFeature(page, 'Stakeholder Engagement Rate', 'Tracks what % of stakeholders confirmed their notifications. Low rates trigger re-send workflows.')
  await page.waitForTimeout(T.read)

  await clearSectionLabel(page)
})

// ─────────────────────────────────────────────────────────────────
// M10 — CONTENT STUDIO
// ─────────────────────────────────────────────────────────────────
test('10 — M10: Content Studio', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })

  await showChapter(page, '10', 'Content Studio', 'AI CME Generation · Patient Education · PPTX / PDF · Vancouver Citations')
  await setSectionLabel(page, 'M10 — Content Studio')

  await gotoAndWait(page, '/content')
  await showFeature(page, 'Content Studio Dashboard', 'AI-generated clinical content library: CME modules, grand rounds, patient education, referral guidelines.')
  await page.waitForTimeout(T.longRead)

  await highlight(page, 'aside', T.feature)
  await showFeature(page, 'CME Score', 'Tracks content completion rate + pending reviews. Score = (completion × 0.8) + bonus 20 for zero pending reviews.')
  await page.waitForTimeout(T.read)

  await smoothScrollDown(page, 300)
  await showFeature(page, 'Source Credibility Tiers', 'Tier 1: PubMed, Cochrane, ACC/ESC/CSI guidelines · Tier 2: ClinicalTrials.gov, medRxiv · Excluded: Wikipedia, WebMD.')
  await page.waitForTimeout(T.longRead)

  await showFeature(page, 'Output Formats', 'CME Module → PPTX + PDF · Patient Education → PDF + WhatsApp · Grand Rounds → PPTX. One-click download after generation.')
  await page.waitForTimeout(T.longRead)

  await showFeature(page, 'Patient Education Gate', 'Patient-facing content requires mandatory doctor review before publishing. Prevents AI errors reaching patients.')
  await page.waitForTimeout(T.longRead)

  await showFeature(page, 'Vancouver Citations', 'All AI-generated content includes properly formatted Vancouver-style references (max 6 authors, then et al.).')
  await page.waitForTimeout(T.read)

  // Content detail (if exists)
  await clearSectionLabel(page)
})

// ─────────────────────────────────────────────────────────────────
// M11 — CONFIG & ADMIN
// ─────────────────────────────────────────────────────────────────
test('11 — M11: Configuration & Admin', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })

  await showChapter(page, '11', 'Config & Admin', 'Organisation Management · Plan Tiers · Module Access Control · Audit Logs')
  await setSectionLabel(page, 'M11 — Config & Admin')

  await gotoAndWait(page, '/admin')
  await showFeature(page, 'Admin Dashboard', 'Platform-wide control: organisations, plan tiers, module entitlements, and specialist permissions.')
  await page.waitForTimeout(T.longRead)

  // Orgs page
  await gotoAndWait(page, '/admin/orgs')
  await showFeature(page, 'Organisation Management', 'Create and manage hospital organisations. Each org gets its own plan tier and module access configuration.')
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 300)
  await showFeature(page, 'Plan Tiers', 'Starter (5 modules) · Professional (all 11 modules + AI) · Enterprise (white-label + custom SLAs). Switchable per org.')
  await page.waitForTimeout(T.longRead)

  // Plans page
  await gotoAndWait(page, '/admin/plans')
  await showFeature(page, 'Plan Definitions', 'Define which modules are enabled per plan. Granular per-module toggle with entitlement caching at the edge.')
  await page.waitForTimeout(T.longRead)

  // Config page
  await gotoAndWait(page, '/admin/config')
  await showFeature(page, 'Module Configuration', 'Fine-grained feature flags: AI on/off, WhatsApp integration, max peers, referral limits. Per-org overrides.')
  await page.waitForTimeout(T.longRead)

  await showFeature(page, 'Config Audit Log', 'Every configuration change is logged with: who changed it, what changed, old value vs new value, and timestamp.')
  await page.waitForTimeout(T.read)

  await clearSectionLabel(page)
})

// ─────────────────────────────────────────────────────────────────
// CLOSE — Summary & CTA
// ─────────────────────────────────────────────────────────────────
test('12 — Outro: Platform Summary', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await gotoAndWait(page, '/dashboard')

  await page.evaluate(() => {
    const el = document.createElement('div')
    el.style.cssText = `
      position:fixed;inset:0;z-index:99999;
      background:linear-gradient(135deg,#020817 0%,#0c1a3a 50%,#0a1628 100%);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      padding:40px;
    `
    el.innerHTML = `
      <div style="color:#3b82f6;font-size:11px;font-weight:700;letter-spacing:5px;text-transform:uppercase;margin-bottom:16px;">
        Platform Summary
      </div>
      <div style="color:#ffffff;font-size:44px;font-weight:900;letter-spacing:-1px;text-align:center;">
        11 Modules. One Platform.
      </div>
      <div style="margin-top:40px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:860px;width:100%;">
        ${[
          ['M1','Identity & Auth'],['M2','Peer Network'],['M3','Referrals'],
          ['M4','AI Chatbot'],['M5','Triage'],['M6','360° Synthesis'],
          ['M7','Transcription'],['M8','Procedure Planner'],['M9','Comms'],
          ['M10','Content Studio'],['M11','Config & Admin'],['',''],
        ].map(([num, label]) => label ? `
          <div style="background:rgba(30,58,95,0.5);border:1px solid rgba(59,130,246,0.3);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:12px;">
            <span style="color:#60a5fa;font-size:11px;font-weight:700;letter-spacing:1px;">${num}</span>
            <span style="color:#e2e8f0;font-size:14px;font-weight:500;">${label}</span>
          </div>
        ` : '<div></div>').join('')}
      </div>
      <div style="margin-top:40px;display:flex;gap:32px;">
        <div style="text-align:center;">
          <div style="color:#3b82f6;font-size:32px;font-weight:800;">141</div>
          <div style="color:#64748b;font-size:12px;margin-top:4px;">Source Files</div>
        </div>
        <div style="text-align:center;">
          <div style="color:#3b82f6;font-size:32px;font-weight:800;">11</div>
          <div style="color:#64748b;font-size:12px;margin-top:4px;">Modules</div>
        </div>
        <div style="text-align:center;">
          <div style="color:#3b82f6;font-size:32px;font-weight:800;">25</div>
          <div style="color:#64748b;font-size:12px;margin-top:4px;">Specialties</div>
        </div>
        <div style="text-align:center;">
          <div style="color:#3b82f6;font-size:32px;font-weight:800;">∞</div>
          <div style="color:#64748b;font-size:12px;margin-top:4px;">Possibilities</div>
        </div>
      </div>
      <div style="margin-top:48px;color:#475569;font-size:15px;">
        app.clincollab.com · Built for procedural specialists in India
      </div>
    `
    document.body.appendChild(el)
  })

  await page.waitForTimeout(8000)
})
