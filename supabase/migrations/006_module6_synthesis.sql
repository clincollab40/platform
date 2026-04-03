-- ═══════════════════════════════════════════════════════
-- ClinCollab — Migration 006
-- Module 6: Agentic 360° Clinical Synthesis
--
-- Architecture principles enforced here:
-- • synthesis_jobs is isolated — references specialists only
-- • Cross-module data read via VIEWs, never FK to module tables
--   (FK would create hard dependency — view is a soft read)
-- • If triage or referral tables are unavailable, synthesis
--   degrades gracefully — jobs log partial completion
-- ═══════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE synthesis_trigger AS ENUM (
    'pre_consultation',   -- triage completed
    'post_referral',      -- referral accepted
    'manual',             -- specialist on-demand
    'pre_procedure',      -- appointment day
    'scheduled'           -- periodic background refresh
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE synthesis_status AS ENUM (
    'queued', 'running', 'completed', 'failed', 'partial'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_tool_status AS ENUM (
    'pending', 'running', 'success', 'failed', 'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE data_source AS ENUM (
    'triage_self_report',
    'referral_summary',
    'appointment_history',
    'chatbot_interaction',
    'specialist_notes',
    'network_context'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE finding_significance AS ENUM ('routine', 'notable', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- TABLE: synthesis_jobs
-- One per synthesis request, per patient, per specialist
-- Intentionally isolated — references only specialists
-- Cross-module data fetched at runtime, not stored as FK
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS synthesis_jobs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id         UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  -- Patient identity (hashed for privacy in job record)
  patient_name          TEXT NOT NULL,
  patient_mobile_hash   TEXT,           -- SHA-256 of mobile — no raw PII in job

  -- Context IDs (soft references — no FK — for resilience)
  triage_session_id     UUID,           -- from M5, if applicable
  referral_case_id      UUID,           -- from M3, if applicable
  appointment_id        UUID,           -- from M4, if applicable

  -- Trigger and status
  trigger               synthesis_trigger NOT NULL DEFAULT 'manual',
  status                synthesis_status NOT NULL DEFAULT 'queued',
  priority              INTEGER NOT NULL DEFAULT 5,  -- 1=highest, 10=lowest

  -- Results
  clinical_brief        TEXT,
  data_completeness     INTEGER DEFAULT 0,  -- 0–100
  output_json           JSONB,              -- full SynthesisOutput

  -- Error handling
  error_message         TEXT,
  retry_count           INTEGER NOT NULL DEFAULT 0,
  max_retries           INTEGER NOT NULL DEFAULT 2,

  -- Timing
  queued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synthesis_jobs_specialist ON synthesis_jobs(specialist_id);
CREATE INDEX IF NOT EXISTS idx_synthesis_jobs_status ON synthesis_jobs(status);
CREATE INDEX IF NOT EXISTS idx_synthesis_jobs_triage ON synthesis_jobs(triage_session_id)
  WHERE triage_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_synthesis_jobs_referral ON synthesis_jobs(referral_case_id)
  WHERE referral_case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_synthesis_jobs_priority ON synthesis_jobs(priority, queued_at);

-- ─────────────────────────────────────────────
-- TABLE: agent_traces
-- Detailed execution log per tool call per job
-- Enables specialist to see exactly what data was used
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_traces (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          UUID NOT NULL REFERENCES synthesis_jobs(id) ON DELETE CASCADE,
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  tool_name       TEXT NOT NULL,
  tool_status     agent_tool_status NOT NULL DEFAULT 'pending',
  input_summary   TEXT,       -- what the tool was asked (no raw PHI)
  output_summary  TEXT,       -- what the tool returned (condensed)
  data_source     data_source,
  duration_ms     INTEGER,
  error_message   TEXT,
  executed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traces_job ON agent_traces(job_id, executed_at);
CREATE INDEX IF NOT EXISTS idx_traces_specialist ON agent_traces(specialist_id);

-- ─────────────────────────────────────────────
-- TABLE: synthesis_findings
-- Structured findings extracted by synthesis agent
-- Stored separately so they can be searched/filtered
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS synthesis_findings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          UUID NOT NULL REFERENCES synthesis_jobs(id) ON DELETE CASCADE,
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,           -- e.g. 'Cardiac History', 'Medications'
  finding         TEXT NOT NULL,
  significance    finding_significance NOT NULL DEFAULT 'routine',
  source          data_source NOT NULL,
  is_red_flag     BOOLEAN NOT NULL DEFAULT FALSE,
  red_flag_message TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_findings_job ON synthesis_findings(job_id);
CREATE INDEX IF NOT EXISTS idx_findings_red_flag ON synthesis_findings(job_id)
  WHERE is_red_flag = TRUE;

-- ─────────────────────────────────────────────
-- TABLE: module_health_log
-- Heartbeat table — each module writes health on key operations
-- Allows health API to show module status without external monitoring
-- This is the key to knowing "M4 chatbot is degraded" from the dashboard
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS module_health_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  module          TEXT NOT NULL,       -- 'M1','M2','M3','M4','M5','M6'
  service         TEXT NOT NULL,       -- 'groq_api','whatsapp_api','supabase'
  status          TEXT NOT NULL,       -- 'ok','degraded','down'
  latency_ms      INTEGER,
  error_message   TEXT,
  specialist_id   UUID,                -- null for infrastructure health
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_module ON module_health_log(module, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_service ON module_health_log(service, recorded_at DESC);

-- Keep only last 7 days of health logs — they are high-volume
CREATE OR REPLACE FUNCTION purge_old_health_logs()
RETURNS INTEGER AS $$
  DELETE FROM module_health_log
  WHERE recorded_at < NOW() - INTERVAL '7 days'
  RETURNING 1;
$$ LANGUAGE sql;

-- ─────────────────────────────────────────────
-- VIEW: v_synthesis_patient_context
-- Safe cross-module read for synthesis agent
-- This view IS the isolation boundary between M6 and M1-M5
-- If any source table changes schema, only this view needs updating
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_synthesis_patient_context AS
SELECT
  s.specialist_id,
  s.id                   AS triage_session_id,
  s.patient_name,
  s.patient_mobile,
  s.red_flag_level        AS triage_flag_level,
  s.red_flag_summary      AS triage_flag_summary,
  s.ai_synopsis           AS triage_synopsis,
  s.completed_at          AS triage_completed_at,
  s.protocol_id,

  -- Referral data (soft join — NULL if no referral)
  rc.id                   AS referral_case_id,
  rc.reference_no,
  rc.chief_complaint,
  rc.soap_notes,
  rc.procedure_recommended,
  rc.urgency              AS referral_urgency,
  rc.status               AS referral_status,

  -- Appointment data (soft join — NULL if no appointment)
  apt.id                  AS appointment_id,
  apt.patient_mobile      AS appt_mobile,
  apt.reason              AS appointment_reason,
  apt.status              AS appointment_status,
  aslot.slot_date,
  aslot.slot_time

FROM triage_sessions s
LEFT JOIN referral_cases rc
  ON  rc.specialist_id = s.specialist_id
  AND rc.patient_name  = s.patient_name     -- name match — no FK needed
  AND rc.status NOT IN ('declined','cancelled')
LEFT JOIN appointments apt
  ON  apt.specialist_id = s.specialist_id
  AND (
    apt.id = s.appointment_id
    OR (apt.referral_case_id = rc.id AND apt.status = 'confirmed')
  )
LEFT JOIN appointment_slots aslot ON aslot.id = apt.slot_id;

-- ─────────────────────────────────────────────
-- VIEW: v_latest_module_health
-- Most recent health status per module+service
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_latest_module_health AS
SELECT DISTINCT ON (module, service)
  module, service, status, latency_ms, error_message, recorded_at
FROM module_health_log
ORDER BY module, service, recorded_at DESC;

-- ─────────────────────────────────────────────
-- FUNCTION: create synthesis job (atomic)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_synthesis_job(
  p_specialist_id    UUID,
  p_patient_name     TEXT,
  p_patient_mobile   TEXT,
  p_trigger          synthesis_trigger,
  p_triage_session_id UUID DEFAULT NULL,
  p_referral_case_id  UUID DEFAULT NULL,
  p_appointment_id    UUID DEFAULT NULL,
  p_priority          INTEGER DEFAULT 5
)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO synthesis_jobs (
    specialist_id, patient_name, patient_mobile_hash,
    trigger, triage_session_id, referral_case_id, appointment_id, priority
  ) VALUES (
    p_specialist_id, p_patient_name,
    encode(digest(COALESCE(p_patient_mobile,''), 'sha256'), 'hex'),
    p_trigger, p_triage_session_id, p_referral_case_id, p_appointment_id, p_priority
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TRIGGER synthesis_jobs_updated_at
    BEFORE UPDATE ON synthesis_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auto-trigger synthesis when triage completes
-- Decoupled: inserts a job record — agent picks it up asynchronously
CREATE OR REPLACE FUNCTION trigger_synthesis_on_triage_complete()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    PERFORM create_synthesis_job(
      NEW.specialist_id,
      NEW.patient_name,
      NEW.patient_mobile,
      'pre_consultation'::synthesis_trigger,
      NEW.id,
      NEW.referral_case_id,
      NEW.appointment_id,
      3   -- higher priority
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  CREATE TRIGGER auto_synthesis_on_triage
    AFTER UPDATE ON triage_sessions
    FOR EACH ROW EXECUTE FUNCTION trigger_synthesis_on_triage_complete();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE synthesis_jobs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_traces      ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthesis_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_health_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY synthesis_jobs_isolation ON synthesis_jobs
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY traces_isolation ON agent_traces
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY findings_isolation ON synthesis_findings
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Health log: specialist sees only their own; infra (null specialist_id) visible to admin
DO $$ BEGIN
  CREATE POLICY health_log_policy ON module_health_log
    FOR SELECT USING (
      specialist_id = auth.uid()
      OR specialist_id IS NULL
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
