'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[ClinCollab] Global error:', error)
  }, [error])

  return (
    <html>
      <body style={{ margin: 0, padding: 0, fontFamily: 'system-ui, sans-serif', background: '#F0F4F8', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ maxWidth: 480, width: '100%', margin: '0 auto', padding: 24, background: 'white', borderRadius: 16, border: '1px solid rgba(26,82,118,0.08)', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A3A5C', marginBottom: 8 }}>Application error</h2>
          <div style={{ background: '#FEF2F2', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, textAlign: 'left' }}>
            <p style={{ fontSize: 11, fontFamily: 'monospace', color: '#B91C1C', wordBreak: 'break-all', lineHeight: 1.6, margin: 0 }}>
              {error.message || 'Unknown error'}
            </p>
            {error.digest && (
              <p style={{ fontSize: 10, color: '#EF4444', marginTop: 4, opacity: 0.7 }}>Digest: {error.digest}</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={() => window.location.href = '/dashboard'}
              style={{ padding: '10px 18px', border: '1px solid rgba(26,82,118,0.15)', borderRadius: 12, fontSize: 14, cursor: 'pointer', background: 'white', color: '#1A3A5C' }}>
              Go to dashboard
            </button>
            <button onClick={reset}
              style={{ padding: '10px 18px', background: '#1A5276', color: 'white', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
