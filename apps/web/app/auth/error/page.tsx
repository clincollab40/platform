'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'Authentication could not be completed. Please try again.',
  access_denied: 'Access was denied. Please contact support if this continues.',
  default: 'An unexpected error occurred.',
}

export default function AuthErrorPage() {
  const searchParams = useSearchParams()
  const message = searchParams.get('message') || 'default'
  const errorText = ERROR_MESSAGES[message] || ERROR_MESSAGES.default

  return (
    <main className="min-h-screen bg-clinical-light flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm animate-slide-up text-center">
        <Image src="/logo.png" alt="ClinCollab" width={56} height={56} className="mx-auto mb-6" />
        <h1 className="font-display text-2xl text-navy-800 mb-2">Something went wrong</h1>
        <p className="text-sm text-navy-800/60 mb-8">{errorText}</p>
        <Link href="/auth/login" className="btn-primary inline-block">
          Return to sign in
        </Link>
      </div>
    </main>
  )
}
