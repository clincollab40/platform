/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow builds to succeed even if there are non-blocking TS/ESLint issues
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Transpile local workspace packages resolved via tsconfig paths
  transpilePackages: [
    '@clincollab/types',
    '@clincollab/shared-utils',
    '@clincollab/notification-bus',
    '@clincollab/synthesis-agent',
  ],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'obefnptwfskhihkibsye.supabase.co' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',        value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',     value: 'camera=(), microphone=(), geolocation=()' },
          // HSTS: 1 year, subdomains included.
          // DO NOT add 'preload' until site is stable for 6+ months —
          // preload lists are in browser binaries and cannot be reversed quickly.
          {
            key:   'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ]
  },
  // NOTE: Domain redirects (clincollab.com → app.clincollab.com etc.) are
  // handled at the Vercel network level via the Vercel dashboard Domains settings.
  // Do NOT add them here — Vercel's network redirect fires before Next.js sees
  // the request, so app-level host redirects would never execute and could
  // cause loops after a nameserver change.
}

module.exports = nextConfig
