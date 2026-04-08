-- ════════════════════════════════════════════════════════════════════════════
-- Migration 013 — Referrer WhatsApp Intake
--
-- Enables referring doctors to share patient details via WhatsApp
-- without opening any app. Specialist configures minimum required fields.
--
-- Tables added:
--   referrer_intake_configs   — per-specialist config for required intake fields
--   referrer_whatsapp_sessions — conversational state for each referring doctor
-- ════════════════════════════════════════════════════════════════════════════

-- ── TABLE: referrer_intake_configs ────────────────────────────────────────
-- Specialist configures which fields are required when a referring doctor
-- shares a patient via WhatsApp
CREATE TABLE IF NOT EXISTS referrer_intake_configs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id         UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  -- Toggle required fields (all default to required)
  require_patient_name     BOOLEAN NOT NULL DEFAULT TRUE,
  require_patient_mobile   BOOLEAN NOT NULL DEFAULT TRUE,
  require_patient_dob      BOOLEAN NOT NULL DEFAULT FALSE,
  require_patient_gender   BOOLEAN NOT NULL DEFAULT TRUE,
  require_chief_complaint  BOOLEAN NOT NULL DEFAULT TRUE,
  require_soap_notes       BOOLEAN NOT NULL DEFAULT FALSE,
  require_vitals_bp        BOOLEAN NOT NULL DEFAULT FALSE,
  require_vitals_hr        BOOLEAN NOT NULL DEFAULT FALSE,
  require_vitals_spo2      BOOLEAN NOT NULL DEFAULT FALSE,
  require_vitals_weight    BOOLEAN NOT NULL DEFAULT FALSE,
  require_ecg_findings     BOOLEAN NOT NULL DEFAULT FALSE,
  require_lab_summary      BOOLEAN NOT NULL DEFAULT FALSE,
  require_medications      BOOLEAN NOT NULL DEFAULT FALSE,
  require_allergies        BOOLEAN NOT NULL DEFAULT FALSE,
  require_comorbidities    BOOLEAN NOT NULL DEFAULT FALSE,
  require_document_upload  BOOLEAN NOT NULL DEFAULT FALSE,

  -- Urgency field — always collected
  require_urgency          BOOLEAN NOT NULL DEFAULT TRUE,

  -- Procedure recommended
  require_procedure        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Custom welcome message to referring doctors
  welcome_message          TEXT DEFAULT 'Hello Doctor! Please share your patient details. I will guide you step by step.',
  completion_message       TEXT DEFAULT 'Thank you! Patient case created. We will confirm acceptance shortly.',

  -- Alert specialist when new referral arrives via WhatsApp
  notify_on_new_referral   BOOLEAN NOT NULL DEFAULT TRUE,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(specialist_id)
);

CREATE INDEX IF NOT EXISTS idx_intake_configs_specialist ON referrer_intake_configs(specialist_id);

COMMENT ON TABLE referrer_intake_configs IS 'Per-specialist configuration for WhatsApp referral intake — which fields are required from referring doctors';

-- ── TABLE: referrer_whatsapp_sessions ─────────────────────────────────────
-- Tracks the conversational state of each referring doctor intake flow
-- One active session per (specialist_id, referring_doctor_mobile) pair
CREATE TABLE IF NOT EXISTS referrer_whatsapp_sessions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id         UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  -- Referring doctor WhatsApp identity
  referring_mobile      TEXT NOT NULL,
  referring_name        TEXT,

  -- State machine
  -- Steps: welcome | patient_name | patient_mobile | patient_dob | patient_gender
  --        | chief_complaint | soap_notes | urgency | procedure | vitals
  --        | ecg | lab | medications | allergies | comorbidities | documents
  --        | confirm | complete
  current_step          TEXT NOT NULL DEFAULT 'welcome',

  -- Accumulated data (built up as referring doctor answers)
  collected_data        JSONB NOT NULL DEFAULT '{}',
  -- Structure:
  -- {
  --   patient_name, patient_mobile, patient_dob, patient_gender,
  --   chief_complaint, soap_notes, urgency, procedure_recommended,
  --   vitals: { bp_systolic, bp_diastolic, heart_rate, spo2, weight },
  --   ecg_findings, lab_summary, medications, allergies, comorbidities,
  --   documents_count
  -- }

  -- Created case (set once complete)
  referral_case_id      UUID REFERENCES referral_cases(id),

  -- Session control
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  last_message_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_count         INTEGER NOT NULL DEFAULT 0,
  completed_at          TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrer_wa_sessions_specialist ON referrer_whatsapp_sessions(specialist_id);
CREATE INDEX IF NOT EXISTS idx_referrer_wa_sessions_mobile ON referrer_whatsapp_sessions(specialist_id, referring_mobile, is_active);
CREATE INDEX IF NOT EXISTS idx_referrer_wa_sessions_active ON referrer_whatsapp_sessions(specialist_id, is_active, last_message_at DESC);

COMMENT ON TABLE referrer_whatsapp_sessions IS 'WhatsApp conversational intake sessions for referring doctors — tracks step-by-step data collection state';
COMMENT ON COLUMN referrer_whatsapp_sessions.current_step IS 'Which field the system is currently collecting from the referring doctor';
COMMENT ON COLUMN referrer_whatsapp_sessions.collected_data IS 'JSONB accumulating all patient data as referring doctor provides answers';

-- ── Trigger: updated_at ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TRIGGER referrer_intake_configs_updated_at
    BEFORE UPDATE ON referrer_intake_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER referrer_wa_sessions_updated_at
    BEFORE UPDATE ON referrer_whatsapp_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE referrer_intake_configs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrer_whatsapp_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY intake_configs_isolation ON referrer_intake_configs
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY referrer_sessions_isolation ON referrer_whatsapp_sessions
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Function: upsert default intake config for a specialist ───────────────
CREATE OR REPLACE FUNCTION ensure_referrer_intake_config(p_specialist_id UUID)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO referrer_intake_configs (specialist_id)
  VALUES (p_specialist_id)
  ON CONFLICT (specialist_id) DO NOTHING;

  SELECT id INTO v_id FROM referrer_intake_configs WHERE specialist_id = p_specialist_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
