'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import type { BookingState } from '@/lib/ai/chatbot-engine'

interface Message {
  id: string
  role: 'patient' | 'assistant'
  content: string
  timestamp: Date
}

interface WebChatWidgetProps {
  specialistId: string
  specialistName: string
  specialistSpecialty: string
}

export default function WebChatWidget({
  specialistId,
  specialistName,
  specialistSpecialty,
}: WebChatWidgetProps) {
  const [isOpen, setIsOpen]       = useState(false)
  const [messages, setMessages]   = useState<Message[]>([])
  const [input, setInput]         = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [bookingState, setBookingState] = useState<BookingState | null>(null)
  const [hasGreeted, setHasGreeted]     = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && !hasGreeted) {
      sendGreeting()
      setHasGreeted(true)
    }
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  async function sendGreeting() {
    const greeting: Message = {
      id:        `greet-${Date.now()}`,
      role:      'assistant',
      content:   `Hello! I'm the virtual assistant for Dr. ${specialistName} (${specialistSpecialty.replace(/_/g, ' ')}).\n\nI can help you with:\n• Appointment booking\n• Clinic timings and location\n• Fee information\n• Procedure queries\n\nHow can I help you today?`,
      timestamp: new Date(),
    }
    setMessages([greeting])
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id:        `user-${Date.now()}`,
      role:      'patient',
      content:   input.trim(),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specialistId,
          sessionId,
          message:      userMessage.content,
          bookingState,
        }),
      })

      const data = await res.json()

      const assistantMessage: Message = {
        id:        `ai-${Date.now()}`,
        role:      'assistant',
        content:   data.response,
        timestamp: new Date(),
      }

      setMessages(prev => [...prev, assistantMessage])
      if (data.sessionId)    setSessionId(data.sessionId)
      if (data.bookingState !== undefined) setBookingState(data.bookingState)
    } catch {
      setMessages(prev => [...prev, {
        id:        `err-${Date.now()}`,
        role:      'assistant',
        content:   'I\'m having trouble right now. Please try again or contact the clinic directly.',
        timestamp: new Date(),
      }])
    } finally {
      setIsLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend(e as any)
    }
  }

  function formatTime(d: Date) {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  }

  function formatMessageContent(content: string) {
    return content.split('\n').map((line, i) => (
      <span key={i}>
        {line}
        {i < content.split('\n').length - 1 && <br />}
      </span>
    ))
  }

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`Hi, I'd like to know more about Dr. ${specialistName}'s clinic.`)}`

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 bg-navy-800 rounded-full
                    shadow-clinical-lg flex items-center justify-center
                    hover:bg-navy-900 active:scale-95 transition-all
                    ${isOpen ? 'hidden' : 'flex'}`}
        aria-label="Open chat"
      >
        <ChatIcon />
        {/* Unread indicator */}
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-forest-700 rounded-full
                         text-white text-2xs flex items-center justify-center">
          1
        </span>
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-full max-w-sm
                        bg-white rounded-2xl shadow-clinical-lg border border-navy-800/10
                        flex flex-col animate-slide-up"
             style={{ height: '480px' }}>

          {/* Header */}
          <div className="bg-navy-800 rounded-t-2xl px-4 py-3 flex items-center gap-3">
            <Image src="/logo.png" alt="" width={28} height={28} className="flex-shrink-0" />
            <div className="flex-1">
              <div className="text-white text-sm font-medium">Dr. {specialistName}</div>
              <div className="text-white/60 text-xs">{specialistSpecialty.replace(/_/g, ' ')}</div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-white/60 hover:text-white transition-colors p-1"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Online indicator */}
          <div className="px-4 py-1.5 bg-navy-800/5 border-b border-navy-800/8">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-forest-700 animate-pulse-soft" />
              <span className="text-2xs text-navy-800/50">Virtual assistant · Online 24/7</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'patient' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-navy-800/8 flex items-center
                                  justify-center mr-2 flex-shrink-0 mt-0.5">
                    <span className="text-2xs font-medium text-navy-800">AI</span>
                  </div>
                )}
                <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                  ${msg.role === 'patient'
                    ? 'bg-navy-800 text-white rounded-tr-sm'
                    : 'bg-navy-800/6 text-navy-800 rounded-tl-sm'}`}
                >
                  <p className="whitespace-pre-wrap break-words">
                    {formatMessageContent(msg.content)}
                  </p>
                  <p className={`text-2xs mt-1 ${
                    msg.role === 'patient' ? 'text-white/50' : 'text-navy-800/30'
                  }`}>
                    {formatTime(msg.timestamp)}
                  </p>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="w-7 h-7 rounded-full bg-navy-800/8 flex items-center
                                justify-center mr-2 flex-shrink-0 mt-0.5">
                  <span className="text-2xs font-medium text-navy-800">AI</span>
                </div>
                <div className="bg-navy-800/6 rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1 items-center">
                    {[0, 1, 2].map(i => (
                      <div key={i}
                        className="w-1.5 h-1.5 bg-navy-800/30 rounded-full animate-bounce"
                        style={{ animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Quick replies */}
          {messages.length === 1 && (
            <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto">
              {['Book appointment', 'Clinic timings', 'Consultation fee', 'Location'].map(q => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q)
                    setTimeout(() => {
                      const fakeEvent = { preventDefault: () => {} } as any
                      setInput(q)
                    }, 10)
                  }}
                  className="flex-shrink-0 text-2xs bg-navy-800/8 text-navy-800/70
                             px-2.5 py-1.5 rounded-full hover:bg-navy-800/15
                             transition-colors whitespace-nowrap"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* WhatsApp CTA */}
          <div className="px-4 pb-2">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full text-xs
                         text-green-700 bg-green-50 rounded-xl py-2 hover:bg-green-100
                         transition-colors"
            >
              <WhatsAppMiniIcon />
              Continue on WhatsApp
            </a>
          </div>

          {/* Input */}
          <form onSubmit={handleSend}
            className="flex gap-2 px-4 pb-4 pt-2 border-t border-navy-800/8">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              className="flex-1 input-clinical text-sm py-2.5"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="w-10 h-10 bg-navy-800 rounded-xl flex items-center justify-center
                         hover:bg-navy-900 active:scale-95 transition-all
                         disabled:opacity-40 flex-shrink-0"
            >
              <SendIcon />
            </button>
          </form>
        </div>
      )}
    </>
  )
}

// ── Icons ──────────────────────────────────────────
function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"
            stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M14 4L4 14M4 4l10 10" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round"/>
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M16 9L2 2l4 7-4 7 14-7z" stroke="white" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function WhatsAppMiniIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#16a34a">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}
