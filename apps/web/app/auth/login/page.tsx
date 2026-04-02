'use client'

import { Suspense, useState } from 'react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

function EcgLine() {
  return (
    <svg viewBox="0 0 900 60" preserveAspectRatio="none" className="w-full" fill="none">
      <path
        d="M0,30 L80,30 L95,30 L105,4 L115,56 L125,30 L140,30
           L160,30 L170,12 L176,48 L182,30 L200,30 L280,30
           L295,30 L305,4 L315,56 L325,30 L340,30
           L360,30 L370,12 L376,48 L382,30 L400,30 L480,30
           L495,30 L505,4 L515,56 L525,30 L540,30
           L560,30 L570,12 L576,48 L582,30 L600,30 L680,30
           L695,30 L705,4 L715,56 L725,30 L740,30
           L760,30 L770,12 L776,48 L782,30 L900,30"
        stroke="rgba(93,173,226,0.35)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded-xl p-4 border"
      style={{ background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.10)' }}>
      <div className="font-display text-2xl font-medium text-white">{value}</div>
      <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</div>
    </div>
  )
}

function MolecularPattern() {
  return (
    <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="hex" x="0" y="0" width="56" height="48" patternUnits="userSpaceOnUse">
          <polygon points="14,4 42,4 56,24 42,44 14,44 0,24"
            fill="none" stroke="rgba(93,173,226,0.07)" strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hex)" />
    </svg>
  )
}

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
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    })
    if (error) {
      toast.error('Could not connect to Google. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm animate-slide-up">
      {/* Mobile logo */}
      <div className="flex flex-col items-center mb-8 lg:hidden">
        <Image src="/logo.png" alt="ClinCollab" width={56} height={56} className="mb-3" priority />
        <h1 className="font-display text-2xl text-navy-800">ClinCollab</h1>
        <p className="text-sm text-center mt-1" style={{ color: 'rgba(26,82,118,0.50)' }}>
          Clinical Relationship &amp; Practice Growth Platform
        </p>
      </div>

      <div className="bg-white rounded-3xl border border-navy-800/8 shadow-clinical-lg p-8">
        <div className="mb-7">
          <h2 className="font-display text-2xl text-ink font-medium mb-1.5">Welcome back</h2>
          <p className="text-sm" style={{ color: 'rgba(13,27,42,0.50)' }}>
            Sign in to your practice intelligence platform
          </p>
        </div>

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white border border-navy-800/15
                     rounded-2xl px-5 py-3.5 text-sm font-medium text-ink
                     hover:bg-navy-50 hover:border-navy-800/25 transition-all duration-200
                     shadow-sm disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
        >
          {loading ? (
            <span className="w-5 h-5 border-2 border-navy-800/20 border-t-navy-800 rounded-full animate-spin" />
          ) : (
            <GoogleIcon />
          )}
          <span>{loading ? 'Connecting...' : 'Continue with Google'}</span>
        </button>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px" style={{ background: 'rgba(26,82,118,0.08)' }} />
          <span className="text-xs font-mono" style={{ color: 'rgba(26,82,118,0.30)' }}>SECURE LOGIN</span>
          <div className="flex-1 h-px" style={{ background: 'rgba(26,82,118,0.08)' }} />
        </div>

        <div className="space-y-2.5">
          {[
            'Your clinical data is fully isolated and private',
            'DISHA-compliant, enterprise-grade security',
            'No colleague can access your network without permission',
          ].map((text, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-forest-700 mt-1.5 flex-shrink-0" />
              <p className="text-xs leading-relaxed" style={{ color: 'rgba(13,27,42,0.40)' }}>{text}</p>
            </div>
          ))}
        </div>

        <p className="text-xs mt-5 text-center leading-relaxed" style={{ color: 'rgba(26,82,118,0.30)' }}>
          By continuing, you agree to our{' '}
          <a href="https://clincollab.com/terms" className="text-navy-800/60 underline underline-offset-2 hover:text-navy-800">
            Terms
          </a>{' '}
          and{' '}
          <a href="https://clincollab.com/privacy" className="text-navy-800/60 underline underline-offset-2 hover:text-navy-800">
            Privacy Policy
          </a>
        </p>
      </div>

      <p className="text-center text-xs mt-5" style={{ color: 'rgba(26,82,118,0.30)' }}>
        ClinCollab · Hyderabad, India · DISHA Compliant
      </p>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex">

      {/* LEFT: Clinical hero — desktop only */}
      <div
        className="hidden lg:flex flex-col justify-between w-3/5 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #050D18 0%, #0A1F35 35%, #0F3A5C 70%, #1A5276 100%)' }}
      >
        <MolecularPattern />

        {/* Glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(93,173,226,0.10) 0%, transparent 70%)' }} />

        {/* Top content */}
        <div className="relative z-10 p-12">
          <div className="flex items-center gap-4 mb-16">
            <Image src="/logo.png" alt="ClinCollab" width={44} height={44} priority />
            <div>
              <div className="font-display text-xl text-white">ClinCollab</div>
              <div className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.35)' }}>PRACTICE INTELLIGENCE</div>
            </div>
          </div>

          <div className="max-w-lg">
            <h1 className="font-display text-5xl leading-tight font-medium text-white mb-6">
              Clinical Relationship<br />
              &amp; <span style={{ color: '#5DADE2' }}>Practice Growth</span><br />
              Platform
            </h1>
            <p className="text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Built for procedural specialists — grow your referral network,
              engage peers with evidence, and deliver better patient outcomes.
            </p>
          </div>

          <div className="mt-10 space-y-3">
            {[
              'AI-powered peer network health monitoring',
              'Automated referral tracking & case management',
              '360° pre-consultation synthesis from all data',
              'WhatsApp-native patient & peer engagement',
              'CME, Roundtable & Conference management',
            ].map((feat, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: 'rgba(93,173,226,0.18)' }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2 2 4-4" stroke="#5DADE2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.60)' }}>{feat}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom: stats + ECG */}
        <div className="relative z-10 p-12 pt-0">
          <div className="flex gap-3 mb-6">
            <StatCard value="2,400+" label="Specialists enrolled" />
            <StatCard value="34%"    label="Avg referral growth" />
            <StatCard value="4.8★"   label="Satisfaction score" />
          </div>
          <EcgLine />
        </div>
      </div>

      {/* RIGHT: Auth panel */}
      <div className="flex-1 flex items-center justify-center bg-white px-6 py-12 relative">
        <div className="fixed inset-0 pointer-events-none lg:hidden"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(26,82,118,0.04) 1px, transparent 0)`,
            backgroundSize: '32px 32px',
          }} />
        <Suspense fallback={
          <div className="flex items-center justify-center py-20">
            <span className="w-6 h-6 border-2 border-navy-800/20 border-t-navy-800 rounded-full animate-spin" />
          </div>
        }>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
