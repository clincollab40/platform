'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ContentDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error('[ClinCollab/Content/Detail] Client error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-clinical-light flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-navy-800/8 p-6 text-center">
        <div className="text-3xl mb-3">⚠️</div>
        <h2 className="text-base font-semibold text-navy-800 mb-2">Something went wrong loading this content</h2>
        <div className="bg-red-50 border border-red-200/60 rounded-xl px-4 py-3 mb-4 text-left">
          <p className="text-xs font-mono text-red-700 break-all leading-relaxed">
            {error.message || 'Unknown error'}
          </p>
          {error.digest && (
            <p className="text-2xs text-red-500/70 mt-1">Digest: {error.digest}</p>
          )}
        </div>
        <div className="flex gap-2.5 justify-center">
          <button
            onClick={() => router.push('/content')}
            className="text-sm text-navy-800/60 border border-navy-800/15 px-4 py-2.5 rounded-xl hover:border-navy-800/30 transition-colors"
          >
            Back to content list
          </button>
          <button
            onClick={reset}
            className="bg-navy-800 text-white text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-navy-900 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}
