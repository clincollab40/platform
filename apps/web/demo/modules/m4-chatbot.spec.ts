/**
 * M4 Demo — AI Chatbot & Appointments
 * Run: npx playwright test demo/modules/m4-chatbot.spec.ts --headed
 * Duration: ~2 min
 */
import { test } from '@playwright/test'
import { T, showChapter, showFeature, highlight, setSectionLabel, clearSectionLabel, gotoAndWait, smoothScrollDown } from '../demo-helpers'

test.setTimeout(5 * 60 * 1000)

test('M4 — AI Chatbot & Appointments', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await showChapter(page, '4', 'AI Chatbot & Appointments', 'WhatsApp Bot · Intent Parsing · Slot Booking · FAQ Engine · Reminders')

  await setSectionLabel(page, 'M4 — AI Chatbot')

  // ── 4.1 Chatbot config
  await gotoAndWait(page, '/chatbot/config')
  await showFeature(page,
    'WhatsApp Chatbot Configuration',
    'Configure your AI-powered WhatsApp assistant: clinic identity, working hours, specialty focus, and escalation rules.'
  )
  await page.waitForTimeout(T.longRead)

  await highlight(page, 'aside', T.feature)
  await showFeature(page,
    'Bot Readiness Score',
    'AI scores chatbot completeness. Gaps in FAQ, slots, or configuration lower the score with specific action prompts.'
  )
  await page.waitForTimeout(T.read)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.short)

  await showFeature(page,
    'Welcome Message & Clinic Identity',
    'Personalised greeting in patient\'s language. Clinic name, doctor name, and specialty shown in every conversation.'
  )
  await page.waitForTimeout(T.read)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.short)

  await showFeature(page,
    'FAQ Engine — 12 Common Questions',
    'Pre-written answers for: preparation, medications, cost, parking, parking, discharge, follow-up, emergency contacts. All editable.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Escalation Rules',
    'Define which keywords trigger live escalation to the clinic number. "Emergency", "bleeding", "chest pain" → immediate human handoff.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 4.2 Appointment slots
  await gotoAndWait(page, '/appointments')
  await showFeature(page,
    'Appointment Slot Manager',
    'Create available time slots per day. WhatsApp bot presents these to patients automatically and blocks slots on confirmation.'
  )
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 300)
  await showFeature(page,
    'Full Booking Conversation Flow',
    'Patient: "Book appointment" → Bot asks name → phone → shows slots → patient picks → confirms → slot booked in DB → reminder set.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Automatic Reminders — 3-Touch System',
    'D-1: Day-before reminder at 6 PM · H-1: One-hour reminder · D+1: Post-appointment feedback request. All WhatsApp. Zero manual work.'
  )
  await page.waitForTimeout(T.longRead)

  await clearSectionLabel(page)
})
