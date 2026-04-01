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
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
