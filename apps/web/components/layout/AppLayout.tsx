import Sidebar from './Sidebar'
import TopNav  from './TopNav'
import InsightPanel, { type InsightData } from './InsightPanel'
import WhatsAppFloat from './WhatsAppFloat'

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

export default function AppLayout({ children, specialist, insightData }: Props) {
  return (
    <div className="app-shell">
      {/* Left: Sidebar navigation */}
      <Sidebar specialist={specialist} />

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
