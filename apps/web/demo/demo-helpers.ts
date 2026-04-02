/**
 * ClinCollab Demo — Shared Helpers
 *
 * Visual overlay utilities used by all demo scripts.
 * These inject on-screen banners, chapter cards, and highlight pulses
 * so the OBS recording is self-explaining without a voiceover.
 */

import type { Page } from '@playwright/test'

// ── Timing constants (tweak to control demo speed) ────────────────
export const T = {
  instant:   200,   // fast UI feedback
  short:     800,   // brief pause after action
  normal:   1500,   // read a label
  read:     2500,   // read a sentence
  longRead: 4000,   // read a paragraph / absorb UI
  chapter:  3000,   // chapter card display time
  feature:  3500,   // feature highlight dwell time
}

// ── Chapter card ───────────────────────────────────────────────────
/**
 * Full-screen chapter card. Shown at the start of each module section.
 * Auto-removes after `duration` ms.
 */
export async function showChapter(
  page: Page,
  moduleNum: string,
  title: string,
  subtitle: string,
  duration = T.chapter
): Promise<void> {
  await page.evaluate(({ moduleNum, title, subtitle }) => {
    const overlay = document.createElement('div')
    overlay.id = '__demo_chapter__'
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:99999;
      background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#0f2744 100%);
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      animation:fadeIn 0.4s ease;
    `
    overlay.innerHTML = `
      <style>
        @keyframes fadeIn { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:scale(1)} }
      </style>
      <div style="color:#60a5fa;font-size:13px;font-weight:600;letter-spacing:4px;text-transform:uppercase;margin-bottom:12px;">
        Module ${moduleNum}
      </div>
      <div style="color:#ffffff;font-size:42px;font-weight:800;letter-spacing:-1px;text-align:center;line-height:1.2;max-width:700px;">
        ${title}
      </div>
      <div style="color:#94a3b8;font-size:18px;margin-top:16px;text-align:center;max-width:500px;line-height:1.5;">
        ${subtitle}
      </div>
      <div style="margin-top:40px;display:flex;gap:8px;">
        <div style="width:8px;height:8px;border-radius:50%;background:#3b82f6;animation:pulse 1.5s infinite;"></div>
        <div style="width:8px;height:8px;border-radius:50%;background:#3b82f6;animation:pulse 1.5s 0.3s infinite;"></div>
        <div style="width:8px;height:8px;border-radius:50%;background:#3b82f6;animation:pulse 1.5s 0.6s infinite;"></div>
        <style>@keyframes pulse{0%,100%{opacity:0.3}50%{opacity:1}}</style>
      </div>
    `
    document.body.appendChild(overlay)
  }, { moduleNum, title, subtitle })

  await page.waitForTimeout(duration)

  await page.evaluate(() => {
    const el = document.getElementById('__demo_chapter__')
    if (el) el.style.transition = 'opacity 0.3s'
    if (el) el.style.opacity = '0'
    setTimeout(() => el?.remove(), 350)
  })
  await page.waitForTimeout(400)
}

// ── Feature banner ─────────────────────────────────────────────────
/**
 * Slide-in banner at the bottom of the screen naming the current feature.
 */
export async function showFeature(
  page: Page,
  title: string,
  description: string,
  duration = T.feature
): Promise<void> {
  await page.evaluate(({ title, description }) => {
    document.getElementById('__demo_feature__')?.remove()
    const el = document.createElement('div')
    el.id = '__demo_feature__'
    el.style.cssText = `
      position:fixed; bottom:32px; left:50%; transform:translateX(-50%);
      z-index:99998;
      background:rgba(15,23,42,0.95);
      border:1px solid rgba(59,130,246,0.4);
      border-radius:12px;
      padding:16px 28px;
      display:flex; align-items:center; gap:16px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);
      animation:slideUp 0.3s ease;
      max-width:680px;
    `
    el.innerHTML = `
      <style>
        @keyframes slideUp{from{opacity:0;transform:translateX(-50%) translateY(16px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
      </style>
      <div style="width:36px;height:36px;border-radius:8px;background:#1d4ed8;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
        </svg>
      </div>
      <div>
        <div style="color:#f1f5f9;font-size:15px;font-weight:700;">${title}</div>
        <div style="color:#94a3b8;font-size:13px;margin-top:2px;line-height:1.4;">${description}</div>
      </div>
    `
    document.body.appendChild(el)
  }, { title, description })

  await page.waitForTimeout(duration)

  await page.evaluate(() => {
    const el = document.getElementById('__demo_feature__')
    if (el) { el.style.transition = 'opacity 0.3s'; el.style.opacity = '0' }
    setTimeout(() => el?.remove(), 350)
  })
}

// ── Pulse highlight ────────────────────────────────────────────────
/**
 * Draws a pulsing highlight ring around a DOM element to draw attention.
 */
export async function highlight(page: Page, selector: string, durationMs = 2000): Promise<void> {
  try {
    await page.evaluate(({ sel, dur }) => {
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return
      const rect = el.getBoundingClientRect()
      const ring = document.createElement('div')
      ring.style.cssText = `
        position:fixed;
        left:${rect.left - 6}px; top:${rect.top - 6}px;
        width:${rect.width + 12}px; height:${rect.height + 12}px;
        border-radius:10px;
        border:3px solid #3b82f6;
        box-shadow:0 0 0 4px rgba(59,130,246,0.2);
        pointer-events:none;
        z-index:99997;
        animation:ringPulse ${dur}ms ease-out forwards;
      `
      const style = document.createElement('style')
      style.textContent = `@keyframes ringPulse{0%{opacity:1;transform:scale(1)}70%{opacity:0.6;transform:scale(1.02)}100%{opacity:0;transform:scale(1.04)}}`
      document.head.appendChild(style)
      document.body.appendChild(ring)
      setTimeout(() => ring.remove(), dur)
    }, { sel: selector, dur: durationMs })
  } catch {
    // Element not found — silently skip
  }
  await page.waitForTimeout(durationMs)
}

// ── Section label ──────────────────────────────────────────────────
/**
 * Top-right corner label showing current demo section.
 */
export async function setSectionLabel(page: Page, label: string): Promise<void> {
  await page.evaluate((text) => {
    document.getElementById('__demo_section__')?.remove()
    const el = document.createElement('div')
    el.id = '__demo_section__'
    el.style.cssText = `
      position:fixed; top:16px; right:16px; z-index:99996;
      background:rgba(30,58,95,0.9);
      border:1px solid rgba(96,165,250,0.4);
      border-radius:8px;
      padding:6px 14px;
      color:#93c5fd;
      font-size:12px;
      font-weight:600;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      letter-spacing:0.5px;
    `
    el.textContent = text
    document.body.appendChild(el)
  }, label)
}

export async function clearSectionLabel(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById('__demo_section__')?.remove())
}

// ── Slow type ─────────────────────────────────────────────────────
/**
 * Types text character by character for a typewriter effect on screen.
 */
export async function slowType(page: Page, selector: string, text: string, delayMs = 60): Promise<void> {
  await page.click(selector)
  await page.fill(selector, '')
  for (const char of text) {
    await page.type(selector, char, { delay: delayMs })
  }
}

// ── Smooth scroll ─────────────────────────────────────────────────
export async function smoothScrollDown(page: Page, px = 400): Promise<void> {
  await page.evaluate((amount) => {
    window.scrollBy({ top: amount, behavior: 'smooth' })
  }, px)
  await page.waitForTimeout(800)
}

export async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await page.waitForTimeout(500)
}

// ── Navigation ─────────────────────────────────────────────────────
export async function gotoAndWait(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(T.normal)
}
