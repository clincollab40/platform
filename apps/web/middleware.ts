import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes accessible without authentication
const PUBLIC_ROUTES = [
  '/',
  '/auth/login', '/auth/callback', '/auth/error',
  '/refer/',     // M3 — public referral form for referring doctors
  '/triage/',    // M5 — public triage form for patients
  '/api/',       // API routes handle their own auth internally
]

const ADMIN_ROUTES    = ['/admin']
const ORG_ADMIN_ROUTES = ['/org-admin']

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  const isPublicRoute   = PUBLIC_ROUTES.some(r => pathname.startsWith(r))
  const isAdminRoute    = ADMIN_ROUTES.some(r => pathname.startsWith(r))
  const isOrgAdminRoute = ORG_ADMIN_ROUTES.some(r => pathname.startsWith(r))

  // Unauthenticated — redirect to login except for public routes
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  // Admin route — check email whitelist
  if (user && isAdminRoute) {
    const adminEmails = (process.env.ADMIN_EMAIL_WHITELIST || '').split(',').map(e => e.trim())
    if (!adminEmails.includes(user.email || '')) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
  }

  // Org Admin route — must be authenticated (org-level access check done inside the layout/actions)
  if (!user && isOrgAdminRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  // Authenticated user on login page — redirect to dashboard
  if (user && pathname === '/auth/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo.png|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
