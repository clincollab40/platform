-- ═══════════════════════════════════════════════════════════════
-- ClinCollab — Migration 009
-- Module 9: Closed-Loop Procedural Communication
--
-- Scope:
-- 1. procedure_stakeholders      — every person who must be kept aligned
-- 2. communication_threads       — one thread per stakeholder per plan
-- 3. communication_events        — every message sent/received, immutable log
-- 4. confirmation_requests       — structured asks requiring a YES/NO/value response
-- 5. confirmation_responses      — what the stakeholder replied
-- 6. escalation_rules            — what to do when confirmation doesn't arrive
-- 7. escalation_events           — log of every escalation triggered
-- 8. communication_templates     — specialty-aware, procedure-aware message templates
-- 9. post_procedure_milestones   — clinical milestones from procedure to discharge
--
-- Architecture:
-- • Soft references to procedure_plans (UUID, no FK) for resilience
-- • M9 CAN fail without affecting M8 plan or any other module
-- • Inbound WhatsApp replies routed here by existing M4 webhook (extended)
-- • All outbound messages go through notification-bus (no direct WA calls)
-- • RLS enforced on all tables: specialist_id = auth.uid()
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE stakeholder_role AS ENUM (
    'patient',
    'patient_nok',           -- next of kin
    'anaesthesiologist',
    'ot_coordinator',
    'scrub_nurse',
    'perfusionist',
    'referring_doctor',
    'ward_nurse',
    'intensivist',           -- ICU doctor
    'physiotherapist',
    'specialist_self',       -- the procedure specialist themselves
    'other_clinician'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE stakeholder_status AS ENUM (
    'pending',          -- not yet contacted
    'notified',         -- message sent, awaiting confirmation
    'confirmed',        -- confirmed participation/understanding
    'declined',         -- declined or unavailable
    'non_responsive',   -- sent but no reply within SLA
    'replaced'          -- originally assigned, replaced by someone else
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE confirmation_type AS ENUM (
    'availability',         -- "Can you do this procedure on [date]?"
    'patient_preparation',  -- "Have you stopped your medication?"
    'pre_assessment_done',  -- "Has pre-anaesthetic assessment been done?"
    'equipment_confirmed',  -- "Is [equipment] confirmed and available?"
    'patient_arrived',      -- "Has the patient arrived?"
    'procedure_done',       -- "Procedure completed?"
    'patient_discharged',   -- "Patient discharge confirmed?"
    'adherence_check',      -- "Are you following the preparation instructions?"
    'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE confirmation_response_type AS ENUM (
    'yes', 'no', 'partial', 'pending', 'escalated', 'overridden'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE event_direction AS ENUM ('outbound', 'inbound', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE event_channel AS ENUM (
    'whatsapp', 'in_app', 'phone_call_logged', 'system_auto'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE escalation_action AS ENUM (
    'send_reminder',
    'notify_specialist',
    'notify_coordinator',
    'flag_for_review',
    'suggest_reschedule',
    'auto_reschedule',
    'cancel_procedure'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE milestone_status AS ENUM (
    'pending', 'reached', 'skipped', 'delayed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- TABLE: procedure_stakeholders
-- Every person/role that must be communicated for this plan
-- Pre-populated from the procedure protocol; specialist can add/edit
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS procedure_stakeholders (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL,           -- soft ref to procedure_plans
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  role              stakeholder_role NOT NULL,
  name              TEXT NOT NULL,
  mobile            TEXT,                    -- WhatsApp number for comms
  email             TEXT,
  designation       TEXT,                    -- "Cardiac Anaesthesiologist, Apollo"

  -- What this stakeholder must confirm
  confirmation_required  BOOLEAN NOT NULL DEFAULT TRUE,
  confirmations_needed   TEXT[],             -- list of confirmation_type strings

  -- Current status
  status            stakeholder_status NOT NULL DEFAULT 'pending',
  last_contacted_at TIMESTAMPTZ,
  confirmed_at      TIMESTAMPTZ,

  -- Notification preferences
  notify_on_schedule     BOOLEAN DEFAULT TRUE,   -- when procedure is scheduled
  notify_on_workup_done  BOOLEAN DEFAULT FALSE,  -- when all investigations complete
  notify_d_minus_3       BOOLEAN DEFAULT TRUE,   -- 3 days before
  notify_d_minus_1       BOOLEAN DEFAULT TRUE,   -- 1 day before
  notify_d_day           BOOLEAN DEFAULT TRUE,   -- morning of procedure
  notify_post_procedure  BOOLEAN DEFAULT FALSE,  -- procedure outcome
  notify_discharge       BOOLEAN DEFAULT FALSE,  -- patient discharged

  -- For referring doctor: which milestones they receive
  is_referring_doctor    BOOLEAN DEFAULT FALSE,
  referral_case_id       UUID,                   -- soft ref to M3 referral

  notes             TEXT,
  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stakeholders_plan        ON procedure_stakeholders(plan_id);
CREATE INDEX IF NOT EXISTS idx_stakeholders_specialist  ON procedure_stakeholders(specialist_id);
CREATE INDEX IF NOT EXISTS idx_stakeholders_mobile      ON procedure_stakeholders(mobile)
  WHERE mobile IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stakeholders_role        ON procedure_stakeholders(plan_id, role);
CREATE INDEX IF NOT EXISTS idx_stakeholders_pending     ON procedure_stakeholders(plan_id)
  WHERE status IN ('pending', 'notified', 'non_responsive');

-- ─────────────────────────────────────────────────────────────
-- TABLE: communication_threads
-- One thread per stakeholder per plan
-- Aggregates all events for that stakeholder
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS communication_threads (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL,           -- soft ref to procedure_plans
  stakeholder_id    UUID NOT NULL REFERENCES procedure_stakeholders(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  -- Thread state
  last_event_at     TIMESTAMPTZ,
  last_direction    event_direction,
  unread_count      INTEGER DEFAULT 0,       -- inbound messages not yet reviewed
  total_messages    INTEGER DEFAULT 0,

  -- Confirmation tracking
  pending_confirmations   TEXT[],            -- confirmation_types awaiting response
  completed_confirmations TEXT[],            -- confirmation_types done

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id, stakeholder_id)
);

CREATE INDEX IF NOT EXISTS idx_threads_plan        ON communication_threads(plan_id);
CREATE INDEX IF NOT EXISTS idx_threads_specialist  ON communication_threads(specialist_id);
CREATE INDEX IF NOT EXISTS idx_threads_stakeholder ON communication_threads(stakeholder_id);

-- ─────────────────────────────────────────────────────────────
-- TABLE: communication_events
-- Immutable log of every message — sent or received
-- Never deleted — full audit trail
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS communication_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id         UUID NOT NULL REFERENCES communication_threads(id) ON DELETE CASCADE,
  plan_id           UUID NOT NULL,           -- denormalised for fast querying
  stakeholder_id    UUID NOT NULL REFERENCES procedure_stakeholders(id),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  direction         event_direction NOT NULL,
  channel           event_channel NOT NULL DEFAULT 'whatsapp',

  -- Message content
  message_text      TEXT NOT NULL,
  message_type      TEXT DEFAULT 'text',     -- text, template, media
  whatsapp_msg_id   TEXT,                   -- Meta message ID for deduplication

  -- Confirmation linkage
  confirmation_request_id UUID,             -- which confirmation this relates to

  -- Auto-generated flag
  is_automated      BOOLEAN DEFAULT TRUE,
  sent_by_name      TEXT,                   -- if manually sent, who sent it

  -- Delivery tracking
  delivered         BOOLEAN DEFAULT FALSE,
  delivered_at      TIMESTAMPTZ,
  read              BOOLEAN DEFAULT FALSE,
  read_at           TIMESTAMPTZ,

  -- Inbound parsing
  parsed_intent     TEXT,                   -- 'confirm_yes', 'confirm_no', 'query', 'distress'
  parsed_value      TEXT,                   -- extracted value if numeric/date reply

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_thread      ON communication_events(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_plan        ON communication_events(plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_specialist  ON communication_events(specialist_id);
CREATE INDEX IF NOT EXISTS idx_events_whatsapp_id ON communication_events(whatsapp_msg_id)
  WHERE whatsapp_msg_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- TABLE: confirmation_requests
-- A structured ask sent to a stakeholder
-- Tracks: what was asked, when, what response was received
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS confirmation_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id         UUID NOT NULL REFERENCES communication_threads(id) ON DELETE CASCADE,
  plan_id           UUID NOT NULL,
  stakeholder_id    UUID NOT NULL REFERENCES procedure_stakeholders(id),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  confirmation_type confirmation_type NOT NULL,
  question_text     TEXT NOT NULL,           -- the exact question sent
  expected_response TEXT,                   -- e.g. 'YES or NO', 'Reply 1 for YES'

  -- SLA
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_required_by TIMESTAMPTZ,         -- deadline for response
  reminder_sent_at  TIMESTAMPTZ,
  escalated_at      TIMESTAMPTZ,

  -- Response
  response          confirmation_response_type,
  response_text     TEXT,                   -- raw reply from stakeholder
  responded_at      TIMESTAMPTZ,

  -- Outcome
  is_resolved       BOOLEAN DEFAULT FALSE,
  resolved_by       TEXT,                   -- 'stakeholder_reply', 'specialist_override', 'escalation'
  override_reason   TEXT,                   -- if specialist overrode

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_confirmations_thread     ON confirmation_requests(thread_id);
CREATE INDEX IF NOT EXISTS idx_confirmations_plan       ON confirmation_requests(plan_id);
CREATE INDEX IF NOT EXISTS idx_confirmations_pending    ON confirmation_requests(plan_id)
  WHERE is_resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_confirmations_overdue    ON confirmation_requests(response_required_by)
  WHERE is_resolved = FALSE AND response_required_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- TABLE: patient_adherence_log
-- Specific to patient preparation adherence tracking
-- Each check-in: what was asked, what the patient said, clinical action
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_adherence_log (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  stakeholder_id    UUID REFERENCES procedure_stakeholders(id),

  check_date        DATE NOT NULL,
  check_type        TEXT NOT NULL,           -- 'medication_hold', 'fasting', 'investigation', 'arrival'
  item_checked      TEXT NOT NULL,           -- e.g. "Warfarin stopped", "NPO from midnight"
  patient_response  TEXT,                   -- what patient replied
  is_adherent       BOOLEAN,
  non_adherence_detail TEXT,

  -- Clinical decision triggered
  clinical_action   TEXT,                   -- 'proceed', 'reschedule', 'cancel', 'specialist_review'
  actioned_by       UUID REFERENCES specialists(id),
  actioned_at       TIMESTAMPTZ,
  action_note       TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adherence_plan       ON patient_adherence_log(plan_id);
CREATE INDEX IF NOT EXISTS idx_adherence_specialist ON patient_adherence_log(specialist_id);
CREATE INDEX IF NOT EXISTS idx_adherence_date       ON patient_adherence_log(plan_id, check_date);

-- ─────────────────────────────────────────────────────────────
-- TABLE: escalation_rules
-- Per-plan escalation configuration
-- Pre-populated from protocol defaults, specialist customises
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escalation_rules (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  -- Trigger
  trigger_event     TEXT NOT NULL,           -- 'confirmation_not_received', 'patient_non_adherent', 'stakeholder_declined'
  trigger_role      stakeholder_role,        -- which stakeholder type triggers this
  trigger_hours_sla INTEGER NOT NULL DEFAULT 24,  -- hours before escalation fires

  -- Confirmation type this rule applies to
  confirmation_type_filter TEXT,

  -- Action
  action            escalation_action NOT NULL,
  action_target     stakeholder_role,        -- who to notify
  action_message_template TEXT,

  -- Meta
  is_active         BOOLEAN DEFAULT TRUE,
  priority          INTEGER DEFAULT 5,       -- 1=highest, 10=lowest
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalation_plan      ON escalation_rules(plan_id);
CREATE INDEX IF NOT EXISTS idx_escalation_specialist ON escalation_rules(specialist_id);

-- ─────────────────────────────────────────────────────────────
-- TABLE: escalation_events
-- Immutable log of every escalation that fired
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escalation_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id           UUID REFERENCES escalation_rules(id),
  plan_id           UUID NOT NULL,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  confirmation_request_id UUID REFERENCES confirmation_requests(id),

  trigger_event     TEXT NOT NULL,
  action_taken      escalation_action NOT NULL,
  action_detail     TEXT,
  notified_roles    TEXT[],
  specialist_notified BOOLEAN DEFAULT FALSE,
  coordinator_notified BOOLEAN DEFAULT FALSE,

  -- Resolution
  resolved          BOOLEAN DEFAULT FALSE,
  resolution        TEXT,                    -- 'rescheduled', 'cancelled', 'proceeded', 'stakeholder_replaced'
  resolved_by       UUID REFERENCES specialists(id),
  resolved_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalation_events_plan       ON escalation_events(plan_id);
CREATE INDEX IF NOT EXISTS idx_escalation_events_specialist ON escalation_events(specialist_id);
CREATE INDEX IF NOT EXISTS idx_escalation_events_unresolved ON escalation_events(plan_id)
  WHERE resolved = FALSE;

-- ─────────────────────────────────────────────────────────────
-- TABLE: post_procedure_milestones
-- Clinical milestones from end of procedure to discharge
-- Each milestone triggers stakeholder communications
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_procedure_milestones (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  milestone_name    TEXT NOT NULL,           -- 'procedure_completed', 'icu_to_ward', 'discharge'
  milestone_label   TEXT NOT NULL,           -- human-readable label
  sequence_order    INTEGER NOT NULL,        -- order in the post-procedure timeline

  -- Status
  status            milestone_status NOT NULL DEFAULT 'pending',
  reached_at        TIMESTAMPTZ,
  expected_at       TIMESTAMPTZ,             -- estimated time based on procedure type
  delay_reason      TEXT,

  -- Clinical data at this milestone
  clinical_notes    TEXT,
  vitals_summary    TEXT,
  medication_changes TEXT,

  -- Communication triggered
  notify_patient    BOOLEAN DEFAULT TRUE,
  notify_referring_doctor BOOLEAN DEFAULT FALSE,
  notify_nok        BOOLEAN DEFAULT FALSE,
  patient_message   TEXT,                   -- message sent to patient at this milestone
  referrer_message  TEXT,                   -- message sent to referring doctor

  -- Delivery tracking
  patient_notified_at   TIMESTAMPTZ,
  referrer_notified_at  TIMESTAMPTZ,
  nok_notified_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestones_plan      ON post_procedure_milestones(plan_id);
CREATE INDEX IF NOT EXISTS idx_milestones_specialist ON post_procedure_milestones(specialist_id);
CREATE INDEX IF NOT EXISTS idx_milestones_pending   ON post_procedure_milestones(plan_id)
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────
-- TABLE: communication_templates
-- Specialty-aware, procedure-aware, role-aware templates
-- Supports placeholder replacement
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS communication_templates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID REFERENCES specialists(id) ON DELETE CASCADE, -- NULL = global default
  specialty         TEXT,                   -- NULL = all specialties
  procedure_code    TEXT,                   -- NULL = all procedures

  -- Template identity
  name              TEXT NOT NULL,
  role              stakeholder_role NOT NULL,
  trigger_event     TEXT NOT NULL,           -- when this template fires
  confirmation_type confirmation_type,       -- if this asks for confirmation

  -- Content
  message_template  TEXT NOT NULL,          -- with [PLACEHOLDERS]
  expected_response_hint TEXT,              -- shown to stakeholder as instructions
  is_confirmation_request BOOLEAN DEFAULT FALSE,

  -- Metadata
  is_active         BOOLEAN DEFAULT TRUE,
  is_system_default BOOLEAN DEFAULT FALSE,  -- shipped with ClinCollab
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_templates_specialist ON communication_templates(specialist_id);
CREATE INDEX IF NOT EXISTS idx_comm_templates_role       ON communication_templates(role, trigger_event);
CREATE INDEX IF NOT EXISTS idx_comm_templates_specialty  ON communication_templates(specialty);

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: populate stakeholders from procedure resources
-- When a plan is scheduled, automatically create stakeholder records
-- from the procedure_resources table (anaesthesiologist, scrub nurse etc.)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION populate_stakeholders_for_plan(p_plan_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_specialist_id UUID;
  v_patient_name  TEXT;
  v_patient_mobile TEXT;
  v_referral_id   UUID;
  v_resource      RECORD;
  v_count         INTEGER := 0;
BEGIN
  SELECT specialist_id, patient_name, patient_mobile, referral_case_id
  INTO v_specialist_id, v_patient_name, v_patient_mobile, v_referral_id
  FROM procedure_plans WHERE id = p_plan_id;

  IF NOT FOUND THEN RETURN 0; END IF;

  -- Always add patient
  INSERT INTO procedure_stakeholders (
    plan_id, specialist_id, role, name, mobile,
    confirmation_required, confirmations_needed,
    notify_on_schedule, notify_d_minus_3, notify_d_minus_1, notify_d_day,
    notify_post_procedure, notify_discharge, sort_order
  ) VALUES (
    p_plan_id, v_specialist_id, 'patient', v_patient_name, v_patient_mobile,
    TRUE,
    ARRAY['availability','patient_preparation','adherence_check','patient_arrived'],
    TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, 0
  ) ON CONFLICT DO NOTHING;
  v_count := v_count + 1;

  -- Add referring doctor if referral exists
  IF v_referral_id IS NOT NULL THEN
    DECLARE
      v_referrer_name   TEXT;
      v_referrer_mobile TEXT;
    BEGIN
      SELECT
        COALESCE(rd.name, r.peer_name, 'Referring Doctor'),
        COALESCE(rc.poc_referrer_mobile, r.whatsapp_number)
      INTO v_referrer_name, v_referrer_mobile
      FROM referral_cases rc
      LEFT JOIN referrers r ON r.id = rc.referrer_id
      LEFT JOIN referring_doctors rd ON rd.id = rc.referring_doctor_id
      WHERE rc.id = v_referral_id;

      IF FOUND THEN
        INSERT INTO procedure_stakeholders (
          plan_id, specialist_id, role, name, mobile,
          confirmation_required, confirmations_needed,
          is_referring_doctor, referral_case_id,
          notify_on_schedule, notify_d_minus_1, notify_post_procedure, notify_discharge,
          sort_order
        ) VALUES (
          p_plan_id, v_specialist_id, 'referring_doctor',
          v_referrer_name, v_referrer_mobile,
          FALSE, -- no confirmation needed from referrer, just notification
          ARRAY[]::TEXT[],
          TRUE, v_referral_id,
          TRUE, FALSE, TRUE, TRUE, 99
        ) ON CONFLICT DO NOTHING;
        v_count := v_count + 1;
      END IF;
    END;
  END IF;

  -- Add anaesthesiologist from procedure_plans if named
  DECLARE
    v_anaes_name   TEXT;
    v_anaes_mobile TEXT;
  BEGIN
    SELECT anaesthesiologist_name, anaesthesiologist_mobile
    INTO v_anaes_name, v_anaes_mobile
    FROM procedure_plans WHERE id = p_plan_id;

    IF v_anaes_name IS NOT NULL THEN
      INSERT INTO procedure_stakeholders (
        plan_id, specialist_id, role, name, mobile,
        confirmation_required, confirmations_needed,
        notify_on_schedule, notify_d_minus_3, notify_d_minus_1, notify_d_day,
        sort_order
      ) VALUES (
        p_plan_id, v_specialist_id, 'anaesthesiologist',
        v_anaes_name, v_anaes_mobile,
        TRUE,
        ARRAY['availability','pre_assessment_done'],
        TRUE, TRUE, TRUE, TRUE, 1
      ) ON CONFLICT DO NOTHING;
      v_count := v_count + 1;
    END IF;
  END;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: get_overdue_confirmations
-- Returns all unresolved confirmation requests past their SLA
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_overdue_confirmations(p_specialist_id UUID)
RETURNS TABLE (
  request_id UUID, plan_id UUID, stakeholder_name TEXT,
  stakeholder_role TEXT, confirmation_type TEXT,
  hours_overdue NUMERIC, question_text TEXT
) AS $$
  SELECT
    cr.id, cr.plan_id, ps.name, ps.role::TEXT,
    cr.confirmation_type::TEXT,
    EXTRACT(EPOCH FROM (NOW() - cr.response_required_by)) / 3600 AS hours_overdue,
    cr.question_text
  FROM confirmation_requests cr
  JOIN procedure_stakeholders ps ON ps.id = cr.stakeholder_id
  WHERE cr.specialist_id = p_specialist_id
    AND cr.is_resolved = FALSE
    AND cr.response_required_by < NOW()
  ORDER BY cr.response_required_by ASC;
$$ LANGUAGE SQL SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: Trigger when procedure is scheduled
-- Auto-populates stakeholders and creates default escalation rules
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_procedure_scheduled()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger when status changes TO scheduled or later
  IF NEW.scheduled_date IS NOT NULL
     AND OLD.scheduled_date IS NULL
     AND NEW.status IN ('scheduled', 'workup_in_progress', 'workup_complete', 'ready_for_procedure')
  THEN
    -- Auto-populate stakeholders
    PERFORM populate_stakeholders_for_plan(NEW.id);

    -- Create default escalation rules
    INSERT INTO escalation_rules (
      plan_id, specialist_id, trigger_event, trigger_role,
      trigger_hours_sla, action, action_target, is_active, priority
    ) VALUES
    -- Patient doesn't confirm preparation by D-2: notify specialist
    (NEW.id, NEW.specialist_id, 'confirmation_not_received', 'patient', 48,
     'notify_specialist', 'specialist_self', TRUE, 1),
    -- Patient reports non-adherence: immediately flag for specialist review
    (NEW.id, NEW.specialist_id, 'patient_non_adherent', 'patient', 0,
     'notify_specialist', 'specialist_self', TRUE, 1),
    -- Anaesthesiologist hasn't confirmed by D-3: notify coordinator
    (NEW.id, NEW.specialist_id, 'confirmation_not_received', 'anaesthesiologist', 72,
     'notify_coordinator', 'ot_coordinator', TRUE, 2),
    -- Any critical resource unconfirmed by D-1: suggest reschedule
    (NEW.id, NEW.specialist_id, 'stakeholder_declined', 'anaesthesiologist', 0,
     'suggest_reschedule', 'specialist_self', TRUE, 1)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  CREATE TRIGGER procedure_scheduled_trigger
    AFTER UPDATE ON procedure_plans
    FOR EACH ROW EXECUTE FUNCTION on_procedure_scheduled();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TRIGGER stakeholders_updated_at
    BEFORE UPDATE ON procedure_stakeholders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER threads_updated_at
    BEFORE UPDATE ON communication_threads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER milestones_updated_at
    BEFORE UPDATE ON post_procedure_milestones
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Update thread counters when events are added
CREATE OR REPLACE FUNCTION update_thread_on_event()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE communication_threads SET
    last_event_at  = NEW.created_at,
    last_direction = NEW.direction,
    total_messages = total_messages + 1,
    unread_count   = CASE WHEN NEW.direction = 'inbound'
                       THEN unread_count + 1
                       ELSE unread_count END
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER event_updates_thread
    AFTER INSERT ON communication_events
    FOR EACH ROW EXECUTE FUNCTION update_thread_on_event();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────
ALTER TABLE procedure_stakeholders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_threads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmation_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_adherence_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_rules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_procedure_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY stakeholders_isolation ON procedure_stakeholders  FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY threads_isolation      ON communication_threads   FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY events_isolation       ON communication_events    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY confirm_isolation      ON confirmation_requests   FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY adherence_isolation    ON patient_adherence_log   FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY escalation_isolation   ON escalation_rules        FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY esc_events_isolation   ON escalation_events       FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY milestones_isolation   ON post_procedure_milestones FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Templates: specialist sees own + system defaults
DO $$ BEGIN
  CREATE POLICY templates_read ON communication_templates
    FOR SELECT USING (specialist_id = auth.uid() OR specialist_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY templates_write ON communication_templates
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- SEED: System default communication templates
-- Idempotent: only insert if no system defaults exist yet
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM communication_templates WHERE is_system_default = TRUE LIMIT 1) THEN
    INSERT INTO communication_templates
      (specialist_id, specialty, procedure_code, name, role, trigger_event,
       confirmation_type, message_template, expected_response_hint,
       is_confirmation_request, is_active, is_system_default)
    VALUES

    -- ── PATIENT TEMPLATES ─────────────────────────────────────
    (NULL, NULL, NULL, 'Procedure scheduled — patient notification', 'patient', 'procedure_scheduled',
     NULL,
     E'ClinCollab — Procedure scheduled\n\nDear [PATIENT_NAME],\n\nYour [PROCEDURE_NAME] with Dr. [SPECIALIST_NAME] has been scheduled for [PROCEDURE_DATE] at [PROCEDURE_TIME].\n\nAdmission: [ADMIT_DATE] at [ADMIT_TIME]\nLocation: [HOSPITAL_NAME]\n\nYou will receive detailed preparation instructions over the next few days. If you have any questions, contact [COORDINATOR_NAME] at [COORDINATOR_MOBILE].',
     NULL, FALSE, TRUE, TRUE),

    (NULL, NULL, NULL, 'Patient preparation confirmation D-3', 'patient', 'd_minus_3_prep_check',
     'patient_preparation',
     E'ClinCollab — Procedure preparation check\n\nDear [PATIENT_NAME],\n\nYour [PROCEDURE_NAME] is in 3 days — [PROCEDURE_DATE].\n\nPlease confirm you have done the following:\n\n[PREPARATION_CHECKLIST]\n\nReply:\n*1* — Yes, I have done everything\n*2* — I have not done some things\n*3* — I have a question\n\nDr. [SPECIALIST_NAME]',
     'Reply 1, 2, or 3', TRUE, TRUE, TRUE),

    (NULL, NULL, NULL, 'Patient fasting confirmation D-1', 'patient', 'd_minus_1_fasting',
     'adherence_check',
     E'ClinCollab — IMPORTANT: Procedure tomorrow\n\nDear [PATIENT_NAME],\n\nYour [PROCEDURE_NAME] is TOMORROW — [PROCEDURE_DATE] at [PROCEDURE_TIME].\n\n🔴 FASTING: Do not eat or drink anything after [FASTING_CUTOFF]. You may take your essential medications with a small sip of water only.\n\n📍 Arrive at: [HOSPITAL_LOCATION] by [ARRIVAL_TIME]\n\n📋 Bring: [WHAT_TO_BRING]\n\nReply *YES* to confirm you understand.\nReply *HELP* if you have any concerns.\n\nDr. [SPECIALIST_NAME]',
     'Reply YES to confirm', TRUE, TRUE, TRUE),

    (NULL, NULL, NULL, 'Patient morning-of check', 'patient', 'd_day_morning_check',
     'patient_arrived',
     E'ClinCollab — Procedure today\n\nDear [PATIENT_NAME],\n\nYour [PROCEDURE_NAME] is today at [PROCEDURE_TIME].\n\n✅ You should be fasting (no food or drink since [FASTING_CUTOFF])\n✅ You should be on your way to [HOSPITAL_NAME]\n✅ Bring your reports, ID, and a family member\n\nWhen you arrive at the hospital, please reply *ARRIVED* so we know you are here.\n\nIn an emergency, call 112 immediately.\n\nDr. [SPECIALIST_NAME]',
     'Reply ARRIVED when you reach the hospital', TRUE, TRUE, TRUE),

    (NULL, NULL, NULL, 'Post-procedure patient notification', 'patient', 'procedure_completed',
     NULL,
     E'ClinCollab — Procedure update\n\nDear [PATIENT_NOK_NAME] / [PATIENT_NAME],\n\nDr. [SPECIALIST_NAME] has completed the [PROCEDURE_NAME].\n\n[OUTCOME_SUMMARY]\n\n[PATIENT_NAME] is currently in [CURRENT_LOCATION] and is being monitored by our team.\n\nWe will send you updates at key milestones. For urgent queries, contact [WARD_NURSE_NAME] on [WARD_CONTACT].\n\nDr. [SPECIALIST_NAME]',
     NULL, FALSE, TRUE, TRUE),

    (NULL, NULL, NULL, 'Discharge notification to patient', 'patient', 'patient_discharged',
     NULL,
     E'ClinCollab — Discharge summary\n\nDear [PATIENT_NAME],\n\nYou are being discharged today from [HOSPITAL_NAME] following your [PROCEDURE_NAME] on [PROCEDURE_DATE].\n\n📋 YOUR DISCHARGE INSTRUCTIONS:\n\n[DISCHARGE_MEDICATIONS]\n\n[ACTIVITY_RESTRICTIONS]\n\n[WOUND_CARE]\n\n🔴 GO TO EMERGENCY IMMEDIATELY IF:\n[RED_FLAGS]\n\n📅 Follow-up appointment: [FOLLOWUP_DATE] with Dr. [SPECIALIST_NAME]\n\nIf you have questions call [CLINIC_CONTACT]\n\nDr. [SPECIALIST_NAME]',
     NULL, FALSE, TRUE, TRUE),

    -- ── ANAESTHESIOLOGIST TEMPLATES ───────────────────────────
    (NULL, NULL, NULL, 'Anaesthesiologist procedure notification', 'anaesthesiologist', 'procedure_scheduled',
     'availability',
     E'ClinCollab — Anaesthesia request\n\nDear Dr. [ANAES_NAME],\n\nDr. [SPECIALIST_NAME] requests your anaesthetic cover for:\n\nPatient: [PATIENT_NAME], [PATIENT_AGE] yrs, [PATIENT_GENDER]\nProcedure: [PROCEDURE_NAME]\nDate: [PROCEDURE_DATE] at [PROCEDURE_TIME]\nOT: [OT_ROOM]\nAnaesthesia type: [ANAESTHESIA_TYPE]\nEstimated duration: [DURATION] minutes\n\nKey co-morbidities: [COMORBIDITIES]\nASA grade: [ASA_GRADE]\nAllergies: [ALLERGIES]\n\nPre-op assessment status: [PREASSESSMENT_STATUS]\n\nReply *CONFIRMED* to accept.\nReply *UNAVAILABLE* if you cannot take this case.\nReply *QUERY* for clinical queries.',
     'Reply CONFIRMED, UNAVAILABLE, or QUERY', TRUE, TRUE, TRUE),

    (NULL, NULL, NULL, 'Anaesthesiologist D-1 reminder', 'anaesthesiologist', 'd_minus_1_reminder',
     NULL,
     E'ClinCollab — Procedure tomorrow reminder\n\nDr. [ANAES_NAME],\n\nReminder: [PATIENT_NAME] — [PROCEDURE_NAME]\nTomorrow: [PROCEDURE_DATE] at [PROCEDURE_TIME]\nOT: [OT_ROOM]\n\nPre-op assessment: [PREASSESSMENT_STATUS]\nPatient fasting confirmed: [FASTING_STATUS]\n\nContact Dr. [SPECIALIST_NAME] at [SPECIALIST_MOBILE] for any queries tonight.',
     NULL, FALSE, TRUE, TRUE),

    -- ── OT COORDINATOR TEMPLATES ──────────────────────────────
    (NULL, NULL, NULL, 'OT coordinator booking request', 'ot_coordinator', 'procedure_scheduled',
     'equipment_confirmed',
     E'ClinCollab — OT booking request\n\nDr. [SPECIALIST_NAME] — [PROCEDURE_NAME]\n\nPatient: [PATIENT_NAME], [PATIENT_AGE] yrs\nDate: [PROCEDURE_DATE]\nTime: [PROCEDURE_TIME]\nOT required: [OT_ROOM_TYPE]\nEstimated duration: [DURATION] min\nAnaesthesia: [ANAESTHESIA_TYPE]\nAnaesthesiologist: [ANAES_NAME]\n\nEquipment list:\n[EQUIPMENT_LIST]\n\nSpecial requirements:\n[SPECIAL_REQUIREMENTS]\n\nReply *BOOKED* to confirm OT booking.\nReply *CONFLICT* if there is a scheduling conflict.',
     'Reply BOOKED or CONFLICT', TRUE, TRUE, TRUE),

    -- ── REFERRING DOCTOR TEMPLATES ───────────────────────────
    (NULL, NULL, NULL, 'Referring doctor — procedure confirmed', 'referring_doctor', 'procedure_scheduled',
     NULL,
     E'ClinCollab — Procedure booked for your patient\n\nDear Dr. [REFERRER_NAME],\n\nRegarding your referral (Ref: [REFERRAL_NO]) for [PATIENT_NAME]:\n\n[PROCEDURE_NAME] has been scheduled for [PROCEDURE_DATE] at [HOSPITAL_NAME] under Dr. [SPECIALIST_NAME].\n\nYou will be informed when the procedure is completed and when the patient is discharged.\n\nDr. [SPECIALIST_NAME]',
     NULL, FALSE, TRUE, TRUE),

    (NULL, NULL, NULL, 'Referring doctor — procedure completed', 'referring_doctor', 'procedure_completed',
     NULL,
     E'ClinCollab — Procedure completed\n\nDear Dr. [REFERRER_NAME],\n\nRe: [PATIENT_NAME] (Ref: [REFERRAL_NO])\n\n[PROCEDURE_NAME] was completed today by Dr. [SPECIALIST_NAME].\n\nOutcome: [OUTCOME_SUMMARY]\n\n[POST_PROCEDURE_PLAN_SUMMARY]\n\nThe patient will be discharged in approximately [EXPECTED_LOS]. You will receive a discharge summary.\n\nDr. [SPECIALIST_NAME]',
     NULL, FALSE, TRUE, TRUE),

    (NULL, NULL, NULL, 'Referring doctor — patient discharged', 'referring_doctor', 'patient_discharged',
     NULL,
     E'ClinCollab — Discharge summary for your patient\n\nDear Dr. [REFERRER_NAME],\n\nRe: [PATIENT_NAME] (Ref: [REFERRAL_NO])\n\n[PATIENT_NAME] has been discharged from [HOSPITAL_NAME] following [PROCEDURE_NAME] on [PROCEDURE_DATE].\n\nDischarge summary:\n[DISCHARGE_SUMMARY]\n\nMedications changed:\n[MEDICATION_CHANGES]\n\nFollow-up: With Dr. [SPECIALIST_NAME] on [FOLLOWUP_DATE].\n\nThank you for your referral.\n\nDr. [SPECIALIST_NAME]',
     NULL, FALSE, TRUE, TRUE);

  END IF;
END $$;
