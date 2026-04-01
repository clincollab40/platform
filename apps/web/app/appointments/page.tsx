import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import AppointmentsClient from './appointments-client'

export default async function AppointmentsPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists')
    .select('id, name, specialty, city, role')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  // Fetch appointments with slot data
  const { data: appointments } = await supabase
    .from('appointments')
    .select(`
      id, patient_name, patient_mobile, patient_gender,
      reason, channel, status, notes, booked_at, updated_at,
      appointment_slots ( slot_date, slot_time, duration_mins )
    `)
    .eq('specialist_id', specialist.id)
    .order('booked_at', { ascending: false })
    .limit(200)

  // Today's appointments
  const today = new Date().toISOString().split('T')[0]
  const todayAppointments = (appointments || []).filter(a =>
    (a.appointment_slots as any)?.slot_date === today
  )

  return (
    <AppointmentsClient
      specialist={specialist}
      appointments={appointments || []}
      todayCount={todayAppointments.length}
    />
  )
}
