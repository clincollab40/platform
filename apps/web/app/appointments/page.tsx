import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import type { InsightData } from '@/components/layout/InsightPanel'
import AppointmentsClient from './appointments-client'

export default async function AppointmentsPage() {
  const authClient = await createServerSupabaseClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/auth/login')

  const db = createServiceRoleClient()

  const { data: specialist } = await db
    .from('specialists')
    .select('id, name, specialty, city, role')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  const { data: appointments } = await db
    .from('appointments')
    .select(`
      id, patient_name, patient_mobile, patient_gender,
      reason, channel, status, notes, booked_at, updated_at,
      appointment_slots ( slot_date, slot_time, duration_mins )
    `)
    .eq('specialist_id', specialist.id)
    .order('booked_at', { ascending: false })
    .limit(200)

  const today = new Date().toISOString().split('T')[0]
  const all   = appointments || []
  const todayAppointments = all.filter(a =>
    (a.appointment_slots as any)?.slot_date === today
  )

  const confirmed  = all.filter(a => a.status === 'confirmed').length
  const pending    = all.filter(a => a.status === 'pending').length
  const cancelled  = all.filter(a => a.status === 'cancelled').length
  const total      = all.length

  const utilizationRate = total > 0
    ? Math.round((confirmed / total) * 100)
    : 0

  const insightData: InsightData = {
    moduleTitle: 'Appointment Intelligence',
    score: utilizationRate,
    scoreLabel: 'Slot Utilisation Rate',
    scoreColor: utilizationRate >= 75 ? 'green' : utilizationRate >= 50 ? 'amber' : 'red',
    insights: [
      todayAppointments.length > 0
        ? { text: `${todayAppointments.length} appointment${todayAppointments.length > 1 ? 's' : ''} scheduled for today. Your list is ready.`, severity: 'positive' as const }
        : { text: 'No appointments today. A quiet day for administrative work.', severity: 'info' as const },
      pending > 0
        ? { text: `${pending} appointment${pending > 1 ? 's' : ''} pending confirmation. Confirm to reduce no-shows.`, severity: 'warning' as const }
        : { text: 'All upcoming appointments confirmed.', severity: 'positive' as const },
      cancelled > 2
        ? { text: `${cancelled} cancellations recorded. Enable WhatsApp reminders to reduce this.`, severity: 'warning' as const }
        : { text: 'Low cancellation rate. WhatsApp reminders are working.', severity: 'positive' as const },
    ],
    benchmark: `Specialists using automated appointment reminders see 41% fewer no-shows.`,
    cta:          { label: 'View today\'s schedule', href: '/appointments?filter=today' },
    secondaryCta: { label: 'Confirm pending slots',   href: '/appointments?status=pending' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <AppointmentsClient
        specialist={specialist}
        appointments={all}
        todayCount={todayAppointments.length}
      />
    </AppLayout>
  )
}
