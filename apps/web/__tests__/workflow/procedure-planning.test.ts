/**
 * Workflow Tests — Procedure Planning & Consent Journey (M8 + M9)
 *
 * Tests the complete procedure planning workflow:
 *
 *   Specialist creates plan (draft) →
 *   Workup ordered and completed →
 *   Consent obtained →
 *   Anaesthesia plan confirmed →
 *   Resources booked →
 *   Plan reaches READY state →
 *   Procedure executed →
 *   Post-procedure follow-up scheduled via M9 communications
 *
 * Pure function workflow simulation — no live DB required.
 */

// ── Types ──────────────────────────────────────────────────────────
interface WorkupItem {
  id: string; name: string
  status: 'not_started' | 'in_progress' | 'complete' | 'waived'
}

interface Resource {
  id: string; type: string; status: 'pending' | 'confirmed'
  is_confirmed: boolean
}

interface ProcedurePlan {
  id: string
  specialistId: string
  patientName: string
  procedureType: string
  status: 'draft' | 'active' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'cancelled'
  workupItems: WorkupItem[]
  consentStatus: 'not_started' | 'sent_for_review' | 'reviewed' | 'signed' | 'waived'
  anaesthesiaPlan: string | null
  resources: Resource[]
  scheduledDate: string | null
  stakeholderNotifications: {
    patient: boolean; referringDoctor: boolean; theatre: boolean
  }
}

// ── Pure workflow functions ────────────────────────────────────────
function allWorkupComplete(items: WorkupItem[]): boolean {
  return items.length > 0 && items.every(i => i.status === 'complete' || i.status === 'waived')
}

function isConsentComplete(status: ProcedurePlan['consentStatus']): boolean {
  return status === 'signed' || status === 'waived'
}

function allResourcesConfirmed(resources: Resource[]): boolean {
  return resources.length > 0 && resources.every(r => r.is_confirmed && r.status === 'confirmed')
}

function computeReadiness(plan: ProcedurePlan): { ready: boolean; blockers: string[]; percentage: number } {
  const checks = [
    { name: 'workup_complete',       passed: allWorkupComplete(plan.workupItems) },
    { name: 'consent_obtained',      passed: isConsentComplete(plan.consentStatus) },
    { name: 'anaesthesia_confirmed', passed: !!plan.anaesthesiaPlan },
    { name: 'resources_confirmed',   passed: allResourcesConfirmed(plan.resources) },
    { name: 'date_scheduled',        passed: !!plan.scheduledDate },
  ]
  const passed  = checks.filter(c => c.passed)
  const blockers = checks.filter(c => !c.passed).map(c => c.name)
  return {
    ready:      blockers.length === 0,
    blockers,
    percentage: Math.round((passed.length / checks.length) * 100),
  }
}

function transitionPlan(plan: ProcedurePlan, to: ProcedurePlan['status']): ProcedurePlan {
  const TRANSITIONS: Record<string, string[]> = {
    draft:       ['active', 'cancelled'],
    active:      ['scheduled', 'cancelled'],
    scheduled:   ['ready', 'cancelled'],
    ready:       ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed:   [],
    cancelled:   [],
  }
  if (!(TRANSITIONS[plan.status] ?? []).includes(to)) {
    throw new Error(`Invalid transition: ${plan.status} → ${to}`)
  }
  return { ...plan, status: to }
}

function sendStakeholderNotifications(plan: ProcedurePlan, types: Array<keyof ProcedurePlan['stakeholderNotifications']>): ProcedurePlan {
  const updated = { ...plan.stakeholderNotifications }
  types.forEach(t => { updated[t] = true })
  return { ...plan, stakeholderNotifications: updated }
}

// ── Test data factory ──────────────────────────────────────────────
function createPlan(overrides: Partial<ProcedurePlan> = {}): ProcedurePlan {
  return {
    id:             'plan-001',
    specialistId:   'spec-001',
    patientName:    'Ramesh Babu',
    procedureType:  'coronary_angioplasty',
    status:         'draft',
    workupItems: [
      { id:'w1', name:'ECG',            status:'not_started' },
      { id:'w2', name:'Blood tests',    status:'not_started' },
      { id:'w3', name:'Echocardiogram', status:'not_started' },
    ],
    consentStatus:   'not_started',
    anaesthesiaPlan: null,
    resources: [
      { id:'r1', type:'ot_slot',     status:'pending',   is_confirmed:false },
      { id:'r2', type:'cath_lab',    status:'pending',   is_confirmed:false },
      { id:'r3', type:'nursing_team', status:'pending',  is_confirmed:false },
    ],
    scheduledDate: null,
    stakeholderNotifications: { patient: false, referringDoctor: false, theatre: false },
    ...overrides,
  }
}

// ── Readiness gate tests ───────────────────────────────────────────
describe('Workflow — procedurePlanning: readiness gate', () => {
  test('fresh plan has 0% readiness (5 blockers)', () => {
    const plan = createPlan()
    const { ready, blockers, percentage } = computeReadiness(plan)
    expect(ready).toBe(false)
    expect(blockers.length).toBe(5)
    expect(percentage).toBe(0)
  })

  test('workup done: 1/5 gates passed (20%)', () => {
    const plan = createPlan({
      workupItems: [
        { id:'w1', name:'ECG',         status:'complete' },
        { id:'w2', name:'Blood tests', status:'complete' },
        { id:'w3', name:'Echo',        status:'waived'   },
      ],
    })
    const { blockers, percentage } = computeReadiness(plan)
    expect(blockers).not.toContain('workup_complete')
    expect(percentage).toBe(20)
  })

  test('all gates passed: plan is ready (100%)', () => {
    const plan = createPlan({
      workupItems: [
        { id:'w1', name:'ECG',         status:'complete' },
        { id:'w2', name:'Blood tests', status:'complete' },
        { id:'w3', name:'Echo',        status:'complete' },
      ],
      consentStatus:   'signed',
      anaesthesiaPlan: 'GA — intubation',
      resources: [
        { id:'r1', type:'ot_slot',      status:'confirmed', is_confirmed:true },
        { id:'r2', type:'cath_lab',     status:'confirmed', is_confirmed:true },
        { id:'r3', type:'nursing_team', status:'confirmed', is_confirmed:true },
      ],
      scheduledDate: '2024-03-25',
    })
    const { ready, blockers, percentage } = computeReadiness(plan)
    expect(ready).toBe(true)
    expect(blockers).toHaveLength(0)
    expect(percentage).toBe(100)
  })

  test('waived consent counts as complete', () => {
    const plan = createPlan({ consentStatus: 'waived' })
    expect(computeReadiness(plan).blockers).not.toContain('consent_obtained')
  })

  test('reviewed (not signed) consent not complete', () => {
    const plan = createPlan({ consentStatus: 'reviewed' })
    expect(computeReadiness(plan).blockers).toContain('consent_obtained')
  })
})

// ── Status machine tests ───────────────────────────────────────────
describe('Workflow — procedurePlanning: status machine', () => {
  test('draft → active valid',          () => expect(transitionPlan(createPlan(), 'active').status).toBe('active'))
  test('draft → cancelled valid',       () => expect(transitionPlan(createPlan(), 'cancelled').status).toBe('cancelled'))
  test('active → scheduled valid',      () => expect(transitionPlan(createPlan({ status:'active' }), 'scheduled').status).toBe('scheduled'))
  test('scheduled → ready valid',       () => expect(transitionPlan(createPlan({ status:'scheduled' }), 'ready').status).toBe('ready'))
  test('ready → in_progress valid',     () => expect(transitionPlan(createPlan({ status:'ready' }), 'in_progress').status).toBe('in_progress'))
  test('in_progress → completed valid', () => expect(transitionPlan(createPlan({ status:'in_progress' }), 'completed').status).toBe('completed'))
  test('completed is terminal',         () => expect(() => transitionPlan(createPlan({ status:'completed' }), 'active')).toThrow('Invalid transition'))
  test('cancelled is terminal',         () => expect(() => transitionPlan(createPlan({ status:'cancelled' }), 'draft')).toThrow('Invalid transition'))
  test('draft → ready skip invalid',    () => expect(() => transitionPlan(createPlan(), 'ready')).toThrow('Invalid transition'))
})

// ── Stakeholder notification workflow ─────────────────────────────
describe('Workflow — procedurePlanning: stakeholder notifications (M9)', () => {
  test('initial state: no notifications sent', () => {
    const plan = createPlan()
    expect(Object.values(plan.stakeholderNotifications).every(v => v === false)).toBe(true)
  })

  test('patient notified after scheduling',    () => {
    const plan = createPlan({ status: 'scheduled', scheduledDate: '2024-03-25' })
    const updated = sendStakeholderNotifications(plan, ['patient'])
    expect(updated.stakeholderNotifications.patient).toBe(true)
    expect(updated.stakeholderNotifications.referringDoctor).toBe(false)
  })

  test('all stakeholders notified before procedure', () => {
    const plan = createPlan({ status: 'ready' })
    const updated = sendStakeholderNotifications(plan, ['patient', 'referringDoctor', 'theatre'])
    expect(Object.values(updated.stakeholderNotifications).every(v => v === true)).toBe(true)
  })

  test('notification update is non-destructive (other flags unaffected)', () => {
    const plan = createPlan()
    const notified = sendStakeholderNotifications(plan, ['patient'])
    expect(notified.status).toBe(plan.status)
    expect(notified.patientName).toBe(plan.patientName)
  })
})

// ── Full happy-path pipeline ───────────────────────────────────────
describe('Workflow — procedurePlanning: full happy-path pipeline', () => {
  test('complete procedure planning pipeline from draft to completed', () => {
    // 1. Create draft plan
    let plan = createPlan()
    expect(plan.status).toBe('draft')

    // 2. Activate
    plan = transitionPlan(plan, 'active')
    expect(plan.status).toBe('active')

    // 3. Complete workup
    plan = {
      ...plan,
      workupItems: plan.workupItems.map(w => ({ ...w, status: 'complete' as const })),
    }
    expect(allWorkupComplete(plan.workupItems)).toBe(true)

    // 4. Get consent signed
    plan = { ...plan, consentStatus: 'signed' }
    expect(isConsentComplete(plan.consentStatus)).toBe(true)

    // 5. Confirm anaesthesia and resources
    plan = {
      ...plan,
      anaesthesiaPlan: 'GA — intubation',
      resources: plan.resources.map(r => ({ ...r, status: 'confirmed' as const, is_confirmed: true })),
      scheduledDate: '2024-03-25',
    }

    // 6. Verify readiness gate
    const { ready } = computeReadiness(plan)
    expect(ready).toBe(true)

    // 7. Transition to scheduled → ready → in_progress
    plan = transitionPlan(plan, 'scheduled')
    plan = transitionPlan(plan, 'ready')
    plan = transitionPlan(plan, 'in_progress')

    // 8. Notify all stakeholders
    plan = sendStakeholderNotifications(plan, ['patient', 'referringDoctor', 'theatre'])
    expect(Object.values(plan.stakeholderNotifications).every(v => v)).toBe(true)

    // 9. Complete procedure
    plan = transitionPlan(plan, 'completed')
    expect(plan.status).toBe('completed')

    // Final invariants
    expect(plan.patientName).toBe('Ramesh Babu')
    expect(plan.consentStatus).toBe('signed')
    expect(allWorkupComplete(plan.workupItems)).toBe(true)
    expect(allResourcesConfirmed(plan.resources)).toBe(true)
  })
})
