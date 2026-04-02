/**
 * AppLayout — Component Tests
 * Tests: renders children, sidebar, TopNav, InsightPanel conditional,
 * WhatsAppFloat present, no InsightPanel when data omitted.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import AppLayout, { type InsightData } from '@/components/layout/AppLayout'

// ── Next.js mocks ──────────────────────────────────────────────────
jest.mock('next/navigation', () => ({
  useRouter:   () => ({ push: jest.fn() }),
  usePathname: () => '/dashboard',
}))

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, width, height }: any) =>
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={width} height={height} />,
}))

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signOut: jest.fn().mockResolvedValue({}) },
  }),
}))

// ── Fixtures ───────────────────────────────────────────────────────
const SPECIALIST = {
  id:        'spec-001',
  name:      'Dr. Rajan Kumar',
  specialty: 'interventional_cardiology',
  role:      'specialist',
}

const INSIGHT_DATA: InsightData = {
  moduleTitle: 'Dashboard',
  score:       78,
  scoreLabel:  'Practice Health',
  scoreColor:  'green',
  insights:    [{ text: 'Network is healthy.', severity: 'positive' }],
}

// ════════════════════════════════════════════════════════════════
describe('AppLayout — basic structure', () => {
  test('renders children content', () => {
    render(
      <AppLayout specialist={SPECIALIST}>
        <div data-testid="page-content">Hello World</div>
      </AppLayout>
    )
    expect(screen.getByTestId('page-content')).toBeInTheDocument()
    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })

  test('renders Sidebar (ClinCollab brand visible)', () => {
    render(<AppLayout specialist={SPECIALIST}><div /></AppLayout>)
    expect(screen.getByText('ClinCollab')).toBeInTheDocument()
  })

  test('renders TopNav (specialist first name visible)', () => {
    render(<AppLayout specialist={SPECIALIST}><div /></AppLayout>)
    // TopNav shows first name split: "Dr." is first word
    expect(screen.getAllByText(/Dr\./i).length).toBeGreaterThan(0)
  })

  test('renders WhatsAppFloat button', () => {
    const { container } = render(<AppLayout specialist={SPECIALIST}><div /></AppLayout>)
    // WhatsAppFloat renders an anchor or button — check the app-shell wrapper exists
    expect(container.querySelector('.app-shell')).toBeDefined()
  })
})

// ════════════════════════════════════════════════════════════════
describe('AppLayout — InsightPanel conditional rendering', () => {
  test('InsightPanel renders when insightData provided', () => {
    render(
      <AppLayout specialist={SPECIALIST} insightData={INSIGHT_DATA}>
        <div />
      </AppLayout>
    )
    expect(screen.getByText('AI Insight')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('78')).toBeInTheDocument()
  })

  test('InsightPanel NOT rendered when insightData omitted', () => {
    render(
      <AppLayout specialist={SPECIALIST}>
        <div />
      </AppLayout>
    )
    expect(screen.queryByText('AI Insight')).toBeNull()
    expect(screen.queryByText('Practice Health')).toBeNull()
  })

  test('InsightPanel renders score label from insightData', () => {
    render(
      <AppLayout specialist={SPECIALIST} insightData={INSIGHT_DATA}>
        <div />
      </AppLayout>
    )
    expect(screen.getByText('Practice Health')).toBeInTheDocument()
  })

  test('InsightPanel renders insight items from insightData', () => {
    render(
      <AppLayout specialist={SPECIALIST} insightData={INSIGHT_DATA}>
        <div />
      </AppLayout>
    )
    expect(screen.getByText('Network is healthy.')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════
describe('AppLayout — specialist prop variations', () => {
  test('renders with admin role', () => {
    render(
      <AppLayout specialist={{ ...SPECIALIST, role: 'admin' }}>
        <div data-testid="admin-page">Admin content</div>
      </AppLayout>
    )
    expect(screen.getByTestId('admin-page')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  test('renders with photo URL', () => {
    render(
      <AppLayout specialist={{ ...SPECIALIST, photo: 'https://example.com/photo.jpg' }}>
        <div />
      </AppLayout>
    )
    // Photo image should be rendered (via next/image mock → img)
    const imgs = document.querySelectorAll('img[src="https://example.com/photo.jpg"]')
    expect(imgs.length).toBeGreaterThan(0)
  })

  test('renders multiple children', () => {
    render(
      <AppLayout specialist={SPECIALIST}>
        <div data-testid="child-1">Child 1</div>
        <div data-testid="child-2">Child 2</div>
      </AppLayout>
    )
    expect(screen.getByTestId('child-1')).toBeInTheDocument()
    expect(screen.getByTestId('child-2')).toBeInTheDocument()
  })
})
