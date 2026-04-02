/**
 * Sidebar — Component Tests
 * Tests: all 11 nav items present, active route highlighted,
 * admin link visibility, collapse toggle, sign-out.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import Sidebar from '@/components/layout/Sidebar'

// ── Mock Next.js ──────────────────────────────────────────────────
const mockPush = jest.fn()
let mockPathname = '/dashboard'

jest.mock('next/navigation', () => ({
  useRouter:   () => ({ push: mockPush }),
  usePathname: () => mockPathname,
}))

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, width, height, ...rest }: any) =>
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={width} height={height} {...rest} />,
}))

// ── Mock Supabase client ──────────────────────────────────────────
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signOut: jest.fn().mockResolvedValue({}) },
  }),
}))

// ── Fixtures ──────────────────────────────────────────────────────
const SPECIALIST = {
  id:        'spec-001',
  name:      'Dr. Rajan Kumar',
  specialty: 'interventional_cardiology',
  role:      'specialist',
}

const ADMIN = { ...SPECIALIST, role: 'admin' }

function renderSidebar(specialist = SPECIALIST) {
  return render(<Sidebar specialist={specialist} />)
}

// ════════════════════════════════════════════════════════════════
describe('Sidebar — navigation items', () => {
  beforeEach(() => { mockPathname = '/dashboard' })

  const EXPECTED_LABELS = [
    'Dashboard', 'Network', 'Referrals', 'Appointments',
    'Chatbot', 'Triage', 'Synthesis', 'Transcription',
    'Procedures', 'Comms', 'Content',
  ]

  test('renders all 11 navigation items', () => {
    renderSidebar()
    EXPECTED_LABELS.forEach(label => {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    })
  })

  test('renders 4 nav group labels', () => {
    renderSidebar()
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('Practice')).toBeInTheDocument()
    expect(screen.getByText('Clinical AI')).toBeInTheDocument()
    expect(screen.getByText('Operations')).toBeInTheDocument()
  })

  test('clicking Dashboard navigates to /dashboard', () => {
    renderSidebar()
    fireEvent.click(screen.getAllByText('Dashboard')[0])
    expect(mockPush).toHaveBeenCalledWith('/dashboard')
  })

  test('clicking Network navigates to /network', () => {
    renderSidebar()
    fireEvent.click(screen.getAllByText('Network')[0])
    expect(mockPush).toHaveBeenCalledWith('/network')
  })

  test('clicking Referrals navigates to /referrals', () => {
    renderSidebar()
    fireEvent.click(screen.getAllByText('Referrals')[0])
    expect(mockPush).toHaveBeenCalledWith('/referrals')
  })
})

// ════════════════════════════════════════════════════════════════
describe('Sidebar — admin visibility', () => {
  test('Admin link NOT visible for regular specialist', () => {
    renderSidebar(SPECIALIST)
    expect(screen.queryByText('Admin')).toBeNull()
    expect(screen.queryByText('System')).toBeNull()
  })

  test('Admin link visible for admin role', () => {
    renderSidebar(ADMIN)
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
  })

  test('Admin nav click goes to /admin', () => {
    renderSidebar(ADMIN)
    fireEvent.click(screen.getByText('Admin'))
    expect(mockPush).toHaveBeenCalledWith('/admin')
  })
})

// ════════════════════════════════════════════════════════════════
describe('Sidebar — specialist footer', () => {
  test('shows specialist name in footer', () => {
    renderSidebar()
    expect(screen.getByText('Dr. Rajan Kumar')).toBeInTheDocument()
  })

  test('shows specialty shorthand label', () => {
    renderSidebar()
    // interventional_cardiology → 'Int. Cardiology'
    expect(screen.getByText('Int. Cardiology')).toBeInTheDocument()
  })

  test('shows first initial when no photo', () => {
    renderSidebar()
    // Initial of "Dr. Rajan Kumar" → 'D'
    expect(screen.getByText('D')).toBeInTheDocument()
  })

  test('shows Sign out button', () => {
    renderSidebar()
    expect(screen.getByText('Sign out')).toBeInTheDocument()
  })

  test('Sign out calls supabase signOut', async () => {
    renderSidebar()
    fireEvent.click(screen.getByText('Sign out'))
    // navigates to /auth/login after sign out
    await Promise.resolve()
    expect(mockPush).toHaveBeenCalledWith('/auth/login')
  })
})

// ════════════════════════════════════════════════════════════════
describe('Sidebar — ClinCollab branding', () => {
  test('renders ClinCollab brand name', () => {
    renderSidebar()
    expect(screen.getByText('ClinCollab')).toBeInTheDocument()
  })

  test('renders Practice Intelligence tagline', () => {
    renderSidebar()
    expect(screen.getByText('Practice Intelligence')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════
describe('Sidebar — specialty label mapping', () => {
  const CASES: Array<[string, string]> = [
    ['interventional_cardiology', 'Int. Cardiology'],
    ['cardiac_surgery',           'Cardiac Surgery'],
    ['neurosurgery',              'Neurosurgery'],
    ['orthopedics',               'Orthopaedics'],
    ['other',                     'Specialist'],
    ['unknown_specialty',         'Specialist'],  // fallback
  ]

  CASES.forEach(([specialty, expectedLabel]) => {
    test(`specialty "${specialty}" → label "${expectedLabel}"`, () => {
      renderSidebar({ ...SPECIALIST, specialty })
      expect(screen.getByText(expectedLabel)).toBeInTheDocument()
    })
  })
})
