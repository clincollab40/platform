'use server'

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

// ── Schemas ────────────────────────────────────────
const ReferrerSchema = z.object({
  name:         z.string().min(2, 'Name must be at least 2 characters').max(100),
  city:         z.string().min(2, 'City is required').max(100),
  clinic_name:  z.string().max(150).optional(),
  clinic_area:  z.string().max(100).optional(),
  mobile:       z.string().max(15).optional(),
  whatsapp:     z.string().max(15).optional(),
  specialty:    z.string().max(100).optional(),
})

const ReferralLogSchema = z.object({
  referrer_id:  z.string().uuid(),
  referred_on:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  case_type:    z.enum(['procedure', 'opd_consultation', 'emergency', 'investigation', 'other']),
  notes:        z.string().max(500).optional(),
})

const NoteSchema = z.object({
  referrer_id: z.string().uuid(),
  note:        z.string().min(1).max(1000),
})

// ── Helper: get authenticated specialist ──────────
async function getSpecialist() {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')
  const supabase = createServiceRoleClient()

  const { data: specialist } = await supabase
    .from('specialists')
    .select('id, role')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')
  return { supabase, specialist }
}

// ── ADD REFERRER ───────────────────────────────────
export async function addReferrerAction(formData: FormData) {
  const { supabase, specialist } = await getSpecialist()

  const raw = {
    name:        (formData.get('name') as string)?.trim(),
    city:        (formData.get('city') as string)?.trim(),
    clinic_name: (formData.get('clinic_name') as string)?.trim() || undefined,
    clinic_area: (formData.get('clinic_area') as string)?.trim() || undefined,
    mobile:      (formData.get('mobile') as string)?.trim() || undefined,
    whatsapp:    (formData.get('whatsapp') as string)?.trim() || undefined,
    specialty:   (formData.get('specialty') as string)?.trim() || undefined,
  }

  const parsed = ReferrerSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  // Duplicate check: same name + city for this specialist
  const { data: existing } = await supabase
    .from('referrers')
    .select('id')
    .eq('specialist_id', specialist.id)
    .ilike('name', parsed.data.name)
    .ilike('city', parsed.data.city)
    .eq('is_deleted', false)
    .single()

  if (existing) {
    return { error: `${parsed.data.name} from ${parsed.data.city} is already in your network.` }
  }

  const { data: referrer, error } = await supabase
    .from('referrers')
    .insert({ specialist_id: specialist.id, ...parsed.data })
    .select('id')
    .single()

  if (error || !referrer) {
    return { error: 'Could not add colleague. Please try again.' }
  }

  // Audit
  await supabase.from('audit_logs').insert({
    actor_id: specialist.id,
    actor_role: specialist.role,
    action: 'referrer_added',
    resource_type: 'referrer',
    resource_id: referrer.id,
    metadata: { name: parsed.data.name, city: parsed.data.city },
  })

  revalidatePath('/network')
  return { success: true, id: referrer.id }
}

// ── UPDATE REFERRER ────────────────────────────────
export async function updateReferrerAction(id: string, formData: FormData) {
  const { supabase, specialist } = await getSpecialist()

  const raw = {
    name:        (formData.get('name') as string)?.trim(),
    city:        (formData.get('city') as string)?.trim(),
    clinic_name: (formData.get('clinic_name') as string)?.trim() || undefined,
    clinic_area: (formData.get('clinic_area') as string)?.trim() || undefined,
    mobile:      (formData.get('mobile') as string)?.trim() || undefined,
    whatsapp:    (formData.get('whatsapp') as string)?.trim() || undefined,
    specialty:   (formData.get('specialty') as string)?.trim() || undefined,
  }

  const parsed = ReferrerSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { error } = await supabase
    .from('referrers')
    .update(parsed.data)
    .eq('id', id)
    .eq('specialist_id', specialist.id) // RLS + explicit check

  if (error) return { error: 'Could not update colleague. Please try again.' }

  await supabase.from('audit_logs').insert({
    actor_id: specialist.id,
    actor_role: specialist.role,
    action: 'referrer_updated',
    resource_type: 'referrer',
    resource_id: id,
  })

  revalidatePath('/network')
  revalidatePath(`/network/${id}`)
  return { success: true }
}

// ── SOFT DELETE REFERRER ───────────────────────────
export async function deleteReferrerAction(id: string) {
  const { supabase, specialist } = await getSpecialist()

  const { error } = await supabase
    .from('referrers')
    .update({ is_deleted: true })
    .eq('id', id)
    .eq('specialist_id', specialist.id)

  if (error) return { error: 'Could not remove colleague.' }

  await supabase.from('audit_logs').insert({
    actor_id: specialist.id,
    actor_role: specialist.role,
    action: 'referrer_deleted',
    resource_type: 'referrer',
    resource_id: id,
  })

  revalidatePath('/network')
  return { success: true }
}

// ── LOG REFERRAL ───────────────────────────────────
export async function logReferralAction(formData: FormData) {
  const { supabase, specialist } = await getSpecialist()

  const raw = {
    referrer_id: formData.get('referrer_id') as string,
    referred_on: formData.get('referred_on') as string,
    case_type:   formData.get('case_type') as string,
    notes:       (formData.get('notes') as string)?.trim() || undefined,
  }

  const parsed = ReferralLogSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  // Verify referrer belongs to this specialist
  const { data: referrer } = await supabase
    .from('referrers')
    .select('id, name')
    .eq('id', parsed.data.referrer_id)
    .eq('specialist_id', specialist.id)
    .single()

  if (!referrer) return { error: 'Colleague not found in your network.' }

  const { error } = await supabase.from('referral_logs').insert({
    specialist_id: specialist.id,
    referrer_id:   parsed.data.referrer_id,
    referred_on:   parsed.data.referred_on,
    case_type:     parsed.data.case_type as any,
    notes:         parsed.data.notes || null,
  })

  if (error) return { error: 'Could not log referral. Please try again.' }

  revalidatePath('/network')
  revalidatePath(`/network/${parsed.data.referrer_id}`)
  revalidatePath('/dashboard')
  return { success: true }
}

// ── ADD NOTE ───────────────────────────────────────
export async function addNoteAction(formData: FormData) {
  const { supabase, specialist } = await getSpecialist()

  const parsed = NoteSchema.safeParse({
    referrer_id: formData.get('referrer_id'),
    note:        (formData.get('note') as string)?.trim(),
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { error } = await supabase.from('referrer_notes').insert({
    specialist_id: specialist.id,
    referrer_id:   parsed.data.referrer_id,
    note:          parsed.data.note,
  })

  if (error) return { error: 'Could not save note.' }

  revalidatePath(`/network/${parsed.data.referrer_id}`)
  return { success: true }
}

// ── CSV IMPORT ─────────────────────────────────────
export async function importCSVAction(rows: {
  name: string; city: string; specialty?: string;
  mobile?: string; whatsapp?: string; clinic_name?: string
}[]) {
  const { supabase, specialist } = await getSpecialist()

  if (rows.length > 200) {
    return { error: 'Maximum 200 records per import.' }
  }

  let created = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of rows) {
    if (!row.name?.trim() || !row.city?.trim()) {
      errors.push(`Row skipped — name and city are required: "${row.name}"`)
      continue
    }

    // Duplicate check
    const { data: existing } = await supabase
      .from('referrers')
      .select('id')
      .eq('specialist_id', specialist.id)
      .ilike('name', row.name.trim())
      .ilike('city', row.city.trim())
      .single()

    if (existing) { skipped++; continue }

    const { error } = await supabase.from('referrers').insert({
      specialist_id: specialist.id,
      name:          row.name.trim(),
      city:          row.city.trim(),
      specialty:     row.specialty?.trim() || null,
      mobile:        row.mobile?.trim() || null,
      whatsapp:      row.whatsapp?.trim() || null,
      clinic_name:   row.clinic_name?.trim() || null,
    })

    if (error) {
      errors.push(`Could not import "${row.name}"`)
    } else {
      created++
    }
  }

  await supabase.from('audit_logs').insert({
    actor_id: specialist.id,
    actor_role: specialist.role,
    action: 'csv_import',
    resource_type: 'referrer',
    metadata: { created, skipped, errors: errors.length },
  })

  revalidatePath('/network')
  return { success: true, created, skipped, errors }
}

// ── MIGRATE SEEDS → REFERRERS ──────────────────────
export async function migrateSeedsAction() {
  const { supabase, specialist } = await getSpecialist()

  const { data, error } = await supabase
    .rpc('migrate_peer_seeds_to_referrers', { p_specialist_id: specialist.id })

  if (error) return { error: 'Migration failed.' }

  revalidatePath('/network')
  return { success: true, migrated: data }
}
