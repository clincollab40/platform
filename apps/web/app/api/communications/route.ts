import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/communications
 * Internal API route — receives action dispatches from M9 server actions.
 * Runs the communication engine in isolation.
 *
 * Path: apps/web/app/api/communications/route.ts
 * Engine: ../../../../../services/communication-engine/engine.ts
 */
export async function POST(request: NextRequest) {
  const key = request.headers.get('x-internal-key') || ''
  const expected = process.env.INTERNAL_API_KEY || ''
  if (expected && key !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action, specialistId, planId } = body
  if (!action || !specialistId || !planId) {
    return NextResponse.json({ error: 'action, specialistId, planId required' }, { status: 400 })
  }

  // Acknowledge immediately
  const bg = processAction(action, body)
  bg.catch(e => console.error('[/api/communications] Error:', e))

  return NextResponse.json({ accepted: true, action, planId }, { status: 202 })
}

async function processAction(action: string, body: any) {
  try {
    const { broadcastToStakeholders, recordMilestone } = await import(
      '../../../../../services/communication-engine/engine'
    )

    switch (action) {
      case 'broadcast':
        await broadcastToStakeholders({
          planId:          body.planId,
          event:           body.event,
          rolesFilter:     body.rolesFilter,
          customMessage:   body.customMessage,
        })
        break

      case 'send_to_one': {
        const sc = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } }
        )

        const { data: stakeholder } = await sc
          .from('procedure_stakeholders')
          .select('id, mobile, role, name')
          .eq('id', body.stakeholderId).single()

        if (stakeholder?.mobile) {
          await broadcastToStakeholders({
            planId:               body.planId,
            event:                'custom',
            rolesFilter:          [stakeholder.role],
            customMessage:        body.message,
            requireConfirmation:  body.requireConfirmation,
          })
        }
        break
      }

      case 'record_milestone':
        await recordMilestone(
          body.planId, body.specialistId,
          body.milestoneName, body.milestoneLabel, body.sequenceOrder,
          body.options || {}
        )
        break

      default:
        console.warn('[/api/communications] Unknown action:', action)
    }
  } catch (error) {
    console.error('[/api/communications] Pipeline error:', action, error)
  }
}

/**
 * POST /api/communications/inbound
 * Called by the M4 WhatsApp webhook when a message arrives
 * that matches a procedure_stakeholder (M9 routing mode).
 */
export async function PUT(request: NextRequest) {
  const key = request.headers.get('x-internal-key') || ''
  if (process.env.INTERNAL_API_KEY && key !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { fromMobile, messageText, waMessageId, receivedAt, specialistId } = body

  if (!fromMobile || !messageText || !specialistId) {
    return NextResponse.json({ error: 'fromMobile, messageText, specialistId required' }, { status: 400 })
  }

  const bg = processInbound({ fromMobile, messageText, waMessageId, receivedAt, specialistId })
  bg.catch(e => console.error('[/api/communications/inbound] Error:', e))

  return NextResponse.json({ accepted: true }, { status: 202 })
}

async function processInbound(params: any) {
  try {
    const { processInboundReply } = await import(
      '../../../../../services/communication-engine/engine'
    )
    await processInboundReply(
      { fromMobile: params.fromMobile, messageText: params.messageText,
        waMessageId: params.waMessageId || '', receivedAt: params.receivedAt || new Date().toISOString() },
      params.specialistId
    )
  } catch (e) {
    console.error('[/api/communications/inbound] Error:', e)
  }
}
