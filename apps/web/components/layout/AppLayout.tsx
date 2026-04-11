import Sidebar from './Sidebar'
import TopNav  from './TopNav'
import InsightPanel, { type InsightData } from './InsightPanel'
import WhatsAppFloat from './WhatsAppFloat'
import { createServiceRoleClient } from '@/lib/supabase/server'

type Specialist = {
  id: string
  name: string
  specialty: string
  role: string
  photo?: string
}

type Props = {
  children: React.ReactNode
  specialist: Specialist
  insightData?: InsightData
}

export type { InsightData }

export default async function AppLayout({ children, specialist, insightData }: Props) {
  // Fetch org membership for the Org Admin sidebar link
  let orgId:   string | null = null
  let orgRole: string | null = null
  try {
    const sc = createServiceRoleClient()
    const { data: membership } = await sc.from('org_specialists')
      .select('org_id, org_role')
      .eq('specialist_id', specialist.id)
      .eq('is_active', true)
      .in('org_role', ['owner','admin'])
      .limit(1).single()
    if (membership) { orgId = membership.org_id; orgRole = membership.org_role }
  } catch { /* no org — suppress error */ }

  return (
    <div className="app-shell">
      {/* Left: Sidebar navigation */}
      <Sidebar specialist={specialist} orgId={orgId} orgRole={orgRole} />

      {/* Right: Main content area */}
      <div className="app-main">
        <TopNav specialist={specialist} />

        <div className="app-body">
          {/* Center: Page content */}
          <main className="app-page">
            {children}
          </main>

          {/* Right: AI Insight Panel */}
          {insightData && <InsightPanel data={insightData} />}
        </div>
      </div>

      {/* Floating WhatsApp */}
      <WhatsAppFloat />
    </div>
  )
}
