/**
 * M11 Demo — Configuration & Admin
 * Run: npx playwright test demo/modules/m11-config.spec.ts --headed
 * Duration: ~2 min
 */
import { test } from '@playwright/test'
import { T, showChapter, showFeature, highlight, setSectionLabel, clearSectionLabel, gotoAndWait, smoothScrollDown } from '../demo-helpers'

test.setTimeout(5 * 60 * 1000)

test('M11 — Configuration & Admin', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await showChapter(page, '11', 'Configuration & Admin', 'Organisation Management · Plan Tiers · Module Entitlements · Audit Logs · Permissions')

  await setSectionLabel(page, 'M11 — Config & Admin')

  // ── 11.1 Admin dashboard
  await gotoAndWait(page, '/admin')
  await showFeature(page,
    'Admin Dashboard',
    'Platform-wide control centre. Manage organisations, switch plan tiers, toggle modules, and review the full config audit trail.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 11.2 Organisations
  await gotoAndWait(page, '/admin/orgs')
  await showFeature(page,
    'Organisation Registry',
    'Each hospital / clinic group is an "Organisation". An org contains multiple specialists and has its own plan tier and module config.'
  )
  await page.waitForTimeout(T.longRead)

  await smoothScrollDown(page, 300)
  await page.waitForTimeout(T.short)

  await showFeature(page,
    'Org-Level Module Control',
    'Toggle any of the 11 modules on/off per organisation. Premium modules (AI Synthesis, Transcription, Content Studio) require Professional+ tier.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 11.3 Plans
  await gotoAndWait(page, '/admin/plans')
  await showFeature(page,
    '3-Tier Plan System',
    'Starter (M1–M5, no AI) · Professional (all 11 modules, AI enabled, 500 referrals/month) · Enterprise (white-label, custom SLAs, unlimited).'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Entitlement Caching (Edge)',
    'Module entitlements are cached at the edge (Vercel middleware). Zero-latency permission checks. Cache invalidated on plan change.'
  )
  await page.waitForTimeout(T.longRead)

  // ── 11.4 Config
  await gotoAndWait(page, '/admin/config')
  await showFeature(page,
    'Module Feature Flags',
    'Per-org feature flags: AI on/off, WhatsApp integration, max peers (20/200/unlimited), max referrals/month. All configurable without a redeploy.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Config Audit Log',
    'Every configuration change logged: who changed it · what field · old value → new value · timestamp. Immutable. Used for compliance and debugging.'
  )
  await page.waitForTimeout(T.longRead)

  await showFeature(page,
    'Specialist Permissions',
    'Role-based access within an org: Specialist · Admin · Super-Admin. Admins can configure modules. Super-Admin can change plans.'
  )
  await page.waitForTimeout(T.read)

  await clearSectionLabel(page)
})
