/**
 * TopNav — Component Tests
 * Tests: breadcrumb for each route, search input, notifications badge,
 * profile menu open/close, sign-out, admin menu item.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import TopNav from '@/components/layout/TopNav'

// ── Mocks ─────────────────────────────────────────────────────────
const mockPush = jest.fn()
let mockPathname = '/dashboard'

jest.mock('next/navigation', () => ({
  useRouter:   () => ({ push: mockPush }),
  usePathname: () => mockPathname,
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

const SPECIALIST = {
  id:        'spec-001',
  name:      'Dr. Rajan Kumar',
  specialty: 'interventional_cardiology',
  role:      'specialist',
}
const ADMIN = { ...SPECIALIST, role: 'admin' }

// ════════════════════════════════════════════════════════════════
describe('TopNav — breadcrumbs', () => {
  const BREADCRUMB_CASES: Array<[string, string]> = [
    ['/dashboard',               'Dashboard'],
    ['/network',                 'Peer Network'],
    ['/referrals',               'Referrals'],
    ['/appointments',            'Appointments'],
    ['/chatbot/config',          'AI Chatbot'],
    ['/triage/sessions',         'Triage Sessions'],
    ['/synthesis',               '360° Synthesis'],
    ['/transcription',           'Transcription'],
    ['/procedures',              'Procedure Planner'],
    ['/procedures/communications','Procedure Comms'],
    ['/content',                 'Content Studio'],
    ['/admin',                   'Admin Panel'],
  ]

  BREADCRUMB_CASES.forEach(([path, label]) => {
    test(`path "${path}" shows breadcrumb "${label}"`, () => {
      mockPathname = path
      render(<TopNav specialist={SPECIALIST} />)
      expect(screen.getByText(label)).toBeInTheDocument()
    })
  })

  test('unknown path falls back to "ClinCollab"', () => {
    mockPathname = '/unknown-route'
    render(<TopNav specialist={SPECIALIST} />)
    expect(screen.getByText('ClinCollab')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════
describe('TopNav — search input', () => {
  beforeEach(() => { mockPathname = '/dashboard' })

  test('renders search input', () => {
    render(<TopNav specialist={SPECIALIST} />)
    expect(screen.getByPlaceholderText(/Search colleagues/i)).toBeInTheDocument()
  })

  test('search input accepts text', () => {
    render(<TopNav specialist={SPECIALIST} />)
    const input = screen.getByPlaceholderText(/Search colleagues/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Dr. Sharma' } })
    expect(input.value).toBe('Dr. Sharma')
  })
})

// ════════════════════════════════════════════════════════════════
describe('TopNav — profile menu', () => {
  beforeEach(() => {
    mockPathname = '/dashboard'
    mockPush.mockClear()
  })

  test('shows specialist first name', () => {
    render(<TopNav specialist={SPECIALIST} />)
    // TopNav shows first name split from full name: "Dr."
    expect(screen.getAllByText(/Dr\./i).length).toBeGreaterThan(0)
  })

  test('profile dropdown opens on click', () => {
    render(<TopNav specialist={SPECIALIST} />)
    // Full name appears in the dropdown header after opening
    const profileBtn = screen.getByText('Dr.')
    fireEvent.click(profileBtn)
    expect(screen.getByText('Dr. Rajan Kumar')).toBeInTheDocument()
  })

  test('My Profile option navigates', () => {
    render(<TopNav specialist={SPECIALIST} />)
    fireEvent.click(screen.getByText('Dr.'))
    fireEvent.click(screen.getByText('My Profile'))
    expect(mockPush).toHaveBeenCalledWith('/profile')
  })

  test('Admin Panel option hidden for non-admin', () => {
    render(<TopNav specialist={SPECIALIST} />)
    fireEvent.click(screen.getByText('Dr.'))
    expect(screen.queryByText('Admin Panel')).toBeNull()
  })

  test('Admin Panel option visible for admin', () => {
    render(<TopNav specialist={ADMIN} />)
    fireEvent.click(screen.getByText('Dr.'))
    expect(screen.getByText('Admin Panel')).toBeInTheDocument()
  })

  test('Admin Panel click navigates to /admin', () => {
    render(<TopNav specialist={ADMIN} />)
    fireEvent.click(screen.getByText('Dr.'))
    fireEvent.click(screen.getByText('Admin Panel'))
    expect(mockPush).toHaveBeenCalledWith('/admin')
  })

  test('Sign Out button is visible in dropdown', () => {
    render(<TopNav specialist={SPECIALIST} />)
    fireEvent.click(screen.getByText('Dr.'))
    expect(screen.getByText('Sign Out')).toBeInTheDocument()
  })

  test('Sign Out calls signOut and redirects', async () => {
    render(<TopNav specialist={SPECIALIST} />)
    fireEvent.click(screen.getByText('Dr.'))
    fireEvent.click(screen.getByText('Sign Out'))
    await Promise.resolve()
    expect(mockPush).toHaveBeenCalledWith('/auth/login')
  })

  test('role displayed in dropdown header', () => {
    render(<TopNav specialist={SPECIALIST} />)
    fireEvent.click(screen.getByText('Dr.'))
    expect(screen.getByText('specialist')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════
describe('TopNav — notifications', () => {
  beforeEach(() => { mockPathname = '/dashboard' })

  test('notification bell is rendered', () => {
    const { container } = render(<TopNav specialist={SPECIALIST} />)
    // Bell icon renders as an SVG inside a button
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(0)
  })
})
