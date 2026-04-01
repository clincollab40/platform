'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { z } from 'zod'

const OnboardingStep1Schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  specialty: z.enum([
    'interventional_cardiology', 'cardiac_surgery', 'cardiology',
    'orthopedics', 'spine_surgery', 'neurology', 'neurosurgery',
    'gi_surgery', 'urology', 'oncology', 'reproductive_medicine',
    'dermatology', 'ophthalmology', 'internal_medicine', 'other',
  ]),
  city: z.string().min(2).max(100),
})

const PeerSeedSchema = z.object({
  peers: z.array(z.object({
    peer_name: z.string().min(2).max(100),
    peer_city: z.string().min(2).max(100),
    peer_specialty: z.string().optional(),
  })).min(1).max(5),
})

// Step 1 — create specialist profile
export async function createSpecialistAction(formData: FormData) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const raw = {
    name: formData.get('name') as string,
    specialty: formData.get('specialty') as string,
    city: formData.get('city') as string,
  }

  const parsed = OnboardingStep1Schema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const adminEmails = (process.env.ADMIN_EMAIL_WHITELIST || '').split(',').map(e => e.trim())
  const role = adminEmails.includes(user.email || '') ? 'admin' : 'specialist'

  // Check for duplicate
  const { data: existing } = await supabase
    .from('specialists')
    .select('id')
    .eq('google_id', user.id)
    .single()

  if (existing) {
    redirect('/dashboard')
  }

  const { data: specialist, error } = await supabase
    .from('specialists')
    .insert({
      google_id: user.id,
      email: user.email!,
      name: parsed.data.name,
      specialty: parsed.data.specialty,
      city: parsed.data.city,
      role,
      status: 'onboarding',
      onboarding_step: 2,
    })
    .select('id')
    .single()

  if (error || !specialist) {
    return { error: 'Could not create your profile. Please try again.' }
  }

  // Record consent
  await supabase.from('specialist_consents').insert({
    specialist_id: specialist.id,
    consent_version: '1.0',
  })

  // Audit log
  await supabase.from('audit_logs').insert({
    actor_id: specialist.id,
    actor_role: role,
    action: 'specialist_registered',
    resource_type: 'specialist',
    resource_id: specialist.id,
    metadata: { specialty: parsed.data.specialty, city: parsed.data.city },
  })

  return { success: true }
}

// Step 2 — seed peer network
export async function seedPeerNetworkAction(formData: FormData) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists')
    .select('id')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  // Parse peer entries from form
  const peers: { peer_name: string; peer_city: string; peer_specialty?: string }[] = []

  for (let i = 0; i < 5; i++) {
    const name = (formData.get(`peer_${i}_name`) as string)?.trim()
    const city = (formData.get(`peer_${i}_city`) as string)?.trim()
    const specialty = (formData.get(`peer_${i}_specialty`) as string)?.trim()

    if (name && city) {
      peers.push({ peer_name: name, peer_city: city, peer_specialty: specialty || undefined })
    }
  }

  const parsed = PeerSeedSchema.safeParse({ peers })
  if (!parsed.success) {
    return { error: 'Please add at least one clinical colleague to continue.' }
  }

  // Insert peer seeds
  const seedInserts = parsed.data.peers.map(p => ({
    specialist_id: specialist.id,
    peer_name: p.peer_name,
    peer_city: p.peer_city,
    peer_specialty: p.peer_specialty || null,
    status: 'seeded' as const,
  }))

  const { error } = await supabase.from('peer_seeds').insert(seedInserts)

  if (error) {
    return { error: 'Could not save your peer network. Please try again.' }
  }

  // Update specialist status to active
  await supabase
    .from('specialists')
    .update({ status: 'active', onboarding_step: 3 })
    .eq('id', specialist.id)

  // Audit
  await supabase.from('audit_logs').insert({
    actor_id: specialist.id,
    actor_role: 'specialist',
    action: 'peer_network_seeded',
    resource_type: 'peer_seeds',
    metadata: { peer_count: peers.length },
  })

  return { success: true, peerCount: peers.length }
}
