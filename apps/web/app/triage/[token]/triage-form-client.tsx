'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import Image from 'next/image'
// ⚠️  Import ONLY from triage-logic (client-safe) — NOT from triage-engine (Node.js only)
import {
  resolveVisibleQuestions,
  formatAnswerForDisplay,
  getQuestionText,
  computeCompletionPct,
  type TriageQuestion,
  type AnswerMap,
  type Lang,
  LANG_LABELS,
} from '@/lib/ai/triage-logic'
import { submitTriageAnswerAction, completeTriage } from '@/app/actions/triage'

interface Props {
  token: string
  sessionId: string
  patientName: string
  specialistName: string
  specialistSpecialty: string
  protocolName: string
  welcomeMessage: string
  estimatedMinutes: number
  questions: TriageQuestion[]
  existingAnswers: AnswerMap
  existingDisplays: Record<string, string>
  language: Lang
}

export default function TriageFormClient({
  token, sessionId, patientName, specialistName, specialistSpecialty,
  protocolName, welcomeMessage, estimatedMinutes,
  questions, existingAnswers, existingDisplays, language: defaultLang,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [lang, setLang] = useState<Lang>(defaultLang)
  const [answers, setAnswers] = useState<AnswerMap>({ ...existingAnswers })
  const [displays, setDisplays] = useState<Record<string, string>>({ ...existingDisplays })
  const [currentIdx, setCurrentIdx] = useState(0)
  const [showWelcome, setShowWelcome] = useState(Object.keys(existingAnswers).length === 0)
  const [completed, setCompleted] = useState(false)
  const [bpSys, setBpSys] = useState('')
  const [bpDia, setBpDia] = useState('')
  const [scaleVal, setScaleVal] = useState<number>(5)
  const [freeText, setFreeText] = useState('')
  const [numberVal, setNumberVal] = useState('')
  const [multiSelected, setMultiSelected] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  const visible = resolveVisibleQuestions(questions, answers)
    .filter(q => q.question_type !== 'section_header')

  const currentQ = visible[currentIdx]
  const pct = computeCompletionPct(visible, answers)
  const isFirst = currentIdx === 0
  const isLast  = currentIdx === visible.length - 1

  // Reset input when question changes
  useEffect(() => {
    if (!currentQ) return
    const existing = answers[currentQ.id]
    setBpSys('')
    setBpDia('')
    setFreeText(existing || '')
    setNumberVal(existing || '')
    setScaleVal(existing ? parseInt(existing, 10) : 5)
    setMultiSelected(existing ? existing.split(',').map(v => v.trim()) : [])
    setTimeout(() => (inputRef.current as any)?.focus?.(), 100)
  }, [currentIdx, currentQ?.id])

  // Save an answer and advance
  async function handleAnswer(rawValue: string, displayValue: string) {
    if (!currentQ || !rawValue.trim()) return

    const newAnswers = { ...answers, [currentQ.id]: rawValue }
    const newDisplays = { ...displays, [currentQ.id]: displayValue }
    setAnswers(newAnswers)
    setDisplays(newDisplays)

    // Persist to server
    startTransition(async () => {
      await submitTriageAnswerAction(token, currentQ.id, rawValue, displayValue)
    })

    // Advance or complete
    if (isLast) {
      // Check if all visible required questions are answered
      const newVisible = resolveVisibleQuestions(questions, newAnswers)
        .filter(q => q.question_type !== 'section_header')
      const allRequired = newVisible.every(q => !q.is_required || newAnswers[q.id]?.trim())

      if (allRequired) {
        startTransition(async () => {
          await completeTriage(token)
          setCompleted(true)
        })
      } else {
        // Find first unanswered required question
        const unanswered = newVisible.findIndex(q => q.is_required && !newAnswers[q.id]?.trim())
        if (unanswered >= 0) setCurrentIdx(unanswered)
      }
    } else {
      setCurrentIdx(idx => idx + 1)
    }
  }

  function handleSkip() {
    if (currentQ?.is_required) return
    if (isLast) return
    setCurrentIdx(idx => idx + 1)
  }

  function handleBack() {
    if (currentIdx > 0) setCurrentIdx(idx => idx - 1)
  }

  if (completed) {
    return (
      <div className="min-h-screen bg-clinical-light flex items-center justify-center px-4">
        <div className="max-w-sm text-center animate-slide-up">
          <div className="w-16 h-16 bg-forest-700 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M5 12l5 5L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="font-display text-2xl text-navy-800 mb-2">Triage complete</h1>
          <p className="text-sm text-navy-800/60 mb-4 leading-relaxed">
            Your responses have been sent to Dr. {specialistName}. Please wait to be called in.
          </p>
          <p className="text-xs text-navy-800/30">Powered by ClinCollab</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-clinical-light">
      {/* Header */}
      <div className="bg-white border-b border-navy-800/8 sticky top-0 z-40">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center gap-2.5 mb-2">
            <Image src="/logo.png" alt="ClinCollab" width={22} height={22} />
            <div className="flex-1">
              <div className="text-xs font-medium text-navy-800">
                {protocolName} — Dr. {specialistName}
              </div>
              <div className="text-2xs text-navy-800/50">
                {specialistSpecialty.replace(/_/g, ' ')}
              </div>
            </div>
            {/* Language selector */}
            <select
              value={lang}
              onChange={e => setLang(e.target.value as Lang)}
              className="text-2xs text-navy-800/60 border border-navy-800/15 rounded-lg px-2 py-1 bg-white"
            >
              {(Object.keys(LANG_LABELS) as Lang[]).map(l => (
                <option key={l} value={l}>{LANG_LABELS[l]}</option>
              ))}
            </select>
          </div>
          {/* Progress bar */}
          {!showWelcome && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-navy-800/8 rounded-full overflow-hidden">
                <div
                  className="h-full bg-navy-800 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-2xs text-navy-800/40 flex-shrink-0">
                {currentIdx + 1} / {visible.length}
              </span>
            </div>
          )}
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-6">

        {/* Welcome screen */}
        {showWelcome && (
          <div className="animate-slide-up space-y-5">
            <div className="card-clinical">
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-navy-800/8 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-navy-800">
                    <path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h1 className="font-display text-xl text-navy-800 mb-1">Hello, {patientName}</h1>
                <p className="text-sm text-navy-800/60 leading-relaxed">
                  {welcomeMessage}
                </p>
              </div>

              <div className="bg-navy-50 rounded-xl p-3 mb-4 space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-navy-800/60">
                  <span className="w-1.5 h-1.5 rounded-full bg-forest-700 flex-shrink-0" />
                  Takes approximately {estimatedMinutes} minutes
                </div>
                <div className="flex items-center gap-2 text-xs text-navy-800/60">
                  <span className="w-1.5 h-1.5 rounded-full bg-forest-700 flex-shrink-0" />
                  Your answers go directly to Dr. {specialistName}
                </div>
                <div className="flex items-center gap-2 text-xs text-navy-800/60">
                  <span className="w-1.5 h-1.5 rounded-full bg-forest-700 flex-shrink-0" />
                  Answer as accurately as possible — this helps your consultation
                </div>
              </div>

              <button
                onClick={() => setShowWelcome(false)}
                className="btn-primary w-full"
              >
                Begin triage
              </button>
            </div>
          </div>
        )}

        {/* Question flow */}
        {!showWelcome && currentQ && (
          <div className="animate-fade-in space-y-4">

            {/* Section header */}
            {currentQ.section && (
              <div className="text-2xs font-medium text-navy-800/40 uppercase tracking-wider">
                {currentQ.section}
              </div>
            )}

            {/* Question card */}
            <div className="card-clinical">
              <div className="mb-4">
                <h2 className="font-sans text-base font-medium text-navy-800 leading-snug mb-1">
                  {getQuestionText(currentQ, lang)}
                  {currentQ.is_required && (
                    <span className="text-red-400 ml-1">*</span>
                  )}
                </h2>
                {currentQ.help_text && (
                  <p className="text-xs text-navy-800/50 leading-relaxed">{currentQ.help_text}</p>
                )}
              </div>

              {/* YES/NO */}
              {currentQ.question_type === 'yes_no' && (
                <div className="grid grid-cols-2 gap-3">
                  {['yes', 'no'].map(v => (
                    <button
                      key={v}
                      onClick={() => handleAnswer(v, v === 'yes' ? 'Yes' : 'No')}
                      disabled={isPending}
                      className={`py-4 rounded-xl border text-sm font-medium transition-all
                        active:scale-95 ${answers[currentQ.id] === v
                          ? v === 'yes'
                            ? 'border-forest-700 bg-forest-50 text-forest-700'
                            : 'border-navy-800 bg-navy-50 text-navy-800'
                          : 'border-navy-800/15 text-navy-800/70 hover:border-navy-800/30'}`}
                    >
                      {v === 'yes' ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
              )}

              {/* SINGLE CHOICE */}
              {currentQ.question_type === 'single_choice' && (
                <div className="space-y-2">
                  {currentQ.options.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => handleAnswer(opt.value, opt.label)}
                      disabled={isPending}
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm
                        transition-all active:scale-98
                        ${answers[currentQ.id] === opt.value
                          ? 'border-navy-800 bg-navy-50 text-navy-800 font-medium'
                          : 'border-navy-800/15 text-navy-800/70 hover:border-navy-800/30'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {/* MULTI CHOICE */}
              {currentQ.question_type === 'multi_choice' && (
                <div className="space-y-2">
                  {currentQ.options.map(opt => {
                    const sel = multiSelected.includes(opt.value)
                    return (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setMultiSelected(prev =>
                            sel ? prev.filter(v => v !== opt.value) : [...prev, opt.value]
                          )
                        }}
                        className={`w-full text-left px-4 py-3 rounded-xl border text-sm
                          transition-all flex items-center gap-2.5
                          ${sel
                            ? 'border-navy-800 bg-navy-50 text-navy-800 font-medium'
                            : 'border-navy-800/15 text-navy-800/70 hover:border-navy-800/30'}`}
                      >
                        <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all
                          ${sel ? 'bg-navy-800 border-navy-800' : 'border-navy-800/30'}`}>
                          {sel && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                              <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                        {opt.label}
                      </button>
                    )
                  })}
                  {multiSelected.length > 0 && (
                    <button
                      onClick={() => {
                        const displayVal = multiSelected
                          .map(v => currentQ.options.find(o => o.value === v)?.label || v)
                          .join(', ')
                        handleAnswer(multiSelected.join(', '), displayVal)
                      }}
                      disabled={isPending}
                      className="btn-primary w-full mt-2"
                    >
                      {isPending ? 'Saving...' : `Confirm (${multiSelected.length} selected)`}
                    </button>
                  )}
                </div>
              )}

              {/* SCALE */}
              {currentQ.question_type === 'scale' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-navy-800/50 px-1">
                    <span>Mild ({currentQ.min_value || 1})</span>
                    <span className="font-display text-3xl text-navy-800">{scaleVal}</span>
                    <span>Severe ({currentQ.max_value || 10})</span>
                  </div>
                  <input
                    type="range"
                    min={currentQ.min_value || 1}
                    max={currentQ.max_value || 10}
                    value={scaleVal}
                    onChange={e => setScaleVal(parseInt(e.target.value, 10))}
                    className="w-full accent-navy-800"
                  />
                  <div className="flex justify-between px-1">
                    {Array.from(
                      { length: (currentQ.max_value || 10) - (currentQ.min_value || 1) + 1 },
                      (_, i) => (currentQ.min_value || 1) + i
                    ).map(n => (
                      <button
                        key={n}
                        onClick={() => setScaleVal(n)}
                        className={`w-7 h-7 rounded-full text-xs font-medium transition-all
                          ${scaleVal === n ? 'bg-navy-800 text-white' : 'text-navy-800/40 hover:bg-navy-50'}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => handleAnswer(String(scaleVal), `${scaleVal} / ${currentQ.max_value || 10}`)}
                    disabled={isPending}
                    className="btn-primary w-full"
                  >
                    {isPending ? 'Saving...' : `Confirm — ${scaleVal} / ${currentQ.max_value || 10}`}
                  </button>
                </div>
              )}

              {/* VITALS BP */}
              {currentQ.question_type === 'vitals_bp' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="data-label block mb-1.5">Systolic (upper)</label>
                      <input
                        type="number"
                        value={bpSys}
                        onChange={e => setBpSys(e.target.value)}
                        placeholder="120"
                        className="input-clinical text-center"
                        inputMode="numeric"
                      />
                    </div>
                    <div>
                      <label className="data-label block mb-1.5">Diastolic (lower)</label>
                      <input
                        type="number"
                        value={bpDia}
                        onChange={e => setBpDia(e.target.value)}
                        placeholder="80"
                        className="input-clinical text-center"
                        inputMode="numeric"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (!bpSys && !bpDia) { handleSkip(); return }
                      const val = `${bpSys}/${bpDia}`
                      handleAnswer(bpSys, val)
                    }}
                    disabled={isPending}
                    className="btn-primary w-full"
                  >
                    {isPending ? 'Saving...' : bpSys ? `Confirm — ${bpSys}/${bpDia} mmHg` : 'Skip'}
                  </button>
                </div>
              )}

              {/* VITALS SINGLE or NUMBER */}
              {(currentQ.question_type === 'vitals_single' || currentQ.question_type === 'number') && (
                <div className="space-y-3">
                  <div className="flex gap-2 items-center">
                    <input
                      ref={inputRef as any}
                      type="number"
                      value={numberVal}
                      onChange={e => setNumberVal(e.target.value)}
                      placeholder={currentQ.unit ? `Enter in ${currentQ.unit}` : 'Enter value'}
                      className="input-clinical flex-1 text-center"
                      inputMode="decimal"
                      min={currentQ.min_value || undefined}
                      max={currentQ.max_value || undefined}
                    />
                    {currentQ.unit && (
                      <span className="text-sm text-navy-800/50 flex-shrink-0 font-mono">
                        {currentQ.unit}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (!numberVal) { handleSkip(); return }
                      const display = currentQ.unit ? `${numberVal} ${currentQ.unit}` : numberVal
                      handleAnswer(numberVal, display)
                    }}
                    disabled={isPending}
                    className="btn-primary w-full"
                  >
                    {isPending ? 'Saving...' : numberVal ? `Confirm — ${numberVal}${currentQ.unit ? ` ${currentQ.unit}` : ''}` : 'Skip'}
                  </button>
                </div>
              )}

              {/* TEXT */}
              {currentQ.question_type === 'text' && (
                <div className="space-y-3">
                  <textarea
                    ref={inputRef as any}
                    value={freeText}
                    onChange={e => setFreeText(e.target.value)}
                    placeholder="Type your answer here..."
                    rows={3}
                    className="input-clinical resize-none text-sm"
                  />
                  <button
                    onClick={() => {
                      if (!freeText.trim()) { handleSkip(); return }
                      handleAnswer(freeText.trim(), freeText.trim())
                    }}
                    disabled={isPending || (!freeText.trim() && currentQ.is_required)}
                    className="btn-primary w-full"
                  >
                    {isPending ? 'Saving...' : 'Continue'}
                  </button>
                </div>
              )}

              {/* DATE */}
              {currentQ.question_type === 'date' && (
                <div className="space-y-3">
                  <input
                    type="date"
                    value={freeText}
                    onChange={e => setFreeText(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    className="input-clinical"
                  />
                  <button
                    onClick={() => {
                      if (!freeText) { handleSkip(); return }
                      const d = new Date(freeText).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                      handleAnswer(freeText, d)
                    }}
                    disabled={isPending}
                    className="btn-primary w-full"
                  >
                    {isPending ? 'Saving...' : freeText ? `Confirm — ${new Date(freeText).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}` : 'Skip'}
                  </button>
                </div>
              )}
            </div>

            {/* Navigation */}
            <div className="flex gap-3">
              {!isFirst && (
                <button
                  onClick={handleBack}
                  className="btn-secondary flex-shrink-0 px-5"
                >
                  Back
                </button>
              )}
              {!currentQ.is_required && !isLast && (
                <button
                  onClick={handleSkip}
                  className="text-xs text-navy-800/40 hover:text-navy-800/60 transition-colors ml-auto py-2"
                >
                  Skip
                </button>
              )}
            </div>

            {/* Prior answers summary (collapsible) */}
            {Object.keys(answers).length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-navy-800/40 cursor-pointer hover:text-navy-800/60 transition-colors">
                  View your previous answers ({Object.keys(answers).length})
                </summary>
                <div className="mt-3 card-clinical p-3 space-y-2">
                  {visible.slice(0, currentIdx).map(q => {
                    const a = displays[q.id] || answers[q.id]
                    if (!a) return null
                    return (
                      <div key={q.id} className="flex gap-2 text-xs">
                        <span className="text-navy-800/50 flex-1 leading-relaxed">{getQuestionText(q, lang)}</span>
                        <span className="text-navy-800 font-medium flex-shrink-0 text-right">{a}</span>
                      </div>
                    )
                  })}
                </div>
              </details>
            )}

          </div>
        )}

      </main>
    </div>
  )
}
