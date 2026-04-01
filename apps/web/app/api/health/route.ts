import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/health
 * Returns live health status of all modules and external service dependencies.
 * Used by admin dashboard and internal monitoring.
 *
 * Architecture principle: each module writes health events to module_health_log
 * during normal operation. This endpoint reads the latest state per service.
 * No module code is executed here — purely reads from the health table.
 */
export async function GET(request: NextRequest) {
  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const checks = await Promise.allSettled([
    // Supabase connectivity
    sc.from('specialists').select('id', { count: 'exact', head: true }).limit(1),

    // Health log — last known state of all services
    sc.from('v_latest_module_health').select('*'),

    // Circuit breaker states (from in-memory — not persisted across restarts)
    Promise.resolve({ data: getCircuitBreakerSummary() }),
  ])

  const supabaseOk = checks[0].status === 'fulfilled'
  const healthRows = checks[1].status === 'fulfilled'
    ? (checks[1].value as any).data || []
    : []
  const breakerStates = checks[2].status === 'fulfilled'
    ? (checks[2].value as any).data
    : {}

  const modules = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']
  const externalServices = ['groq_api', 'whatsapp_api']

  // Build module health map from health_log
  const healthMap: Record<string, { status: string; latency_ms?: number; recorded_at?: string }> = {}
  healthRows.forEach((row: any) => {
    healthMap[`${row.module}:${row.service}`] = {
      status:      row.status,
      latency_ms:  row.latency_ms,
      recorded_at: row.recorded_at,
    }
  })

  const response = {
    timestamp: new Date().toISOString(),
    overall:   supabaseOk ? 'ok' : 'degraded',
    database: {
      supabase: supabaseOk ? 'ok' : 'down',
    },
    modules: modules.reduce((acc, mod) => {
      const entries = healthRows.filter((r: any) => r.module === mod)
      acc[mod] = {
        status:       entries.length > 0
                        ? entries.every((e: any) => e.status === 'ok') ? 'ok' : 'degraded'
                        : 'unknown',
        services:     entries,
        last_reported:entries[0]?.recorded_at || null,
      }
      return acc
    }, {} as Record<string, any>),
    external_services: externalServices.reduce((acc, svc) => {
      const recent = healthRows.filter((r: any) => r.service === svc).slice(0, 1)[0]
      acc[svc] = {
        status:      recent?.status || 'unknown',
        latency_ms:  recent?.latency_ms,
        last_checked:recent?.recorded_at,
        circuit_breaker: (breakerStates as any)[svc] || { state: 'closed' },
      }
      return acc
    }, {} as Record<string, any>),
    synthesis_queue: await getSynthesisQueueStats(sc),
  }

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}

async function getSynthesisQueueStats(sc: ReturnType<typeof createClient>) {
  try {
    const { data } = await sc
      .from('synthesis_jobs')
      .select('status')
      .gte('created_at', new Date(Date.now() - 3600000).toISOString()) // last hour

    const jobs = data || []
    return {
      queued:    jobs.filter(j => j.status === 'queued').length,
      running:   jobs.filter(j => j.status === 'running').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed:    jobs.filter(j => j.status === 'failed').length,
    }
  } catch {
    return { queued: 0, running: 0, completed: 0, failed: 0 }
  }
}

// Read circuit breaker states from shared-utils memory store
function getCircuitBreakerSummary(): Record<string, any> {
  // In production, this would import from shared-utils
  // For now returns empty — states are in-memory per instance
  return {}
}
