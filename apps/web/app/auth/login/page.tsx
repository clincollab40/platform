'use client'

import { Suspense } from 'react'
import { useState } from 'react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

function LoginForm() {
  const [loading, setLoading] = useState(false)
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') || '/dashboard'

  async function handleGoogleLogin() {
    setLoading(true)
    const supabase = createClient()

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${redirectTo}`,
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account',
        },
      },
    })

    if (error) {
      toast.error('Could not connect to Google. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="card-clinical">
      <div className="mb-6">
        <h2 className="font-sans text-base font-medium text-navy-800 mb-1">
          Sign in to your practice
        </h2>
        <p className="text-sm text-navy-800/50">
          Access your clinical peer intelligence
        </p>
      </div>

      {/* Google button */}
      <button
        onClick={handleGoogleLogin}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 bg-white border
                   border-navy-800/15 rounded-xl px-5 py-3.5 text-sm font-medium
                   text-navy-800 hover:bg-navy-50 hover:border-navy-800/30
                   active:scale-98 transition-all duration-200 shadow-clinical
                   disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? (
          <span className="w-5 h-5 border-2 border-navy-800/20 border-t-navy-800 rounded-full animate-spin" />
        ) : (
          <GoogleIcon />
        )}
        <span>{loading ? 'Connecting...' : 'Continue with Google'}</span>
      </button>

      {/* Trust indicators */}
      <div className="mt-5 pt-5 border-t border-navy-800/8">
        <div className="flex items-start gap-2 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-forest-700 mt-1.5 flex-shrink-0" />
          <p className="text-xs text-navy-800/50 leading-relaxed">
            Your clinical data is isolated and private — no colleague can access your network
          </p>
        </div>
        <div className="flex items-start gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-forest-700 mt-1.5 flex-shrink-0" />
          <p className="text-xs text-navy-800/50 leading-relaxed">
            By continuing, you agree to our{' '}
            <a href="https://clincollab.com/terms" className="text-navy-800/70 underline underline-offset-2">
              terms of service
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-clinical-light flex flex-col items-center justify-center px-4">

      {/* Background subtle grid */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(26,82,118,0.04) 1px, transparent 0)`,
          backgroundSize: '32px 32px',
        }}
      />

      {/* Card */}
      <div className="relative w-full max-w-sm animate-slide-up">

        {/* Logo and brand */}
        <div className="flex flex-col items-center mb-10">
          <Image
            src="/logo.png"
            alt="ClinCollab"
            width={72}
            height={72}
            className="mb-4"
            priority
          />
          <h1 className="font-display text-3xl text-navy-800 mb-1">ClinCollab</h1>
          <p className="text-sm text-navy-800/60 font-sans text-center leading-relaxed">
            Clinical peer engagement for<br />procedural specialists
          </p>
        </div>

        {/* Login card — useSearchParams wrapped in Suspense */}
        <Suspense fallback={
          <div className="card-clinical flex items-center justify-center py-8">
            <span className="w-5 h-5 border-2 border-navy-800/20 border-t-navy-800 rounded-full animate-spin" />
          </div>
        }>
          <LoginForm />
        </Suspense>

        {/* Footer */}
        <p className="text-center text-xs text-navy-800/30 mt-6">
          ClinCollab · Hyderabad, India
        </p>
      </div>
    </main>
  )
}
