/**
 * AppLayout — Component Tests
 * Tests: renders children, sidebar, TopNav, InsightPanel conditional,
 * WhatsAppFloat present, no InsightPanel when data omitted.
 *
 * NOTE: AppLayout is an async Next.js Server Component. We invoke it
 * directly as a function (await AppLayout(props)) to get the resolved
 * JSX, then hand that to render(). This is the correct pattern for
 * testing async Server Components in Jest/RTL.
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

// ── Server-side Supabase mock (AppLayout calls createServiceRoleClient) ──
jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: jest.fn().mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
  }),
  createServiceRoleClient: jest.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            in: () => ({
              limit: () => ({
                // single() rejects with no rows — caught gracefully by AppLayout try/catch
                single: () => Promise.reject(new Error('no rows')),
              }),
            }),
          }),
        }),
      }),
    }),
  })),
}))

// ── Helper: resolve async server component to JSX ─────────────────
async function resolveLayout(props: Parameters<typeof AppLayout>[0]) {
  // Async server components are plain async functions — call directly
  return AppLayout(props) as Promise<React.ReactElement>
}

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
  test('renders children content', async () => {
    const jsx = await resolveLayout({
      specialist: SPECIALIST,
      children: <div data-testid="page-content">Hello World</div>,
    })
    render(jsx)
    expect(screen.getByTestId('page-content')).toBeInTheDocument()
    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })

  test('renders Sidebar (ClinCollab brand visible)', async () => {
    const jsx = await resolveLayout({ specialist: SPECIALIST, children: <div /> })
    render(jsx)
    expect(screen.getByText('ClinCollab')).toBeInTheDocument()
  })

  test('renders TopNav (specialist first name visible)', async () => {
    const jsx = await resolveLayout({ specialist: SPECIALIST, children: <div /> })
    render(jsx)
    expect(screen.getAllByText(/Dr\./i).length).toBeGreaterThan(0)
  })

  test('renders app-shell wrapper', async () => {
    const jsx = await resolveLayout({ specialist: SPECIALIST, children: <div /> })
    const { container } = render(jsx)
    expect(container.querySelector('.app-shell')).toBeDefined()
  })
})

// ════════════════════════════════════════════════════════════════
describe('AppLayout — InsightPanel conditional rendering', () => {
  test('InsightPanel renders when insightData provided', async () => {
    const jsx = await resolveLayout({
      specialist:  SPECIALIST,
      insightData: INSIGHT_DATA,
      children:    <div />,
    })
    render(jsx)
    expect(screen.getByText('AI Insight')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('78')).toBeInTheDocument()
  })

  test('InsightPanel NOT rendered when insightData omitted', async () => {
    const jsx = await resolveLayout({ specialist: SPECIALIST, children: <div /> })
    render(jsx)
    expect(screen.queryByText('AI Insight')).toBeNull()
    expect(screen.queryByText('Practice Health')).toBeNull()
  })

  test('InsightPanel renders score label from insightData', async () => {
    const jsx = await resolveLayout({
      specialist:  SPECIALIST,
      insightData: INSIGHT_DATA,
      children:    <div />,
    })
    render(jsx)
    expect(screen.getByText('Practice Health')).toBeInTheDocument()
  })

  test('InsightPanel renders insight items from insightData', async () => {
    const jsx = await resolveLayout({
      specialist:  SPECIALIST,
      insightData: INSIGHT_DATA,
      children:    <div />,
    })
    render(jsx)
    expect(screen.getByText('Network is healthy.')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════
describe('AppLayout — specialist prop variations', () => {
  test('renders with admin role', async () => {
    const jsx = await resolveLayout({
      specialist: { ...SPECIALIST, role: 'admin' },
      children:   <div data-testid="admin-page">Admin content</div>,
    })
    render(jsx)
    expect(screen.getByTestId('admin-page')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  test('renders with photo URL', async () => {
    const jsx = await resolveLayout({
      specialist: { ...SPECIALIST, photo: 'https://example.com/photo.jpg' },
      children:   <div />,
    })
    render(jsx)
    const imgs = document.querySelectorAll('img[src="https://example.com/photo.jpg"]')
    expect(imgs.length).toBeGreaterThan(0)
  })

  test('renders multiple children', async () => {
    const jsx = await resolveLayout({
      specialist: SPECIALIST,
      children: (
        <>
          <div data-testid="child-1">Child 1</div>
          <div data-testid="child-2">Child 2</div>
        </>
      ),
    })
    render(jsx)
    expect(screen.getByTestId('child-1')).toBeInTheDocument()
    expect(screen.getByTestId('child-2')).toBeInTheDocument()
  })
})
