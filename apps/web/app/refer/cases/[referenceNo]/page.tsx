import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

// Public page — accessed via secure link sent to referring doctor
// Shows only their own cases for a specific specialist
export default async function ReferrerCaseTrackerPage({
  params,
  searchParams,
}: {
  params: { referenceNo: string }
  searchParams: { mobile?: string }
}) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const referenceNo    = params.referenceNo
  const patientMobile  = searchParams.mobile

  // Fetch the specific case
  const { data: referralCase } = await supabase
    .from('referral_cases')
    .select(`
      id, reference_no, patient_name, chief_complaint,
      urgency, status, submitted_at, accepted_at,
      expected_visit_date, poc_specialist_name, poc_specialist_mobile,
      decline_reason, query_text,
      specialists ( name, specialty, city ),
      case_updates ( update_type, structured_data, created_at, whatsapp_delivered ),
      case_messages ( role, content, message_type, created_at )
    `)
    .eq('reference_no', referenceNo)
    .single()

  if (!referralCase) notFound()

  const specialist = referralCase.specialists as any
  const updates    = (referralCase.case_updates as any[]) || []
  const messages   = ((referralCase.case_messages as any[]) || [])
    .filter(m => m.message_type !== 'system_event')
    .sort((a: any, b: any) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )

  const STATUS_STEPS = [
    { key: 'submitted',         label: 'Referral submitted' },
    { key: 'accepted',          label: 'Accepted by specialist' },
    { key: 'patient_arrived',   label: 'Patient arrived' },
    { key: 'procedure_planned', label: 'Procedure planned' },
    { key: 'completed',         label: 'Procedure completed' },
    { key: 'closed',            label: 'Case closed' },
  ]

  const STATUS_ORDER: Record<string, number> = {
    submitted: 0, queried: 1, info_provided: 1, accepted: 2,
    patient_arrived: 3, procedure_planned: 4, completed: 5, closed: 6,
  }

  const currentStep = STATUS_ORDER[referralCase.status] ?? 0

  const UPDATE_LABELS: Record<string, string> = {
    patient_arrived:     'Patient arrived at clinic',
    findings_shared:     'Clinical findings shared',
    procedure_planned:   'Procedure has been planned',
    procedure_completed: 'Procedure successfully completed',
    discharged:          'Patient has been discharged',
    follow_up_required:  'Follow-up required',
    general_update:      'Clinical update',
  }

  function formatDate(d: string | null) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  }

  function formatDateTime(d: string) {
    return new Date(d).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const isDeclined   = referralCase.status === 'declined'
  const isCancelled  = referralCase.status === 'cancelled'
  const isTerminal   = isDeclined || isCancelled

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Header */}
      <div className="bg-white border-b border-navy-800/8">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-2.5">
          <img src="/logo.png" alt="ClinCollab" width={24} height={24} />
          <div>
            <div className="text-xs font-medium text-navy-800">Case status tracker</div>
            <div className="text-2xs text-navy-800/50">Ref: {referenceNo}</div>
          </div>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-5 space-y-4">

        {/* Patient + specialist summary */}
        <div className="card-clinical">
          <div className="mb-3">
            <div className="data-label mb-1">Patient</div>
            <h1 className="font-display text-xl text-navy-800">{referralCase.patient_name}</h1>
            <p className="text-sm text-navy-800/60 mt-0.5">{referralCase.chief_complaint}</p>
          </div>
          <div className="pt-3 border-t border-navy-800/8 text-xs text-navy-800/50">
            Referred to Dr. {specialist?.name} ·{' '}
            {specialist?.specialty?.replace(/_/g, ' ')} ·{' '}
            {specialist?.city}
          </div>
          <div className="text-xs text-navy-800/35 mt-1">
            Submitted {formatDate(referralCase.submitted_at)} ·{' '}
            Ref: <span className="font-mono">{referenceNo}</span>
          </div>
        </div>

        {/* Declined / cancelled state */}
        {isDeclined && (
          <div className="bg-red-50 border border-red-200/60 rounded-2xl p-4">
            <div className="data-label text-red-700/70 mb-2">Referral not accepted</div>
            <p className="text-sm text-red-900 leading-relaxed">
              {referralCase.decline_reason ||
                'The specialist was unable to accept this referral at this time.'}
            </p>
            <p className="text-xs text-red-600/60 mt-2">
              Please contact the clinic directly for further guidance.
            </p>
          </div>
        )}

        {/* Queried state */}
        {referralCase.status === 'queried' && (
          <div className="bg-purple-50 border border-purple-200/60 rounded-2xl p-4">
            <div className="data-label text-purple-700/70 mb-2">
              Query from Dr. {specialist?.name}
            </div>
            <p className="text-sm text-purple-900 leading-relaxed">
              {referralCase.query_text}
            </p>
            <a
              href={`/refer/reply/${referenceNo}`}
              className="inline-block mt-3 bg-purple-600 text-white text-sm font-medium
                         px-4 py-2 rounded-xl hover:bg-purple-700 transition-colors"
            >
              Reply to specialist
            </a>
          </div>
        )}

        {/* Progress tracker */}
        {!isTerminal && (
          <div className="card-clinical">
            <div className="data-label mb-4">Case progress</div>
            <div className="space-y-3">
              {STATUS_STEPS.map((step, idx) => {
                const isDone    = idx <= currentStep
                const isCurrent = idx === currentStep
                return (
                  <div key={step.key} className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center
                                    flex-shrink-0 transition-all
                      ${isDone
                        ? 'bg-forest-700'
                        : 'bg-navy-800/10'}`}>
                      {isDone ? (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="white"
                                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-navy-800/20" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className={`text-sm transition-all
                        ${isCurrent ? 'font-medium text-navy-800' :
                          isDone ? 'text-navy-800/60' : 'text-navy-800/30'}`}>
                        {step.label}
                      </div>
                      {isCurrent && (
                        <div className="text-2xs text-navy-800/40 mt-0.5">Current status</div>
                      )}
                    </div>
                    {isCurrent && (
                      <div className="w-2 h-2 rounded-full bg-forest-700 animate-pulse-soft" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* POC details if accepted */}
        {referralCase.poc_specialist_name && (
          <div className="card-clinical">
            <div className="data-label mb-3">Coordination contact</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-navy-800/50">Point of contact</span>
                <span className="text-navy-800">{referralCase.poc_specialist_name}</span>
              </div>
              {referralCase.poc_specialist_mobile && (
                <div className="flex justify-between items-center">
                  <span className="text-navy-800/50">Contact number</span>
                  <a href={`tel:${referralCase.poc_specialist_mobile}`}
                    className="text-navy-800 font-medium hover:text-navy-900">
                    {referralCase.poc_specialist_mobile}
                  </a>
                </div>
              )}
              {referralCase.expected_visit_date && (
                <div className="flex justify-between">
                  <span className="text-navy-800/50">Expected visit</span>
                  <span className="text-navy-800 font-medium">
                    {formatDate(referralCase.expected_visit_date)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Clinical updates from specialist */}
        {updates.length > 0 && (
          <div className="card-clinical p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-navy-800/8">
              <div className="data-label">Updates from specialist</div>
            </div>
            <div className="divide-y divide-navy-800/5">
              {updates
                .sort((a: any, b: any) =>
                  new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                )
                .map((u: any, i: number) => (
                  <div key={i} className="px-4 py-3.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-navy-800">
                        {UPDATE_LABELS[u.update_type] || u.update_type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-2xs text-navy-800/35">
                        {formatDateTime(u.created_at)}
                      </span>
                    </div>
                    {u.structured_data && (
                      <div className="space-y-0.5">
                        {Object.entries(u.structured_data as Record<string, string>)
                          .filter(([_, v]) => v)
                          .map(([k, v]) => (
                            <div key={k} className="text-xs text-navy-800/60">
                              <span className="capitalize">
                                {k.replace(/_/g, ' ')}:
                              </span>{' '}{v}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Communication thread */}
        {messages.length > 0 && (
          <div className="card-clinical p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-navy-800/8">
              <div className="data-label">Case messages</div>
            </div>
            <div className="px-4 py-3 space-y-3 max-h-64 overflow-y-auto">
              {messages.map((msg: any, i: number) => (
                <div key={i}
                  className={`flex ${msg.role === 'specialist' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm
                    ${msg.role === 'specialist'
                      ? 'bg-navy-800 text-white rounded-tl-sm'
                      : 'bg-navy-800/8 text-navy-800 rounded-tr-sm'}`}>
                    <div className={`text-2xs font-medium mb-1
                      ${msg.role === 'specialist' ? 'text-white/60' : 'text-navy-800/50'}`}>
                      {msg.role === 'specialist' ? `Dr. ${specialist?.name}` : 'You'}
                    </div>
                    <p className="leading-relaxed">{msg.content}</p>
                    <p className={`text-2xs mt-1
                      ${msg.role === 'specialist' ? 'text-white/40' : 'text-navy-800/30'}`}>
                      {formatDateTime(msg.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {referralCase.status === 'queried' && (
              <div className="px-4 pb-4 pt-2 border-t border-navy-800/8">
                <a href={`/refer/reply/${referenceNo}`}
                  className="block text-center bg-navy-800 text-white text-sm font-medium
                             py-3 rounded-xl hover:bg-navy-900 transition-colors">
                  Reply to query
                </a>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-xs text-navy-800/25 pb-4">
          Powered by ClinCollab · clincollab.com
        </p>
      </main>
    </div>
  )
}
