import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import type { InsightData } from '@/components/layout/InsightPanel'
import ChatbotConfigClient from './chatbot-config-client'

export default async function ChatbotConfigPage() {
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

  const { data: config } = await db
    .from('chatbot_configs')
    .select('*')
    .eq('specialist_id', specialist.id)
    .single()

  const { data: faqs } = await db
    .from('chatbot_faqs')
    .select('*')
    .eq('specialist_id', specialist.id)
    .order('sort_order')

  const faqCount   = (faqs || []).length
  const isActive   = config?.is_active ?? false
  const botScore   = isActive
    ? Math.min(100, 40 + faqCount * 5 + (config?.persona_name ? 10 : 0) + (config?.welcome_message ? 10 : 0))
    : faqCount > 0 ? 20 : 0

  const insightData: InsightData = {
    moduleTitle: 'Patient Chatbot',
    score: botScore,
    scoreLabel: 'Bot Resolution Rate',
    scoreColor: botScore >= 70 ? 'green' : botScore >= 40 ? 'amber' : 'red',
    insights: [
      !isActive
        ? { text: 'Chatbot is inactive. Activate it to automate patient enquiries 24/7.', severity: 'critical' as const }
        : { text: 'Chatbot is live and handling patient enquiries automatically.', severity: 'positive' as const },
      faqCount < 5
        ? { text: `Only ${faqCount} FAQ${faqCount !== 1 ? 's' : ''} configured. Add at least 10 for strong bot coverage.`, severity: 'warning' as const }
        : { text: `${faqCount} FAQs trained. Good coverage for patient queries.`, severity: 'positive' as const },
      !config?.persona_name
        ? { text: 'Give your bot a name and persona to build patient trust.', severity: 'info' as const }
        : { text: `Bot persona "${config.persona_name}" is personalised and on-brand.`, severity: 'positive' as const },
    ],
    benchmark: `Specialists with active chatbots resolve 67% of patient queries without staff intervention.`,
    cta:          { label: isActive ? 'Manage chatbot' : 'Activate chatbot', href: '/chatbot/config' },
    secondaryCta: { label: 'Add more FAQs', href: '/chatbot/config' },
  }

  return (
    <AppLayout
      specialist={{ id: specialist.id, name: specialist.name, specialty: specialist.specialty, role: specialist.role }}
      insightData={insightData}
    >
      <ChatbotConfigClient
        initialConfig={config}
        initialFaqs={faqs || []}
        specialistName={specialist.name}
        specialistSpecialty={specialist.specialty}
      />
    </AppLayout>
  )
}
