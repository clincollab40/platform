-- ════════════════════════════════════════════════════════════════════════════
-- Migration 014 — Communication Pipeline View
--
-- Adds a denormalised view for the Communications Pipeline dashboard.
-- Per-plan aggregate: stakeholder counts by status, pending confirmations,
-- unresolved escalations, schedule bucket.
--
-- This view is the data backbone of /communication (pipeline dashboard).
-- ════════════════════════════════════════════════════════════════════════════

-- ── VIEW: v_procedure_comms_pipeline ─────────────────────────────────────
-- One row per active procedure_plan.
-- All counts are computed fresh on every query (no materialisation needed
-- at current scale; add MATERIALIZED VIEW + REFRESH ON trigger if >500 plans).
CREATE OR REPLACE VIEW v_procedure_comms_pipeline AS
SELECT
  pp.id                    AS plan_id,
  pp.specialist_id,
  pp.patient_name,
  pp.procedure_name,
  pp.urgency,
  pp.status                AS plan_status,
  pp.scheduled_date,
  pp.scheduled_time,
  pp.consent_status,
  pp.workup_complete,

  -- Stakeholder counts
  COUNT(DISTINCT ps.id)                                             AS total_stakeholders,
  COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'confirmed')     AS confirmed_count,
  COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'pending')       AS pending_count,
  COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'notified')      AS notified_count,
  COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'non_responsive')AS non_responsive_count,
  COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'declined')      AS declined_count,

  -- Confirmation tracking
  COUNT(DISTINCT cr.id) FILTER (WHERE cr.is_resolved = FALSE)      AS pending_confirmations,
  COUNT(DISTINCT cr.id) FILTER (
    WHERE cr.is_resolved = FALSE
      AND cr.response_required_by IS NOT NULL
      AND cr.response_required_by < NOW()
  )                                                                 AS overdue_confirmations,

  -- Escalations
  COUNT(DISTINCT ee.id) FILTER (WHERE ee.resolved = FALSE)         AS unresolved_escalations,

  -- Unread messages across all threads
  COALESCE(SUM(ct.unread_count), 0)                                AS total_unread,

  -- Schedule bucket (computed based on today's date)
  CASE
    WHEN pp.scheduled_date IS NULL                            THEN 'unscheduled'
    WHEN pp.scheduled_date = CURRENT_DATE                    THEN 'today'
    WHEN pp.scheduled_date = CURRENT_DATE + INTERVAL '1 day' THEN 'tomorrow'
    WHEN pp.scheduled_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
    WHEN pp.scheduled_date > CURRENT_DATE + INTERVAL '7 days'  THEN 'upcoming'
    WHEN pp.scheduled_date < CURRENT_DATE                    THEN 'past'
    ELSE 'unscheduled'
  END                                                              AS schedule_bucket,

  -- Days until procedure (negative = past)
  CASE
    WHEN pp.scheduled_date IS NOT NULL
    THEN (pp.scheduled_date - CURRENT_DATE)
    ELSE NULL
  END                                                              AS days_until_procedure,

  -- Overall comms health:
  -- 'critical'  — today/tomorrow + non-responsive or overdue
  -- 'warning'   — this week + pending confirmations or non-responsive
  -- 'attention' — some pending actions
  -- 'ready'     — all confirmed for this timeframe
  -- 'draft'     — no stakeholders added yet
  CASE
    WHEN COUNT(DISTINCT ps.id) = 0
      THEN 'draft'
    WHEN (
      (pp.scheduled_date IS NOT NULL AND pp.scheduled_date <= CURRENT_DATE + INTERVAL '1 day')
      AND (
        COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'non_responsive') > 0
        OR COUNT(DISTINCT cr.id) FILTER (WHERE cr.is_resolved = FALSE AND cr.response_required_by < NOW()) > 0
        OR COUNT(DISTINCT ee.id) FILTER (WHERE ee.resolved = FALSE) > 0
      )
    ) THEN 'critical'
    WHEN (
      COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'non_responsive') > 0
      OR COUNT(DISTINCT ee.id) FILTER (WHERE ee.resolved = FALSE) > 0
    ) THEN 'critical'
    WHEN COUNT(DISTINCT cr.id) FILTER (WHERE cr.is_resolved = FALSE) > 0
      THEN 'warning'
    WHEN COUNT(DISTINCT ps.id) FILTER (WHERE ps.status IN ('pending', 'notified')) > 0
      THEN 'attention'
    WHEN COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'confirmed') = COUNT(DISTINCT ps.id)
      AND COUNT(DISTINCT ps.id) > 0
      THEN 'ready'
    ELSE 'attention'
  END                                                              AS comms_health

FROM procedure_plans pp
LEFT JOIN procedure_stakeholders  ps ON ps.plan_id = pp.id
LEFT JOIN confirmation_requests   cr ON cr.plan_id = pp.id
LEFT JOIN escalation_events       ee ON ee.plan_id = pp.id
LEFT JOIN communication_threads   ct ON ct.plan_id = pp.id
WHERE pp.status NOT IN ('completed', 'cancelled', 'declined')
GROUP BY
  pp.id, pp.specialist_id, pp.patient_name, pp.procedure_name,
  pp.urgency, pp.status, pp.scheduled_date, pp.scheduled_time,
  pp.consent_status, pp.workup_complete;

COMMENT ON VIEW v_procedure_comms_pipeline IS
  'Per-plan communication pipeline summary — stakeholder counts, confirmation health, schedule bucket. Used by /communication pipeline dashboard.';

-- ── INDEX: speed up the pipeline query ───────────────────────────────────
-- procedure_stakeholders already has idx_stakeholders_plan
-- confirmation_requests already has idx_confirmations_plan
-- Add compound index for the view join pattern
CREATE INDEX IF NOT EXISTS idx_escalation_events_plan_resolved
  ON escalation_events(plan_id, resolved)
  WHERE resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_comm_threads_plan_unread
  ON communication_threads(plan_id)
  WHERE unread_count > 0;
