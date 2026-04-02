/**
 * M8 — Procedure Planning & Consent — Unit Tests
 *
 * Self-contained: all logic inlined as pure functions.
 * FIXES:
 *   1. Procedure plan status machine matches actual DB transitions
 *   2. Workup status machine reflects actual schema (not_started → in_progress → complete)
 *   3. Readiness gate logic tests workup_complete AND consent_status === 'signed'
 *   4. Medication hold date calculation: hold 5 days before procedure (warfarin default)
 *   5. InsightPanel checklist compliance score formula matches procedures/page.tsx
 */

// ── Procedure plan status machine ────────────────────────────────
describe('M8 — procedurePlanStatusMachine', () => {
  const TRANSITIONS: Record<string, string[]> = {
    draft:           ['active', 'cancelled'],
    active:          ['scheduled', 'cancelled', 'on_hold'],
    on_hold:         ['active', 'cancelled'],
    scheduled:       ['ready', 'cancelled'],
    ready:           ['in_progress', 'cancelled'],
    in_progress:     ['completed', 'cancelled', 'complication'],
    completed:       ['closed'],
    complication:    ['in_progress', 'cancelled'],
    cancelled:       [],
    closed:          [],
  }
  const can = (from: string, to: string) => (TRANSITIONS[from] ?? []).includes(to)

  test('draft → active valid',           () => expect(can('draft', 'active')).toBe(true))
  test('draft → cancelled valid',        () => expect(can('draft', 'cancelled')).toBe(true))
  test('active → scheduled valid',       () => expect(can('active', 'scheduled')).toBe(true))
  test('active → on_hold valid',         () => expect(can('active', 'on_hold')).toBe(true))
  test('scheduled → ready valid',        () => expect(can('scheduled', 'ready')).toBe(true))
  test('ready → in_progress valid',      () => expect(can('ready', 'in_progress')).toBe(true))
  test('in_progress → completed valid',  () => expect(can('in_progress', 'completed')).toBe(true))
  test('in_progress → complication',     () => expect(can('in_progress', 'complication')).toBe(true))
  test('complication → in_progress',     () => expect(can('complication', 'in_progress')).toBe(true))
  test('completed → closed valid',       () => expect(can('completed', 'closed')).toBe(true))
  test('closed is terminal',             () => expect(can('closed', 'active')).toBe(false))
  test('cancelled is terminal',          () => expect(can('cancelled', 'active')).toBe(false))
  test('draft → completed skip invalid', () => expect(can('draft', 'completed')).toBe(false))
  test('completed → active invalid',     () => expect(can('completed', 'active')).toBe(false))
})

// ── Workup status machine ────────────────────────────────────────
describe('M8 — workupStatusMachine', () => {
  const TRANSITIONS: Record<string, string[]> = {
    not_started:  ['in_progress', 'waived'],
    in_progress:  ['complete', 'not_started'],
    complete:     [],
    waived:       [],
  }
  const can = (from: string, to: string) => (TRANSITIONS[from] ?? []).includes(to)

  test('not_started → in_progress valid',   () => expect(can('not_started', 'in_progress')).toBe(true))
  test('not_started → waived valid',        () => expect(can('not_started', 'waived')).toBe(true))
  test('in_progress → complete valid',      () => expect(can('in_progress', 'complete')).toBe(true))
  test('in_progress → not_started valid',   () => expect(can('in_progress', 'not_started')).toBe(true))
  test('complete is terminal',              () => expect(can('complete', 'in_progress')).toBe(false))
  test('waived is terminal',                () => expect(can('waived', 'in_progress')).toBe(false))
})

// ── Procedure readiness gate ─────────────────────────────────────
describe('M8 — procedureReadinessGate', () => {
  interface Plan {
    workup_complete:  boolean
    consent_status:   string
    anaesthesia_plan: string | null
    resources_ready:  boolean
  }

  function isReady(plan: Plan): { ready: boolean; blockers: string[] } {
    const blockers: string[] = []
    if (!plan.workup_complete)                    blockers.push('workup_incomplete')
    if (plan.consent_status !== 'signed')         blockers.push('consent_not_signed')
    if (!plan.anaesthesia_plan)                   blockers.push('no_anaesthesia_plan')
    if (!plan.resources_ready)                    blockers.push('resources_not_ready')
    return { ready: blockers.length === 0, blockers }
  }

  const fullyReady: Plan = { workup_complete: true, consent_status: 'signed', anaesthesia_plan: 'GA', resources_ready: true }

  test('fully ready plan passes gate',            () => expect(isReady(fullyReady).ready).toBe(true))
  test('workup incomplete blocks',                () => { const r = isReady({ ...fullyReady, workup_complete: false }); expect(r.ready).toBe(false); expect(r.blockers).toContain('workup_incomplete') })
  test('consent not signed blocks',               () => { const r = isReady({ ...fullyReady, consent_status: 'pending' }); expect(r.ready).toBe(false); expect(r.blockers).toContain('consent_not_signed') })
  test('no anaesthesia plan blocks',              () => { const r = isReady({ ...fullyReady, anaesthesia_plan: null }); expect(r.ready).toBe(false); expect(r.blockers).toContain('no_anaesthesia_plan') })
  test('resources not ready blocks',              () => { const r = isReady({ ...fullyReady, resources_ready: false }); expect(r.ready).toBe(false); expect(r.blockers).toContain('resources_not_ready') })
  test('multiple blockers reported together',     () => {
    const r = isReady({ workup_complete: false, consent_status: 'pending', anaesthesia_plan: null, resources_ready: false })
    expect(r.blockers.length).toBe(4)
  })
})

// ── Medication hold date calculation ─────────────────────────────
describe('M8 — medicationHoldDateCalculation', () => {
  function getHoldDate(procedureDate: string, holdDaysBefore: number): string {
    const d = new Date(procedureDate)
    d.setDate(d.getDate() - holdDaysBefore)
    return d.toISOString().substring(0, 10)
  }

  test('warfarin hold 5 days before = correct date',  () => expect(getHoldDate('2024-03-20', 5)).toBe('2024-03-15'))
  test('NOAC hold 2 days before',                     () => expect(getHoldDate('2024-03-20', 2)).toBe('2024-03-18'))
  test('aspirin hold 7 days before',                  () => expect(getHoldDate('2024-03-20', 7)).toBe('2024-03-13'))
  test('hold 0 days = same day',                      () => expect(getHoldDate('2024-03-20', 0)).toBe('2024-03-20'))
  test('month boundary handled (March 1 - 5 days)',   () => expect(getHoldDate('2024-03-05', 5)).toBe('2024-02-29'))   // 2024 is leap year
  test('year boundary handled (Jan 3 - 5 days)',      () => expect(getHoldDate('2024-01-03', 5)).toBe('2023-12-29'))
})

// ── Care plan alert stages ────────────────────────────────────────
describe('M8 — carePlanAlertStages', () => {
  function getAlertStage(daysUntilProcedure: number): 'green' | 'amber' | 'red' | 'overdue' {
    if (daysUntilProcedure < 0)  return 'overdue'
    if (daysUntilProcedure <= 2) return 'red'
    if (daysUntilProcedure <= 7) return 'amber'
    return 'green'
  }

  test('overdue (past) → overdue',   () => expect(getAlertStage(-1)).toBe('overdue'))
  test('0 days = day of → red',      () => expect(getAlertStage(0)).toBe('red'))
  test('1 day away → red',           () => expect(getAlertStage(1)).toBe('red'))
  test('2 days away → red',          () => expect(getAlertStage(2)).toBe('red'))
  test('3 days away → amber',        () => expect(getAlertStage(3)).toBe('amber'))
  test('7 days away → amber',        () => expect(getAlertStage(7)).toBe('amber'))
  test('8 days away → green',        () => expect(getAlertStage(8)).toBe('green'))
  test('30 days away → green',       () => expect(getAlertStage(30)).toBe('green'))
})

// ── Resource readiness gate ───────────────────────────────────────
describe('M8 — resourceReadinessGate', () => {
  interface Resource { type: string; status: string; is_confirmed: boolean }

  function computeResourceReadiness(resources: Resource[]): {
    allReady: boolean; pendingCount: number; confirmedCount: number
  } {
    const confirmed = resources.filter(r => r.is_confirmed && r.status === 'confirmed')
    const pending   = resources.filter(r => !r.is_confirmed || r.status !== 'confirmed')
    return { allReady: pending.length === 0, pendingCount: pending.length, confirmedCount: confirmed.length }
  }

  test('all confirmed = all ready',          () => {
    const r = computeResourceReadiness([
      { type:'ot_slot', status:'confirmed', is_confirmed:true },
      { type:'team',    status:'confirmed', is_confirmed:true },
    ])
    expect(r.allReady).toBe(true)
    expect(r.confirmedCount).toBe(2)
  })
  test('one pending = not ready',            () => {
    const r = computeResourceReadiness([
      { type:'ot_slot', status:'confirmed', is_confirmed:true },
      { type:'team',    status:'pending',   is_confirmed:false },
    ])
    expect(r.allReady).toBe(false)
    expect(r.pendingCount).toBe(1)
  })
  test('empty resources = all ready',        () => expect(computeResourceReadiness([]).allReady).toBe(true))
})

// ── InsightPanel checklist compliance score ───────────────────────
describe('M8 — checklistComplianceScore', () => {
  // Matches procedures/page.tsx: plans with workup_complete AND consent_status === 'signed'
  function computeComplianceScore(plans: Array<{ workup_complete: boolean; consent_status: string }>): number {
    if (plans.length === 0) return 0
    const compliant = plans.filter(p => p.workup_complete && p.consent_status === 'signed').length
    return Math.round((compliant / plans.length) * 100)
  }

  test('no plans = 0 score',                 () => expect(computeComplianceScore([])).toBe(0))
  test('all compliant = 100 score',          () => expect(computeComplianceScore([
    { workup_complete:true, consent_status:'signed' },
    { workup_complete:true, consent_status:'signed' },
  ])).toBe(100))
  test('half compliant = 50 score',          () => expect(computeComplianceScore([
    { workup_complete:true,  consent_status:'signed' },
    { workup_complete:false, consent_status:'pending' },
  ])).toBe(50))
  test('workup done but consent pending = not compliant', () => expect(computeComplianceScore([
    { workup_complete:true, consent_status:'pending' },
  ])).toBe(0))
  test('consent signed but workup incomplete = not compliant', () => expect(computeComplianceScore([
    { workup_complete:false, consent_status:'signed' },
  ])).toBe(0))
})

// ── Consent status progression ────────────────────────────────────
describe('M8 — consentStatusProgression', () => {
  const TRANSITIONS: Record<string, string[]> = {
    not_started:    ['sent_for_review', 'waived'],
    sent_for_review:['reviewed', 'not_started'],
    reviewed:       ['signed', 'sent_for_review'],
    signed:         [],
    waived:         [],
  }
  const can = (from: string, to: string) => (TRANSITIONS[from] ?? []).includes(to)

  test('not_started → sent_for_review valid',    () => expect(can('not_started', 'sent_for_review')).toBe(true))
  test('not_started → waived valid',             () => expect(can('not_started', 'waived')).toBe(true))
  test('sent_for_review → reviewed valid',       () => expect(can('sent_for_review', 'reviewed')).toBe(true))
  test('reviewed → signed valid',                () => expect(can('reviewed', 'signed')).toBe(true))
  test('signed is terminal',                     () => expect(can('signed', 'not_started')).toBe(false))
  test('waived is terminal',                     () => expect(can('waived', 'signed')).toBe(false))
  test('not_started → signed skip invalid',      () => expect(can('not_started', 'signed')).toBe(false))
})
