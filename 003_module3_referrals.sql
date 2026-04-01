-- ═══════════════════════════════════════════════════════
-- ClinCollab — Migration 003
-- Module 3: End-to-end Referral Workflow
-- FHIR R4 aligned · MCI compliant · RLS enforced
-- ═══════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────
CREATE TYPE referral_status AS ENUM (
  'draft', 'submitted', 'queried', 'info_provided',
  'accepted', 'patient_arrived', 'procedure_planned',
  'completed', 'closed', 'declined', 'cancelled'
);

CREATE TYPE urgency_level AS ENUM ('routine', 'urgent', 'emergency');

CREATE TYPE message_sender_type AS ENUM ('specialist', 'referring_doctor', 'system');

CREATE TYPE message_type AS ENUM ('text', 'document', 'clinical_update', 'system_event');

CREATE TYPE case_update_type AS ENUM (
  'patient_arrived', 'findings_shared', 'procedure_planned',
  'procedure_completed', 'discharged', 'follow_up_required',
  'general_update'
);

CREATE TYPE document_type AS ENUM (
  'prescription', 'lab_report', 'ecg', 'echo_report',
  'imaging', 'discharge_summary', 'referral_letter', 'other'
);

-- ─────────────────────────────────────────────
-- TABLE: referring_doctors
-- Independent identity — not tied to one specialist
-- Referring GPs use the platform without full signup
-- ─────────────────────────────────────────────
CREATE TABLE referring_doctors (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mobile          TEXT NOT NULL,
  mobile_hash     TEXT GENERATED ALWAYS AS (encode(digest(mobile, 'sha256'), 'hex')) STORED,
  name            TEXT,
  specialty       TEXT,
  city            TEXT,
  clinic_name     TEXT,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(mobile)
);

CREATE INDEX idx_referring_doctors_mobile_hash ON referring_doctors(mobile_hash);

-- ─────────────────────────────────────────────
-- TABLE: referral_tokens
-- Secure one-time tokens for referral form access
-- Specialist generates, sends to referring doctor via WhatsApp
-- ─────────────────────────────────────────────
CREATE TABLE referral_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  referrer_id     UUID REFERENCES referrers(id),
  token           TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  token_type      TEXT NOT NULL DEFAULT 'referral_form',
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  used_count      INTEGER NOT NULL DEFAULT 0,
  max_uses        INTEGER NOT NULL DEFAULT 100,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_referral_tokens_token ON referral_tokens(token);
CREATE INDEX idx_referral_tokens_specialist ON referral_tokens(specialist_id);

-- ─────────────────────────────────────────────
-- TABLE: referral_cases
-- Core referral entity — FHIR ServiceRequest aligned
-- ─────────────────────────────────────────────
CREATE TABLE referral_cases (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id         UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  referrer_id           UUID REFERENCES referrers(id),
  referring_doctor_id   UUID REFERENCES referring_doctors(id),

  -- Reference number (human readable)
  reference_no          TEXT NOT NULL UNIQUE
                        DEFAULT 'CC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-'
                          || UPPER(SUBSTRING(encode(gen_random_bytes(3), 'hex') FOR 6)),

  -- Patient demographics (FHIR Patient)
  patient_name          TEXT NOT NULL,
  patient_dob           DATE,
  patient_gender        TEXT,
  patient_mobile        TEXT,
  patient_abha_id       TEXT,

  -- Clinical summary (FHIR Composition)
  chief_complaint       TEXT NOT NULL,
  soap_notes            TEXT,
  procedure_recommended TEXT,
  urgency               urgency_level NOT NULL DEFAULT 'routine',
  status                referral_status NOT NULL DEFAULT 'submitted',

  -- Coordination
  expected_visit_date   DATE,
  actual_visit_date     DATE,
  poc_referrer_name     TEXT,
  poc_referrer_mobile   TEXT,
  poc_specialist_name   TEXT,
  poc_specialist_mobile TEXT,

  -- Specialist response
  decline_reason        TEXT,
  query_text            TEXT,
  ai_eligibility_note   TEXT,
  ai_eligibility_score  TEXT,

  -- Timestamps
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at           TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cases_specialist_id ON referral_cases(specialist_id);
CREATE INDEX idx_cases_referrer_id ON referral_cases(referrer_id);
CREATE INDEX idx_cases_referring_doctor_id ON referral_cases(referring_doctor_id);
CREATE INDEX idx_cases_status ON referral_cases(status);
CREATE INDEX idx_cases_urgency ON referral_cases(urgency);
CREATE INDEX idx_cases_submitted_at ON referral_cases(submitted_at DESC);
CREATE INDEX idx_cases_reference_no ON referral_cases(reference_no);

-- ─────────────────────────────────────────────
-- TABLE: referral_clinical_data
-- Detailed clinical data (FHIR Observation + DiagnosticReport)
-- Separated for performance and future FHIR export
-- ─────────────────────────────────────────────
CREATE TABLE referral_clinical_data (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id               UUID NOT NULL REFERENCES referral_cases(id) ON DELETE CASCADE,
  specialist_id         UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  -- Vitals (FHIR Observation)
  vitals                JSONB DEFAULT '{}',
  -- { bp_systolic, bp_diastolic, heart_rate, spo2, temperature, weight, height, rbs }

  -- Medications (FHIR MedicationStatement)
  medications           JSONB DEFAULT '[]',
  -- [{ name, dose, frequency, duration }]

  allergies             TEXT,
  comorbidities         TEXT,

  -- Test findings
  ecg_findings          TEXT,
  echo_findings         TEXT,
  lab_summary           TEXT,
  imaging_summary       TEXT,
  other_findings        TEXT,

  -- ICD-10 codes (for future ABDM integration)
  icd10_codes           TEXT[],

  -- Full FHIR bundle for interoperability (Phase 2)
  fhir_bundle           JSONB,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_id)
);

CREATE INDEX idx_clinical_data_case_id ON referral_clinical_data(case_id);
CREATE INDEX idx_clinical_data_specialist ON referral_clinical_data(specialist_id);

-- ─────────────────────────────────────────────
-- TABLE: referral_documents
-- Uploaded files — prescription, labs, ECG, etc.
-- Files stored in Supabase Storage, paths here
-- ─────────────────────────────────────────────
CREATE TABLE referral_documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id         UUID NOT NULL REFERENCES referral_cases(id) ON DELETE CASCADE,
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  file_type       document_type NOT NULL DEFAULT 'other',
  mime_type       TEXT NOT NULL,
  storage_path    TEXT NOT NULL,
  size_bytes      INTEGER,
  uploaded_by     TEXT NOT NULL DEFAULT 'referring_doctor',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_case_id ON referral_documents(case_id);
CREATE INDEX idx_documents_specialist_id ON referral_documents(specialist_id);

-- ─────────────────────────────────────────────
-- TABLE: case_messages
-- Bidirectional communication thread per case
-- ─────────────────────────────────────────────
CREATE TABLE case_messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id             UUID NOT NULL REFERENCES referral_cases(id) ON DELETE CASCADE,
  specialist_id       UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  sender_type         message_sender_type NOT NULL,
  sender_id           TEXT NOT NULL,
  message_type        message_type NOT NULL DEFAULT 'text',
  content             TEXT NOT NULL,
  document_id         UUID REFERENCES referral_documents(id),
  whatsapp_delivered  BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_message_id TEXT,
  read_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_case_id ON case_messages(case_id);
CREATE INDEX idx_messages_specialist_id ON case_messages(specialist_id);
CREATE INDEX idx_messages_created ON case_messages(created_at DESC);

-- ─────────────────────────────────────────────
-- TABLE: case_updates
-- Structured clinical updates (patient arrived, procedure done, etc.)
-- Each type has a defined JSONB schema
-- ─────────────────────────────────────────────
CREATE TABLE case_updates (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id             UUID NOT NULL REFERENCES referral_cases(id) ON DELETE CASCADE,
  specialist_id       UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  update_type         case_update_type NOT NULL,
  structured_data     JSONB DEFAULT '{}',
  -- patient_arrived: { actual_date, notes }
  -- findings_shared: { summary, next_steps }
  -- procedure_planned: { procedure_name, planned_date, anaesthesia_type }
  -- procedure_completed: { procedure_name, performed_date, outcome }
  -- discharged: { discharge_date, medications, follow_up_date, follow_up_notes }
  -- follow_up_required: { reason, date, instructions }
  whatsapp_delivered  BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_updates_case_id ON case_updates(case_id);
CREATE INDEX idx_updates_specialist_id ON case_updates(specialist_id);

-- ─────────────────────────────────────────────
-- FUNCTION: auto update case status from updates
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_case_status_from_update()
RETURNS TRIGGER AS $$
BEGIN
  CASE NEW.update_type
    WHEN 'patient_arrived'      THEN
      UPDATE referral_cases SET status = 'patient_arrived', updated_at = NOW()
      WHERE id = NEW.case_id;
    WHEN 'procedure_planned'    THEN
      UPDATE referral_cases SET status = 'procedure_planned', updated_at = NOW()
      WHERE id = NEW.case_id;
    WHEN 'procedure_completed'  THEN
      UPDATE referral_cases
      SET status = 'completed', completed_at = NOW(), updated_at = NOW()
      WHERE id = NEW.case_id;
    WHEN 'discharged'           THEN
      UPDATE referral_cases SET status = 'closed', updated_at = NOW()
      WHERE id = NEW.case_id;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER case_status_sync
  AFTER INSERT ON case_updates
  FOR EACH ROW EXECUTE FUNCTION sync_case_status_from_update();

-- ─────────────────────────────────────────────
-- FUNCTION: updated_at triggers
-- ─────────────────────────────────────────────
CREATE TRIGGER referral_cases_updated_at
  BEFORE UPDATE ON referral_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER clinical_data_updated_at
  BEFORE UPDATE ON referral_clinical_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER referring_doctors_updated_at
  BEFORE UPDATE ON referring_doctors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────
-- VIEWS: analytics
-- ─────────────────────────────────────────────
CREATE VIEW v_referral_analytics AS
SELECT
  rc.specialist_id,
  COUNT(*)                                                          AS total_cases,
  COUNT(*) FILTER (WHERE rc.status NOT IN ('declined','cancelled')) AS accepted_cases,
  COUNT(*) FILTER (WHERE rc.status IN ('completed','closed'))       AS completed_cases,
  COUNT(*) FILTER (WHERE rc.submitted_at >= NOW() - INTERVAL '30 days') AS cases_this_month,
  COUNT(*) FILTER (WHERE rc.submitted_at >= NOW() - INTERVAL '60 days'
                     AND rc.submitted_at < NOW() - INTERVAL '30 days') AS cases_last_month,
  AVG(
    CASE WHEN rc.accepted_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM rc.accepted_at - rc.submitted_at)/3600
    END
  )::NUMERIC(10,1)                                                  AS avg_hours_to_accept,
  COUNT(DISTINCT rc.referring_doctor_id)                            AS unique_referrers
FROM referral_cases rc
GROUP BY rc.specialist_id;

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE referral_cases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_clinical_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_updates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_tokens        ENABLE ROW LEVEL SECURITY;

-- referral_cases: specialist sees only their cases
CREATE POLICY cases_specialist_isolation ON referral_cases
  FOR ALL USING (specialist_id = auth.uid());

-- clinical data: specialist sees only their cases
CREATE POLICY clinical_data_isolation ON referral_clinical_data
  FOR ALL USING (specialist_id = auth.uid());

-- documents: specialist sees only their cases
CREATE POLICY documents_isolation ON referral_documents
  FOR ALL USING (specialist_id = auth.uid());

-- messages: specialist sees only their case threads
CREATE POLICY messages_isolation ON case_messages
  FOR ALL USING (specialist_id = auth.uid());

-- updates: specialist sees only their case updates
CREATE POLICY updates_isolation ON case_updates
  FOR ALL USING (specialist_id = auth.uid());

-- tokens: specialist manages their own tokens
CREATE POLICY tokens_isolation ON referral_tokens
  FOR ALL USING (specialist_id = auth.uid());

-- Service role bypass for server-side referral form submission
-- (referring doctors submit without auth.uid — server action uses service role)
