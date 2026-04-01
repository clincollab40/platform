import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Toaster } from 'sonner'

export const metadata: Metadata = {
  title: {
    default: 'ClinCollab — Clinical Peer Engagement Platform',
    template: '%s | ClinCollab',
  },
  description: 'Practice intelligence and peer engagement for procedural specialists.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ClinCollab',
  },
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1A5276',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: '#1A5276',
              color: '#fff',
              border: 'none',
              borderRadius: '12px',
              fontFamily: 'Instrument Sans, sans-serif',
              fontSize: '14px',
            },
          }}
        />
      </body>
    </html>
  )
}
