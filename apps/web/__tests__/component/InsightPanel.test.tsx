/**
 * InsightPanel — Component Tests
 * Tests score ring rendering, insight items, benchmark, CTA buttons.
 * Uses React Testing Library with jsdom (configured in jest.setup.ts).
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import InsightPanel, { type InsightData } from '@/components/layout/InsightPanel'

// ── Next.js router mock ───────────────────────────────────────────
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter:   () => ({ push: mockPush }),
  usePathname: () => '/dashboard',
}))

// ── Minimal valid InsightData ─────────────────────────────────────
const BASE_DATA: InsightData = {
  moduleTitle: 'Network Health',
  score:       72,
  scoreLabel:  'Network Score',
  scoreColor:  'green',
  insights: [
    { text: 'You have 8 active referrers this month.',  severity: 'positive' },
    { text: '3 colleagues are drifting — re-engage.',   severity: 'warning'  },
    { text: '1 high-value referrer is now silent.',     severity: 'critical' },
    { text: 'City benchmark: 18 peers in Mumbai.',      severity: 'info'     },
  ],
}

// ── Helpers ───────────────────────────────────────────────────────
function renderPanel(data: InsightData = BASE_DATA) {
  return render(<InsightPanel data={data} />)
}

// ════════════════════════════════════════════════════════════════
describe('InsightPanel — module title and AI label', () => {
  test('renders AI Insight label', () => {
    renderPanel()
    expect(screen.getByText(/AI Insight/i)).toBeInTheDocument()
  })

  test('renders module title', () => {
    renderPanel()
    expect(screen.getByText('Network Health')).toBeInTheDocument()
  })

  test('renders footer attribution text', () => {
    renderPanel()
    expect(screen.getByText(/Powered by ClinCollab AI/i)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════
describe('InsightPanel — score ring', () => {
  test('renders numeric score', () => {
    renderPanel()
    expect(screen.getByText('72')).toBeInTheDocument()
  })

  test('renders /100 scale indicator', () => {
    renderPanel()
    expect(screen.getByText('/100')).toBeInTheDocument()
  })

  test('renders score label', () => {
    renderPanel()
    expect(screen.getByText('Network Score')).toBeInTheDocument()
  })

  test('renders score = 0 correctly', () => {
    renderPanel({ ...BASE_DATA, score: 0 })
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  test('renders score = 100 correctly', () => {
    renderPanel({ ...BASE_DATA, score: 100 })
    expect(screen.getByText('100')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════
describe('InsightPanel — insight items', () => {
  test('renders all 4 insight items', () => {
    renderPanel()
    expect(screen.getByText('You have 8 active referrers this month.')).toBeInTheDocument()
    expect(screen.getByText('3 colleagues are drifting — re-engage.')).toBeInTheDocument()
    expect(screen.getByText('1 high-value referrer is now silent.')).toBeInTheDocument()
    expect(screen.getByText('City benchmark: 18 peers in Mumbai.')).toBeInTheDocument()
  })

  test('renders with empty insights array', () => {
    renderPanel({ ...BASE_DATA, insights: [] })
    // Panel still renders without crashing
    expect(screen.getByText('Network Health')).toBeInTheDocument()
  })

  test('renders single insight item', () => {
    renderPanel({ ...BASE_DATA, insights: [{ text: 'Only one insight.', severity: 'positive' }] })
    expect(screen.getByText('Only one insight.')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════
describe('InsightPanel — benchmark section', () => {
  test('renders benchmark when provided', () => {
    renderPanel({ ...BASE_DATA, benchmark: 'Top performers in Mumbai have 18+ active referrers.' })
    expect(screen.getByText(/Top performers in Mumbai/i)).toBeInTheDocument()
    expect(screen.getByText(/Peer Benchmark/i)).toBeInTheDocument()
  })

  test('does NOT render benchmark section when undefined', () => {
    const { container } = renderPanel({ ...BASE_DATA, benchmark: undefined })
    expect(container.querySelector('[data-testid="benchmark"]') ).toBeNull()
    expect(screen.queryByText(/Peer Benchmark/i)).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
describe('InsightPanel — CTA buttons', () => {
  beforeEach(() => mockPush.mockClear())

  test('renders primary CTA button when provided', () => {
    renderPanel({ ...BASE_DATA, cta: { label: 'Add Colleagues', href: '/network/add' } })
    expect(screen.getByRole('button', { name: /Add Colleagues/i })).toBeInTheDocument()
  })

  test('primary CTA navigates on click', () => {
    renderPanel({ ...BASE_DATA, cta: { label: 'Add Colleagues', href: '/network/add' } })
    fireEvent.click(screen.getByRole('button', { name: /Add Colleagues/i }))
    expect(mockPush).toHaveBeenCalledWith('/network/add')
  })

  test('renders secondary CTA when provided', () => {
    renderPanel({
      ...BASE_DATA,
      cta:          { label: 'Add Colleagues',  href: '/network/add' },
      secondaryCta: { label: 'View Analytics',  href: '/network' },
    })
    expect(screen.getByRole('button', { name: /View Analytics/i })).toBeInTheDocument()
  })

  test('secondary CTA navigates on click', () => {
    renderPanel({
      ...BASE_DATA,
      secondaryCta: { label: 'View Analytics', href: '/network' },
    })
    fireEvent.click(screen.getByRole('button', { name: /View Analytics/i }))
    expect(mockPush).toHaveBeenCalledWith('/network')
  })

  test('no CTA buttons rendered when neither provided', () => {
    renderPanel({ ...BASE_DATA, cta: undefined, secondaryCta: undefined })
    expect(screen.queryByRole('button', { name: /Add/i })).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
describe('InsightPanel — score colors', () => {
  const COLORS: Array<InsightData['scoreColor']> = ['green', 'amber', 'red', 'blue', 'purple']

  COLORS.forEach(color => {
    test(`renders without crash for scoreColor="${color}"`, () => {
      renderPanel({ ...BASE_DATA, scoreColor: color })
      expect(screen.getByText('Network Health')).toBeInTheDocument()
    })
  })
})
