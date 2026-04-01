import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Check if specialist profile exists
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data: specialist } = await supabase
          .from('specialists')
          .select('id, status, onboarding_step')
          .eq('google_id', user.id)
          .single()

        // New user — send to onboarding
        if (!specialist) {
          return NextResponse.redirect(`${origin}/onboarding`)
        }

        // Incomplete onboarding
        if (specialist.status === 'onboarding') {
          return NextResponse.redirect(`${origin}/onboarding?step=${specialist.onboarding_step}`)
        }

        // Returning user — send to intended destination
        return NextResponse.redirect(`${origin}${next}`)
      }
    }
  }

  return NextResponse.redirect(`${origin}/auth/error?message=auth_failed`)
}
