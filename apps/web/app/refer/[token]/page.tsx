import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import ReferralForm from '@/components/referrals/ReferralForm'

// This page is PUBLIC — accessed by referring doctors via WhatsApp link
// Uses service role to validate token only — no PHI read at this stage
export default async function PublicReferralFormPage({
  params,
}: {
  params: { token: string }
}) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Validate token and get specialist info
  const { data: tokenRow } = await supabase
    .from('referral_tokens')
    .select(`
      id, expires_at, used_count, max_uses,
      specialists ( name, specialty, city )
    `)
    .eq('token', params.token)
    .single()

  if (!tokenRow) notFound()

  // Check expiry and usage
  if (new Date(tokenRow.expires_at) < new Date()) {
    return (
      <div className="min-h-screen bg-clinical-light flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-2xl text-navy-800 mb-2">Link expired</h1>
          <p className="text-sm text-navy-800/60">
            This referral link has expired. Please request a new link from Dr.{' '}
            {(tokenRow.specialists as any)?.name}.
          </p>
        </div>
      </div>
    )
  }

  if (tokenRow.used_count >= tokenRow.max_uses) {
    return (
      <div className="min-h-screen bg-clinical-light flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-2xl text-navy-800 mb-2">Link unavailable</h1>
          <p className="text-sm text-navy-800/60">
            This referral link is no longer available. Please contact the specialist's clinic.
          </p>
        </div>
      </div>
    )
  }

  const specialist = tokenRow.specialists as any

  return (
    <ReferralForm
      token={params.token}
      specialistName={specialist?.name || 'the specialist'}
      specialistSpecialty={specialist?.specialty || ''}
      specialistCity={specialist?.city || ''}
    />
  )
}
