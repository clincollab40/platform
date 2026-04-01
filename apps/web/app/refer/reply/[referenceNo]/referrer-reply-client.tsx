'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'

type Message = {
  role: string
  content: string
  message_type: string
  created_at: string
}

type Props = {
  referenceNo: string
  caseId: string
  patientName: string
  chiefComplaint: string
  queryText: string | null
  specialistName: string
  specialistSpecialty: string
  referrerName: string
  canReply: boolean
  recentMessages: Message[]
  caseStatus: string
}

export default function ReferrerReplyClient({
  referenceNo, caseId, patientName, chiefComplaint,
  queryText, specialistName, specialistSpecialty,
  referrerName, canReply, recentMessages, caseStatus,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [reply, setReply] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [files, setFiles] = useState<File[]>([])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim()) return

    startTransition(async () => {
      const fd = new FormData()
      fd.set('case_id', caseId)
      fd.set('reference_no', referenceNo)
      fd.set('content', reply)
      fd.set('sender_name', referrerName)
      files.forEach(f => fd.append('documents', f))

      const res = await fetch('/api/referrer-reply', {
        method: 'POST',
        body: fd,
      })

      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        setSubmitted(true)
      }
    })
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-clinical-light flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center animate-slide-up">
          <div className="w-16 h-16 bg-forest-700 rounded-full flex items-center
                          justify-center mx-auto mb-5">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M5 12l5 5L19 7" stroke="white" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="font-display text-2xl text-navy-800 mb-2">Reply sent</h1>
          <p className="text-sm text-navy-800/60 leading-relaxed mb-4">
            Dr. {specialistName} has been notified of your response
            regarding {patientName}.
          </p>
          <div className="card-clinical text-left text-xs text-navy-800/50">
            <div className="flex justify-between mb-1">
              <span className="data-label">Reference</span>
              <span className="font-mono">{referenceNo}</span>
            </div>
            <div className="flex justify-between">
              <span className="data-label">Patient</span>
              <span>{patientName}</span>
            </div>
          </div>
          <p className="text-xs text-navy-800/30 mt-6">Powered by ClinCollab</p>
        </div>
      </div>
    )
  }

  const statusLabel: Record<string, string> = {
    submitted:        'Awaiting review',
    queried:          'Query sent — reply needed',
    accepted:         'Accepted',
    patient_arrived:  'Patient arrived',
    procedure_planned:'Procedure planned',
    completed:        'Completed',
    closed:           'Closed',
    declined:         'Declined',
  }

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Header */}
      <div className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-2.5">
          <Image src="/logo.png" alt="ClinCollab" width={24} height={24} />
          <div>
            <div className="text-xs font-medium text-navy-800">ClinCollab — Case communication</div>
            <div className="text-2xs text-navy-800/50">
              Ref: {referenceNo} · {patientName}
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-5 space-y-4">

        {/* Case summary card */}
        <div className="card-clinical">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="data-label mb-1">Referral case</div>
              <h1 className="font-display text-xl text-navy-800">{patientName}</h1>
              <p className="text-sm text-navy-800/60 mt-0.5">{chiefComplaint}</p>
            </div>
            <span className={`text-2xs px-2.5 py-1 rounded-full font-medium flex-shrink-0
              ${caseStatus === 'queried' ? 'bg-purple-50 text-purple-700' :
                caseStatus === 'accepted' ? 'bg-emerald-50 text-emerald-700' :
                'bg-gray-100 text-gray-500'}`}>
              {statusLabel[caseStatus] || caseStatus}
            </span>
          </div>
          <div className="pt-3 border-t border-navy-800/8 text-xs text-navy-800/50">
            Specialist: Dr. {specialistName} ·{' '}
            {specialistSpecialty.replace(/_/g, ' ')}
          </div>
        </div>

        {/* Query from specialist */}
        {queryText && (
          <div className="bg-purple-50 border border-purple-200/60 rounded-2xl p-4">
            <div className="data-label text-purple-700/70 mb-2">
              Query from Dr. {specialistName}
            </div>
            <p className="text-sm text-purple-900 leading-relaxed">{queryText}</p>
          </div>
        )}

        {/* Message thread */}
        {recentMessages.filter(m => m.message_type !== 'system_event').length > 0 && (
          <div className="card-clinical p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-navy-800/8">
              <div className="data-label">Case communication thread</div>
            </div>
            <div className="px-4 py-3 space-y-3 max-h-64 overflow-y-auto">
              {recentMessages
                .filter(m => m.message_type !== 'system_event')
                .map((msg, i) => (
                  <div key={i}
                    className={`flex ${msg.role === 'specialist' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm
                      ${msg.role === 'specialist'
                        ? 'bg-navy-800 text-white rounded-tl-sm'
                        : 'bg-navy-800/8 text-navy-800 rounded-tr-sm'}`}>
                      <div className={`text-2xs mb-1 font-medium
                        ${msg.role === 'specialist' ? 'text-white/60' : 'text-navy-800/50'}`}>
                        {msg.role === 'specialist' ? `Dr. ${specialistName}` : 'You'}
                      </div>
                      <p className="leading-relaxed">{msg.content}</p>
                      <p className={`text-2xs mt-1
                        ${msg.role === 'specialist' ? 'text-white/40' : 'text-navy-800/30'}`}>
                        {new Date(msg.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric', month: 'short',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Reply form */}
        {canReply ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="card-clinical space-y-3">
              <div className="data-label">Your reply to Dr. {specialistName}</div>
              <textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                placeholder="Provide the requested clinical information here..."
                rows={5}
                className="input-clinical resize-none text-sm"
                autoFocus
              />

              {/* Document upload */}
              <div>
                <label className="data-label block mb-2">
                  Attach documents (optional)
                </label>
                <label className="block border-2 border-dashed border-navy-800/15
                                  rounded-xl p-4 text-center cursor-pointer
                                  hover:border-navy-800/30 transition-colors">
                  <input
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.pdf,.heic"
                    className="hidden"
                    onChange={e => {
                      const f = Array.from(e.target.files || []).slice(0, 3)
                      setFiles(f)
                    }}
                  />
                  <div className="text-xs text-navy-800/40">
                    Tap to attach reports or images (max 3 files)
                  </div>
                </label>
                {files.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {files.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs
                                              text-navy-800/60 bg-navy-50 rounded-lg px-3 py-2">
                        <span className="font-mono text-2xs uppercase bg-navy-800/10
                                         px-1.5 rounded text-navy-800/50">
                          {f.name.split('.').pop()}
                        </span>
                        <span className="flex-1 truncate">{f.name}</span>
                        <button type="button"
                          onClick={() => setFiles(p => p.filter((_, j) => j !== i))}
                          className="text-red-400 hover:text-red-600">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Compliance note */}
            <div className="bg-navy-50 border border-navy-800/15 rounded-xl p-3">
              <p className="text-xs text-navy-800/50 leading-relaxed">
                Your reply will be sent directly to Dr. {specialistName} via
                ClinCollab. This communication is for clinical coordination only.
                No financial arrangement is implied.
              </p>
            </div>

            <button
              type="submit"
              disabled={isPending || !reply.trim()}
              className="btn-primary w-full"
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white
                                   rounded-full animate-spin" />
                  Sending reply...
                </span>
              ) : 'Send reply to specialist'}
            </button>
          </form>
        ) : (
          <div className="card-clinical text-center py-6">
            <p className="text-sm text-navy-800/50 mb-1">
              {caseStatus === 'accepted' || caseStatus === 'patient_arrived' ||
               caseStatus === 'procedure_planned' || caseStatus === 'completed' ?
                'The specialist has accepted this referral.' :
                'No reply is needed for this case at this time.'}
            </p>
            <p className="text-xs text-navy-800/35">
              You will be notified via WhatsApp when there are updates.
            </p>
          </div>
        )}

      </main>
    </div>
  )
}
