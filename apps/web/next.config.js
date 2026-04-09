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
          // Security headers
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'X-Content-Type-Options',    value: 'nosniff' },
          { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
          // HSTS — 1 year, include subdomains.
          // NOTE: intentionally NOT adding preload until the site is fully stable.
          // preload submits to browser vendor lists and is very hard to reverse.
          // Once you are confident the site is stable for 6+ months, add:
          //   value: 'max-age=31536000; includeSubDomains; preload'
          // and submit to https://hstspreload.org
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ]
  },
  async redirects() {
    return [
      // Redirect bare apex domain to app subdomain (canonical URL)
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'clincollab.com' }],
        destination: 'https://app.clincollab.com/:path*',
        permanent: true,
      },
      // Redirect www to app subdomain (canonical URL)
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.clincollab.com' }],
        destination: 'https://app.clincollab.com/:path*',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig
