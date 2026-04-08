import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// ── POST: Save (upsert) chatbot config + FAQs ──────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const authClient = await createServerSupabaseClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const db = createServiceRoleClient()

    const { data: specialist } = await db
      .from('specialists')
      .select('id')
      .eq('google_id', user.id)
      .single()

    if (!specialist) return NextResponse.json({ error: 'Specialist not found' }, { status: 404 })

    const { config, faqs } = await request.json()

    // Validate required fields
    if (!config) return NextResponse.json({ error: 'Config required' }, { status: 400 })

    // Upsert chatbot config (conflict on specialist_id)
    const { data: savedConfig, error: configError } = await db
      .from('chatbot_configs')
      .upsert(
        {
          specialist_id:     specialist.id,
          clinic_name:       config.clinic_name       ?? '',
          address:           config.address           ?? '',
          google_maps_url:   config.google_maps_url   ?? null,
          fee_consultation:  config.fee_consultation  ?? null,
          fee_followup:      config.fee_followup       ?? null,
          procedures:        config.procedures         ?? [],
          languages:         config.languages          ?? ['English'],
          escalation_mobile: config.escalation_mobile  ?? null,
          escalation_hours:  config.escalation_hours   ?? 'Monday to Saturday, 9am to 6pm',
          booking_enabled:   config.booking_enabled    ?? true,
          is_live:           config.is_live            ?? false,
          timings:           config.timings            ?? {},
          welcome_message:   config.welcome_message    ?? null,
        },
        { onConflict: 'specialist_id' }
      )
      .select('id')
      .single()

    if (configError) {
      console.error('[Chatbot Config] Upsert error:', configError)
      return NextResponse.json({ error: configError.message }, { status: 500 })
    }

    // Replace FAQs: delete existing, insert fresh (simplest correctness guarantee)
    await db.from('chatbot_faqs').delete().eq('specialist_id', specialist.id)

    if (Array.isArray(faqs) && faqs.length > 0) {
      const faqRows = faqs
        .filter((f: any) => f.question?.trim() && f.answer?.trim())
        .map((f: any, i: number) => ({
          specialist_id: specialist.id,
          question:      f.question.trim(),
          answer:        f.answer.trim(),
          sort_order:    i,
          is_active:     f.is_active !== false,
        }))

      if (faqRows.length > 0) {
        const { error: faqError } = await db.from('chatbot_faqs').insert(faqRows)
        if (faqError) console.error('[Chatbot FAQs] Insert error:', faqError)
      }
    }

    return NextResponse.json({ success: true, configId: savedConfig?.id })
  } catch (error) {
    console.error('[Chatbot Config] Error:', error)
    return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
  }
}

// ── GET: Fetch current config ──────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const authClient = await createServerSupabaseClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const db = createServiceRoleClient()

    const { data: specialist } = await db
      .from('specialists')
      .select('id')
      .eq('google_id', user.id)
      .single()

    if (!specialist) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [configRes, faqsRes] = await Promise.all([
      db.from('chatbot_configs').select('*').eq('specialist_id', specialist.id).single(),
      db.from('chatbot_faqs').select('*').eq('specialist_id', specialist.id).order('sort_order'),
    ])

    return NextResponse.json({ config: configRes.data, faqs: faqsRes.data || [] })
  } catch (error) {
    console.error('[Chatbot Config GET] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch configuration' }, { status: 500 })
  }
}
