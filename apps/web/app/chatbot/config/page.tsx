import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import ChatbotConfigClient from './chatbot-config-client'

export default async function ChatbotConfigPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: specialist } = await supabase
    .from('specialists')
    .select('id, name, specialty, city, role')
    .eq('google_id', user.id)
    .single()

  if (!specialist) redirect('/onboarding')

  const { data: config } = await supabase
    .from('chatbot_configs')
    .select('*')
    .eq('specialist_id', specialist.id)
    .single()

  const { data: faqs } = await supabase
    .from('chatbot_faqs')
    .select('*')
    .eq('specialist_id', specialist.id)
    .order('sort_order')

  return (
    <ChatbotConfigClient
      initialConfig={config}
      initialFaqs={faqs || []}
      specialistName={specialist.name}
      specialistSpecialty={specialist.specialty}
    />
  )
}
