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

const ADMIN_ROUTES = ['/admin']

// Route → module key mapping for M11 access enforcement
const ROUTE_MODULE_MAP: Record<string, string> = {
  '/network':       'm2_network',
  '/referrals':     'm3_referrals',
  '/refer':         'm3_referrals',
  '/chatbot':       'm4_chatbot',
  '/appointments':  'm4_chatbot',
  '/triage':        'm5_triage',
  '/synthesis':     'm6_synthesis',
  '/transcription': 'm7_transcription',
  '/procedures':    'm8_procedure_planner',
  '/content':       'm10_content',
}

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

  const isPublicRoute = PUBLIC_ROUTES.some(r => pathname.startsWith(r))
  const isAdminRoute  = ADMIN_ROUTES.some(r => pathname.startsWith(r))

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

  // M11: Module access enforcement at route level
  // Only enforce for authenticated users on module-specific routes
  if (user && !isAdminRoute && !isPublicRoute) {
    const matchedRoute = Object.keys(ROUTE_MODULE_MAP).find(r => pathname.startsWith(r))

    if (matchedRoute) {
      const moduleKey = ROUTE_MODULE_MAP[matchedRoute]
      try {
        // Fast check via DB function (< 10ms with connection pooling)
        const { data: hasAccess } = await supabase.rpc('check_module_access', {
          p_specialist_id: user.id,  // Note: uses google_id, resolved in DB function
          p_module_key:    moduleKey,
        })

        // Only redirect on explicit FALSE — fail-open on null/error
        if (hasAccess === false) {
          const url = request.nextUrl.clone()
          url.pathname = '/dashboard'
          url.searchParams.set('module_blocked', moduleKey)
          return NextResponse.redirect(url)
        }
      } catch {
        // Fail-open: if config check fails, allow access
        // Never block a doctor from accessing the platform due to a config service failure
      }
    }
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
