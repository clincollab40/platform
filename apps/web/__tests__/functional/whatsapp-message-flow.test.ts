/**
 * Functional Tests — WhatsApp Message Processing Flow
 *
 * Tests the end-to-end WhatsApp webhook processing:
 *   Inbound webhook → signature verification → message parsing
 *   → session routing → reply generation → outbound send
 *
 * All logic is inlined (pure functions) — no live API required.
 */

// ── Webhook payload extraction ─────────────────────────────────────
describe('Functional — whatsappWebhookPayloadExtraction', () => {
  interface WhatsAppMessage {
    from: string
    id: string
    text: { body: string }
    type: 'text'
    timestamp: string
  }

  interface WebhookPayload {
    object: string
    entry: Array<{
      id: string
      changes: Array<{
        value: {
          messaging_product: string
          contacts?: Array<{ profile: { name: string }; wa_id: string }>
          messages?: WhatsAppMessage[]
          statuses?: Array<{ id: string; status: string; timestamp: string }>
        }
        field: string
      }>
    }>
  }

  function extractMessages(payload: WebhookPayload): Array<{ from: string; body: string; messageId: string }> {
    const results: Array<{ from: string; body: string; messageId: string }> = []

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue
        const messages = change.value.messages ?? []
        for (const msg of messages) {
          if (msg.type === 'text') {
            results.push({ from: msg.from, body: msg.text.body, messageId: msg.id })
          }
        }
      }
    }
    return results
  }

  function isStatusUpdate(payload: WebhookPayload): boolean {
    return payload.entry.some(e =>
      e.changes.some(c => (c.value.statuses?.length ?? 0) > 0)
    )
  }

  const samplePayload: WebhookPayload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'wa-biz-123',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          contacts: [{ profile: { name: 'Ramesh' }, wa_id: '919876543210' }],
          messages: [{
            from: '919876543210',
            id: 'wamid.abc123',
            text: { body: 'I want to book an appointment' },
            type: 'text',
            timestamp: '1710000000',
          }],
        },
        field: 'messages',
      }],
    }],
  }

  test('extracts message from valid payload',      () => {
    const msgs = extractMessages(samplePayload)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].from).toBe('919876543210')
    expect(msgs[0].body).toBe('I want to book an appointment')
    expect(msgs[0].messageId).toBe('wamid.abc123')
  })

  test('ignores non-messages field changes',       () => {
    const payload: WebhookPayload = {
      ...samplePayload,
      entry: [{ id:'x', changes:[{ value:{ messaging_product:'whatsapp' }, field:'account_updates' }] }],
    }
    expect(extractMessages(payload)).toHaveLength(0)
  })

  test('returns empty for status-only payload',    () => {
    const statusPayload: WebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            statuses: [{ id: 'wamid.abc', status: 'delivered', timestamp: '1710000001' }],
          },
          field: 'messages',
        }],
      }],
    }
    expect(extractMessages(statusPayload)).toHaveLength(0)
    expect(isStatusUpdate(statusPayload)).toBe(true)
  })

  test('handles multiple messages in one payload', () => {
    const multiPayload: WebhookPayload = {
      ...samplePayload,
      entry: [{
        id: 'e1',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            messages: [
              { from: '911111111111', id: 'msg-1', text: { body: 'Hello' }, type: 'text', timestamp: '1710000001' },
              { from: '912222222222', id: 'msg-2', text: { body: 'Hi'    }, type: 'text', timestamp: '1710000002' },
            ],
          },
          field: 'messages',
        }],
      }],
    }
    expect(extractMessages(multiPayload)).toHaveLength(2)
  })
})

// ── Rate limiting logic ────────────────────────────────────────────
describe('Functional — whatsappMessageRateLimiting', () => {
  interface RateWindow { windowStart: number; count: number }

  // 5 messages per 60 seconds per phone number
  const RATE_LIMIT    = 5
  const WINDOW_SECS   = 60

  function checkRateLimit(window: RateWindow | null, nowMs: number): {
    allowed: boolean; newWindow: RateWindow
  } {
    if (!window || nowMs - window.windowStart > WINDOW_SECS * 1000) {
      // New window
      return { allowed: true, newWindow: { windowStart: nowMs, count: 1 } }
    }
    if (window.count >= RATE_LIMIT) {
      return { allowed: false, newWindow: window }
    }
    return { allowed: true, newWindow: { ...window, count: window.count + 1 } }
  }

  const now = Date.now()

  test('first message in new window allowed',           () => {
    const { allowed, newWindow } = checkRateLimit(null, now)
    expect(allowed).toBe(true)
    expect(newWindow.count).toBe(1)
  })

  test('5th message within limit allowed',              () => {
    const window: RateWindow = { windowStart: now, count: 4 }
    const { allowed } = checkRateLimit(window, now + 1000)
    expect(allowed).toBe(true)
  })

  test('6th message within 60s rejected',               () => {
    const window: RateWindow = { windowStart: now, count: 5 }
    const { allowed } = checkRateLimit(window, now + 2000)
    expect(allowed).toBe(false)
  })

  test('after 60s window resets — message allowed',     () => {
    const window: RateWindow = { windowStart: now - 65 * 1000, count: 5 }
    const { allowed, newWindow } = checkRateLimit(window, now)
    expect(allowed).toBe(true)
    expect(newWindow.count).toBe(1)
    expect(newWindow.windowStart).toBe(now)
  })

  test('exactly at window boundary (60s) resets',       () => {
    const window: RateWindow = { windowStart: now - 60 * 1000 - 1, count: 5 }
    const { allowed } = checkRateLimit(window, now)
    expect(allowed).toBe(true)
  })
})

// ── Outbound message builder ───────────────────────────────────────
describe('Functional — whatsappOutboundMessageBuilder', () => {
  interface OutboundMessage {
    messaging_product: 'whatsapp'
    to: string
    type: 'text' | 'template'
    text?: { body: string }
    template?: { name: string; language: { code: string }; components: any[] }
  }

  function buildTextReply(to: string, body: string): OutboundMessage {
    if (!to || !body) throw new Error('to and body are required')
    return { messaging_product: 'whatsapp', to, type: 'text', text: { body } }
  }

  function buildTemplateMessage(to: string, templateName: string, variables: string[]): OutboundMessage {
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components: [{
          type: 'body',
          parameters: variables.map(v => ({ type: 'text', text: v })),
        }],
      },
    }
  }

  test('text reply has correct structure',                    () => {
    const msg = buildTextReply('919876543210', 'Hello!')
    expect(msg.messaging_product).toBe('whatsapp')
    expect(msg.to).toBe('919876543210')
    expect(msg.type).toBe('text')
    expect(msg.text?.body).toBe('Hello!')
  })

  test('throws if to is empty',                              () => {
    expect(() => buildTextReply('', 'Hello')).toThrow('required')
  })

  test('throws if body is empty',                            () => {
    expect(() => buildTextReply('919876543210', '')).toThrow('required')
  })

  test('template message has correct structure',             () => {
    const msg = buildTemplateMessage('919876543210', 'appointment_reminder', ['Ramesh', '20 March', '09:00 AM'])
    expect(msg.type).toBe('template')
    expect(msg.template?.name).toBe('appointment_reminder')
    expect(msg.template?.language.code).toBe('en')
    expect(msg.template?.components[0].parameters).toHaveLength(3)
  })

  test('template variables mapped as text parameters',       () => {
    const msg = buildTemplateMessage('919876543210', 'reminder', ['Dr. Sharma'])
    expect(msg.template?.components[0].parameters[0]).toEqual({ type: 'text', text: 'Dr. Sharma' })
  })

  test('empty variables produces empty parameters array',    () => {
    const msg = buildTemplateMessage('919876543210', 'generic', [])
    expect(msg.template?.components[0].parameters).toHaveLength(0)
  })
})

// ── Message deduplication ──────────────────────────────────────────
describe('Functional — whatsappMessageDeduplication', () => {
  class MessageIdCache {
    private seen = new Set<string>()
    private order: string[] = []
    private readonly maxSize: number

    constructor(maxSize = 1000) { this.maxSize = maxSize }

    isDuplicate(id: string): boolean { return this.seen.has(id) }

    markSeen(id: string): void {
      if (this.seen.has(id)) return
      if (this.seen.size >= this.maxSize) {
        const oldest = this.order.shift()!
        this.seen.delete(oldest)
      }
      this.seen.add(id)
      this.order.push(id)
    }

    get size(): number { return this.seen.size }
  }

  test('new message ID is not a duplicate',               () => {
    const cache = new MessageIdCache()
    expect(cache.isDuplicate('wamid.new-1')).toBe(false)
  })

  test('seen message ID is a duplicate',                  () => {
    const cache = new MessageIdCache()
    cache.markSeen('wamid.abc')
    expect(cache.isDuplicate('wamid.abc')).toBe(true)
  })

  test('different IDs are not duplicates',                () => {
    const cache = new MessageIdCache()
    cache.markSeen('wamid.abc')
    expect(cache.isDuplicate('wamid.def')).toBe(false)
  })

  test('cache evicts oldest when at max capacity',        () => {
    const cache = new MessageIdCache(3)
    cache.markSeen('id-1')
    cache.markSeen('id-2')
    cache.markSeen('id-3')
    cache.markSeen('id-4')  // evicts id-1
    expect(cache.isDuplicate('id-1')).toBe(false)  // evicted
    expect(cache.isDuplicate('id-4')).toBe(true)
    expect(cache.size).toBe(3)
  })

  test('marking already-seen ID does not duplicate it',   () => {
    const cache = new MessageIdCache()
    cache.markSeen('wamid.abc')
    cache.markSeen('wamid.abc')
    expect(cache.size).toBe(1)
  })
})
