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

  const [configRes, faqsRes] = await Promise.all([
    db.from('chatbot_configs').select('*').eq('specialist_id', specialist.id).single(),
    db.from('chatbot_faqs').select('*').eq('specialist_id', specialist.id).order('sort_order'),
  ])

  const config   = configRes.data
  const faqs     = faqsRes.data || []
  const faqCount = faqs.length
  const isLive   = config?.is_live ?? false

  // Bot readiness score: weighted sum of completeness factors
  const hasClinicInfo = !!(config?.clinic_name && config?.address)
  const hasFees       = !!(config?.fee_consultation)
  const hasTimings    = !!(config?.timings && Object.keys(config.timings).length > 0)
  const hasEscalation = !!(config?.escalation_mobile)
  const faqScore      = Math.min(faqCount * 4, 40) // Up to 40 points for FAQs (10 FAQs = max)

  const botScore = isLive
    ? Math.min(100,
        (hasClinicInfo ? 15 : 0) +
        (hasFees       ? 10 : 0) +
        (hasTimings    ? 10 : 0) +
        (hasEscalation ? 10 : 0) +
        faqScore +
        15 // bonus for being live
      )
    : Math.min(85, // cap at 85 until actually live
        (hasClinicInfo ? 15 : 0) +
        (hasFees       ? 10 : 0) +
        (hasTimings    ? 10 : 0) +
        (hasEscalation ? 10 : 0) +
        faqScore
      )

  const insightData: InsightData = {
    moduleTitle:  'Patient Chatbot',
    score:        botScore,
    scoreLabel:   'Bot Readiness Score',
    scoreColor:   botScore >= 70 ? 'green' : botScore >= 40 ? 'amber' : 'red',
    insights: [
      !isLive
        ? {
            text: 'Chatbot is not live. Once configured, activate it to handle patient enquiries 24/7 in 6 languages.',
            severity: 'critical' as const,
            cta: { label: 'Go to Deploy tab', href: '/chatbot/config' },
          }
        : {
            text: 'Chatbot is live and responding to patients via WhatsApp and web widget.',
            severity: 'positive' as const,
          },
      faqCount < 5
        ? {
            text: `Only ${faqCount} FAQ${faqCount !== 1 ? 's' : ''} configured. Add at least 10 — each FAQ reduces patient calls to your staff.`,
            severity: 'warning' as const,
            cta: { label: 'Add FAQs now', href: '/chatbot/config' },
          }
        : faqCount < 10
        ? {
            text: `${faqCount} FAQs added. ${10 - faqCount} more will maximise bot resolution rate.`,
            severity: 'info' as const,
          }
        : {
            text: `${faqCount} FAQs trained — strong coverage. Bot handles most patient queries without staff.`,
            severity: 'positive' as const,
          },
      !hasEscalation
        ? {
            text: 'Set an escalation mobile number so complex queries route to your coordinator automatically.',
            severity: 'warning' as const,
            cta: { label: 'Add escalation contact', href: '/chatbot/config' },
          }
        : {
            text: 'Escalation configured — complex queries route to your coordinator on WhatsApp automatically.',
            severity: 'positive' as const,
          },
    ],
    benchmark:    'Specialists with active chatbots resolve 67% of patient queries without staff intervention.',
    cta:          { label: isLive ? 'Manage chatbot' : 'Activate chatbot', href: '/chatbot/config' },
    secondaryCta: { label: 'Add more FAQs',  href: '/chatbot/config' },
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.clincollab.com'

  return (
    <AppLayout
      specialist={{
        id:        specialist.id,
        name:      specialist.name,
        specialty: specialist.specialty,
        role:      specialist.role,
      }}
      insightData={insightData}
    >
      <ChatbotConfigClient
        initialConfig={config}
        initialFaqs={faqs}
        specialistName={specialist.name}
        specialistSpecialty={specialist.specialty}
        specialistId={specialist.id}
        appUrl={appUrl}
      />
    </AppLayout>
  )
}
