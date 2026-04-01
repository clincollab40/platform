-- ═══════════════════════════════════════════════════════════════
-- ClinCollab — Migration 008
-- Module 8: Procedure Planner
--
-- End-to-end procedure coordination from decision to discharge:
-- 1. Procedure protocol templates (specialist-customisable per procedure)
-- 2. Patient procedure plans (one per patient per procedure)
-- 3. Resource booking (OT, anaesthesia, consumables, support team)
-- 4. Pre-procedure workup tracking (investigations, medication holds)
-- 5. Patient care plan (WhatsApp-delivered instructions)
-- 6. Consent documentation
-- 7. Day-of checklist
-- 8. Post-procedure care plan
--
-- Architecture:
-- • procedure_protocols  — soft references to specialists only
-- • procedure_plans      — references specialists only (no FK to other modules)
-- • All cross-module links (referral, appointment, triage) are soft UUIDs
-- • RLS on all tables: specialist_id = auth.uid()
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────
CREATE TYPE procedure_plan_status AS ENUM (
  'counselling',       -- specialist explaining to patient
  'patient_deciding',  -- patient requested time to decide
  'declined',          -- patient declined
  'scheduled',         -- date and slot confirmed
  'workup_in_progress',-- investigations being done
  'workup_complete',   -- all investigations done and reviewed
  'ready_for_procedure',-- all checks passed
  'in_progress',       -- procedure happening now
  'completed',         -- procedure done
  'cancelled',         -- cancelled after scheduling
  'postponed'          -- postponed, new date TBD
);

CREATE TYPE resource_type AS ENUM (
  'ot_room',
  'anaesthesiologist',
  'consumable',        -- stent, valve, graft, implant
  'instrument_set',    -- specific instrument tray
  'support_clinician', -- perfusionist, scrub nurse, neuro-navigation tech
  'blood_products',    -- crossmatch, packed cells, FFP
  'icu_bed',
  'equipment',         -- c-arm, microscope, cell saver, echo machine
  'medication',        -- pre-procedure drug (contrast, antibiotic prophylaxis)
  'other'
);

CREATE TYPE resource_status AS ENUM (
  'required', 'requested', 'confirmed', 'unavailable', 'not_needed'
);

CREATE TYPE workup_status AS ENUM (
  'not_ordered', 'ordered', 'done_pending_review', 'reviewed_normal',
  'reviewed_abnormal', 'reviewed_acceptable', 'waived'
);

CREATE TYPE consent_status AS ENUM (
  'not_started', 'explained', 'questions_answered', 'signed', 'refused'
);

CREATE TYPE alert_stage AS ENUM (
  'd_minus_7',   -- one week before
  'd_minus_3',   -- three days before
  'd_minus_1',   -- day before
  'd_day_morning',-- morning of procedure
  'post_procedure_24h',
  'post_procedure_72h',
  'post_procedure_7d',
  'custom'
);

-- ─────────────────────────────────────────────────────────────
-- TABLE: procedure_protocols
-- Template per procedure per specialist — defines what is always
-- needed for this type of procedure. The specialist builds this
-- once; it pre-populates every patient plan for that procedure.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE procedure_protocols (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  procedure_name    TEXT NOT NULL,         -- e.g. 'Coronary Angioplasty (PCI)'
  procedure_code    TEXT,                  -- e.g. 'PCI', 'CABG', 'CRANI', 'TKR'
  specialty_context TEXT NOT NULL,         -- 'interventional_cardiology' etc.
  description       TEXT,

  -- OT requirements
  ot_room_type      TEXT,                  -- 'cath_lab', 'main_ot', 'neuro_ot', 'hybrid'
  estimated_duration_mins INTEGER,         -- expected procedure time
  anaesthesia_type  TEXT,                  -- 'ga', 'local', 'sedation', 'spinal', 'epidural'
  positioning       TEXT,                  -- 'supine', 'prone', 'lateral', 'sitting'
  radiation_used    BOOLEAN DEFAULT FALSE,

  -- Standard workup investigations — JSONB array
  -- Each: { id, name, mandatory, timing, abnormal_action, category }
  workup_items      JSONB NOT NULL DEFAULT '[]',

  -- Standard medication holds — JSONB array
  -- Each: { drug_name, drug_class, hold_days_before, resume_when, reason }
  medication_holds  JSONB NOT NULL DEFAULT '[]',

  -- Standard resource requirements — JSONB array
  -- Each: { type, name, quantity, notes, mandatory }
  standard_resources JSONB NOT NULL DEFAULT '[]',

  -- Patient preparation instructions — JSONB array
  -- Each: { timing, instruction, category: 'fasting'|'medication'|'hygiene'|'logistics' }
  prep_instructions JSONB NOT NULL DEFAULT '[]',

  -- Alert cascade — what messages go out at each stage
  -- Each: { stage, message_template, channel: 'whatsapp'|'both' }
  alert_templates   JSONB NOT NULL DEFAULT '[]',

  -- Post-procedure care plan template
  -- Each section: { id, title, content_template, timing }
  post_procedure_plan JSONB NOT NULL DEFAULT '[]',

  -- Consent items — topics to cover in the consent discussion
  -- Each: { id, topic, detail, risk_category: 'common'|'serious'|'rare' }
  consent_items     JSONB NOT NULL DEFAULT '[]',

  -- WHO surgical safety checklist items (customised per procedure)
  checklist_items   JSONB NOT NULL DEFAULT '[]',

  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_protocols_specialist ON procedure_protocols(specialist_id);
CREATE INDEX idx_protocols_specialty  ON procedure_protocols(specialty_context);
CREATE INDEX idx_protocols_active     ON procedure_protocols(specialist_id, is_active);

-- ─────────────────────────────────────────────────────────────
-- TABLE: procedure_plans
-- One per patient per scheduled procedure
-- Populated from the protocol + patient-specific customisation
-- ─────────────────────────────────────────────────────────────
CREATE TABLE procedure_plans (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  protocol_id       UUID REFERENCES procedure_protocols(id),

  -- Soft references to other modules (no FK — resilience)
  referral_case_id  UUID,   -- M3: which referral led to this
  appointment_id    UUID,   -- M4: which appointment this was decided in
  triage_session_id UUID,   -- M5: patient's triage data
  synthesis_job_id  UUID,   -- M6: pre-consultation brief used

  -- Patient identity
  patient_name      TEXT NOT NULL,
  patient_mobile    TEXT,
  patient_age       INTEGER,
  patient_gender    TEXT,
  patient_weight_kg NUMERIC(5,1),
  patient_height_cm NUMERIC(5,1),
  blood_group       TEXT,

  -- Procedure details
  procedure_name    TEXT NOT NULL,
  procedure_code    TEXT,
  indication        TEXT NOT NULL,  -- clinical reason this procedure is needed
  urgency           TEXT NOT NULL DEFAULT 'elective',  -- 'elective', 'urgent', 'emergency'
  laterality        TEXT,           -- 'left', 'right', 'bilateral', 'midline', 'not_applicable'

  -- Scheduling
  status            procedure_plan_status NOT NULL DEFAULT 'counselling',
  scheduled_date    DATE,
  scheduled_time    TIME,
  admit_date        DATE,           -- may differ from procedure date for major surgeries
  estimated_los_days INTEGER,       -- length of stay
  discharge_criteria TEXT,          -- what needs to be true before discharge

  -- OT requirements (may differ from protocol defaults for this patient)
  ot_room_type      TEXT,
  ot_room_number    TEXT,           -- specific room if known
  estimated_duration_mins INTEGER,
  anaesthesia_type  TEXT,
  anaesthesiologist_name TEXT,
  anaesthesiologist_mobile TEXT,

  -- Consent
  consent_status    consent_status NOT NULL DEFAULT 'not_started',
  consent_signed_at TIMESTAMPTZ,
  consent_witness   TEXT,
  consent_notes     TEXT,

  -- Risk stratification
  asa_grade         INTEGER,        -- ASA physical status 1-5
  surgical_risk_pct NUMERIC(4,1),   -- stated surgical risk %
  risk_discussion_documented BOOLEAN DEFAULT FALSE,

  -- Clinical context
  comorbidities     TEXT[],
  allergies         TEXT,           -- critical for contrast, antibiotics, latex
  current_medications TEXT,
  special_instructions TEXT,

  -- Progress tracking
  workup_complete   BOOLEAN DEFAULT FALSE,
  resources_confirmed BOOLEAN DEFAULT FALSE,
  patient_ready     BOOLEAN DEFAULT FALSE,
  checklist_completed_at TIMESTAMPTZ,

  -- Outcome
  outcome           TEXT,           -- 'successful', 'complicated', 'abandoned', 'converted'
  outcome_notes     TEXT,
  actual_duration_mins INTEGER,
  completed_at      TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plans_specialist ON procedure_plans(specialist_id);
CREATE INDEX idx_plans_status     ON procedure_plans(specialist_id, status);
CREATE INDEX idx_plans_date       ON procedure_plans(specialist_id, scheduled_date);
CREATE INDEX idx_plans_referral   ON procedure_plans(referral_case_id) WHERE referral_case_id IS NOT NULL;
CREATE INDEX idx_plans_patient    ON procedure_plans(specialist_id, patient_name);

-- ─────────────────────────────────────────────────────────────
-- TABLE: procedure_resources
-- Every resource required for this specific patient's procedure
-- Pre-populated from protocol, then specialist confirms/modifies
-- ─────────────────────────────────────────────────────────────
CREATE TABLE procedure_resources (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL REFERENCES procedure_plans(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  resource_type     resource_type NOT NULL,
  name              TEXT NOT NULL,       -- e.g. 'Cath Lab 1', 'Drug-eluting stent 3.0x28mm'
  quantity          INTEGER DEFAULT 1,
  specification     TEXT,                -- brand, size, catalogue number
  status            resource_status NOT NULL DEFAULT 'required',
  confirmed_by      TEXT,               -- who confirmed availability
  confirmed_at      TIMESTAMPTZ,
  notes             TEXT,
  mandatory         BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resources_plan       ON procedure_resources(plan_id);
CREATE INDEX idx_resources_specialist ON procedure_resources(specialist_id);
CREATE INDEX idx_resources_type       ON procedure_resources(plan_id, resource_type);

-- ─────────────────────────────────────────────────────────────
-- TABLE: procedure_workup
-- Pre-procedure investigations — track each investigation
-- ordered, received, reviewed, and action taken on abnormals
-- ─────────────────────────────────────────────────────────────
CREATE TABLE procedure_workup (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL REFERENCES procedure_plans(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  investigation     TEXT NOT NULL,       -- 'Serum Creatinine', 'ECG', 'ECHO', etc.
  category          TEXT,                -- 'blood', 'imaging', 'cardiac', 'respiratory'
  mandatory         BOOLEAN NOT NULL DEFAULT TRUE,
  status            workup_status NOT NULL DEFAULT 'not_ordered',
  result_value      TEXT,               -- the actual result
  result_date       DATE,
  normal_range      TEXT,               -- for reference
  is_abnormal       BOOLEAN DEFAULT FALSE,
  abnormal_action   TEXT,               -- what was done about the abnormal value
  reviewed_by       UUID REFERENCES specialists(id),
  reviewed_at       TIMESTAMPTZ,
  waived_reason     TEXT,               -- if waived, why
  notes             TEXT,
  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workup_plan       ON procedure_workup(plan_id);
CREATE INDEX idx_workup_specialist ON procedure_workup(specialist_id);
CREATE INDEX idx_workup_abnormal   ON procedure_workup(plan_id) WHERE is_abnormal = TRUE;
CREATE INDEX idx_workup_incomplete ON procedure_workup(plan_id) WHERE status NOT IN ('reviewed_normal','reviewed_acceptable','reviewed_abnormal','waived');

-- ─────────────────────────────────────────────────────────────
-- TABLE: procedure_medication_holds
-- Track which medications to hold, for how long, when to resume
-- Pre-populated from protocol, specialist reviews for each patient
-- ─────────────────────────────────────────────────────────────
CREATE TABLE procedure_medication_holds (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL REFERENCES procedure_plans(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  drug_name         TEXT NOT NULL,
  drug_class        TEXT,               -- 'anticoagulant', 'antiplatelet', 'antidiabetic', etc.
  hold_days_before  INTEGER NOT NULL,   -- e.g. 5 for warfarin
  hold_date         DATE,               -- computed from procedure date
  resume_when       TEXT NOT NULL,      -- 'after 48h', 'after wound check', 'as instructed'
  reason            TEXT NOT NULL,      -- clinical rationale
  patient_confirmed BOOLEAN DEFAULT FALSE,  -- patient told and understood
  bridging_required BOOLEAN DEFAULT FALSE,
  bridging_details  TEXT,               -- e.g. 'LMWH bridging protocol'
  applies_to_patient BOOLEAN DEFAULT TRUE,  -- false if patient not on this drug
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_medholds_plan       ON procedure_medication_holds(plan_id);
CREATE INDEX idx_medholds_specialist ON procedure_medication_holds(specialist_id);

-- ─────────────────────────────────────────────────────────────
-- TABLE: patient_care_plan
-- The complete patient-facing care plan
-- Delivered via WhatsApp in stages (D-7, D-1, D-day, post-procedure)
-- Each section is rich: timing, instructions, what to watch for
-- ─────────────────────────────────────────────────────────────
CREATE TABLE patient_care_plans (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL REFERENCES procedure_plans(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  -- Sections of the care plan — JSONB array
  -- Each: { id, stage, title, content, channel, scheduled_send_at,
  --         sent_at, delivery_status, importance: 'routine'|'critical' }
  sections          JSONB NOT NULL DEFAULT '[]',

  -- Quick-access fields for display
  procedure_explained_at  TIMESTAMPTZ,
  patient_questions_noted TEXT,         -- questions raised by patient

  -- Pre-procedure instructions (plain language for patient)
  fasting_instructions    TEXT,         -- "Do not eat or drink from midnight"
  arrival_instructions    TEXT,         -- "Arrive at 6:30 AM at Main Hospital Gate 2"
  what_to_bring           TEXT,         -- "Bring all reports, blood pressure medications, ID"
  what_not_to_bring       TEXT,

  -- Post-procedure
  post_procedure_instructions TEXT,
  wound_care_instructions     TEXT,
  activity_restrictions       TEXT,     -- "No driving for 5 days", "No lifting >5kg"
  diet_instructions           TEXT,
  red_flags                   TEXT,     -- "Go to emergency if: chest pain, bleeding..."

  -- Delivery tracking
  last_sent_at        TIMESTAMPTZ,
  total_messages_sent INTEGER DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id)
);

CREATE INDEX idx_careplan_plan       ON patient_care_plans(plan_id);
CREATE INDEX idx_careplan_specialist ON patient_care_plans(specialist_id);

-- ─────────────────────────────────────────────────────────────
-- TABLE: procedure_consent
-- Structured consent documentation — what was explained,
-- what questions were asked, patient's understanding
-- ─────────────────────────────────────────────────────────────
CREATE TABLE procedure_consent (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL REFERENCES procedure_plans(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  -- Explanation documented
  procedure_explained   BOOLEAN DEFAULT FALSE,
  indication_explained  BOOLEAN DEFAULT FALSE,
  alternatives_discussed BOOLEAN DEFAULT FALSE,  -- 'conservative', 'other procedures'
  risks_explained       BOOLEAN DEFAULT FALSE,

  -- Risks documented — what was covered
  -- Each: { risk, severity, frequency, discussed_at }
  risks_covered     JSONB NOT NULL DEFAULT '[]',

  -- Patient questions and responses
  patient_questions JSONB NOT NULL DEFAULT '[]',  -- [{ question, answer, documented_at }]

  -- Decision
  patient_decision  TEXT,           -- 'agreed', 'declined', 'deferred', 'proxy_consent'
  decision_capacity TEXT DEFAULT 'intact',  -- 'intact', 'impaired', 'via_proxy'
  proxy_name        TEXT,
  proxy_relationship TEXT,

  -- Witness
  witness_name      TEXT,
  witness_designation TEXT,

  -- Consent form
  form_signed       BOOLEAN DEFAULT FALSE,
  form_signed_at    TIMESTAMPTZ,
  digital_signature TEXT,           -- future: for e-consent

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id)
);

CREATE INDEX idx_consent_plan       ON procedure_consent(plan_id);
CREATE INDEX idx_consent_specialist ON procedure_consent(specialist_id);

-- ─────────────────────────────────────────────────────────────
-- TABLE: procedure_checklist_responses
-- Day-of WHO surgical safety checklist responses
-- ─────────────────────────────────────────────────────────────
CREATE TABLE procedure_checklist_responses (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL REFERENCES procedure_plans(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  checklist_type    TEXT NOT NULL DEFAULT 'sign_in',  -- sign_in, time_out, sign_out
  items             JSONB NOT NULL DEFAULT '[]',  -- [{ item_id, item_text, checked, checked_by }]
  completed_by      UUID REFERENCES specialists(id),
  completed_at      TIMESTAMPTZ,
  any_concerns      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_checklist_plan ON procedure_checklist_responses(plan_id);

-- ─────────────────────────────────────────────────────────────
-- TABLE: procedure_alert_log
-- Immutable log of every scheduled alert sent
-- ─────────────────────────────────────────────────────────────
CREATE TABLE procedure_alert_log (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL REFERENCES procedure_plans(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  alert_stage       alert_stage NOT NULL,
  recipient_type    TEXT NOT NULL,     -- 'patient', 'anaesthesiologist', 'ot_coordinator'
  channel           TEXT NOT NULL DEFAULT 'whatsapp',
  message_preview   TEXT,
  delivered_at      TIMESTAMPTZ,
  delivery_status   TEXT DEFAULT 'sent',
  scheduled_for     TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_plan      ON procedure_alert_log(plan_id);
CREATE INDEX idx_alerts_scheduled ON procedure_alert_log(scheduled_for)
  WHERE delivery_status = 'sent';

-- ─────────────────────────────────────────────────────────────
-- TABLE: procedure_protocol_defaults
-- Pre-seeded specialty defaults — read-only starting points
-- ─────────────────────────────────────────────────────────────
CREATE TABLE procedure_protocol_defaults (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialty         TEXT NOT NULL,
  procedure_name    TEXT NOT NULL,
  procedure_code    TEXT,
  description       TEXT,
  ot_room_type      TEXT,
  estimated_duration_mins INTEGER,
  anaesthesia_type  TEXT,
  workup_items      JSONB NOT NULL DEFAULT '[]',
  medication_holds  JSONB NOT NULL DEFAULT '[]',
  standard_resources JSONB NOT NULL DEFAULT '[]',
  prep_instructions JSONB NOT NULL DEFAULT '[]',
  alert_templates   JSONB NOT NULL DEFAULT '[]',
  consent_items     JSONB NOT NULL DEFAULT '[]',
  checklist_items   JSONB NOT NULL DEFAULT '[]',
  post_procedure_plan JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_defaults_specialty ON procedure_protocol_defaults(specialty);

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: populate plan from protocol (atomic)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION populate_plan_from_protocol(
  p_plan_id     UUID,
  p_protocol_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_protocol     RECORD;
  v_workup_item  JSONB;
  v_hold_item    JSONB;
  v_resource     JSONB;
  v_specialist   UUID;
BEGIN
  SELECT specialist_id INTO v_specialist FROM procedure_plans WHERE id = p_plan_id;

  SELECT * INTO v_protocol FROM procedure_protocols WHERE id = p_protocol_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Update plan with protocol defaults
  UPDATE procedure_plans SET
    ot_room_type             = v_protocol.ot_room_type,
    estimated_duration_mins  = v_protocol.estimated_duration_mins,
    anaesthesia_type         = v_protocol.anaesthesia_type
  WHERE id = p_plan_id;

  -- Create workup items
  FOR v_workup_item IN SELECT * FROM jsonb_array_elements(v_protocol.workup_items) LOOP
    INSERT INTO procedure_workup (
      plan_id, specialist_id, investigation, category, mandatory, status, normal_range, sort_order
    ) VALUES (
      p_plan_id, v_specialist,
      v_workup_item->>'name',
      v_workup_item->>'category',
      COALESCE((v_workup_item->>'mandatory')::BOOLEAN, TRUE),
      'not_ordered',
      v_workup_item->>'normal_range',
      COALESCE((v_workup_item->>'sort_order')::INTEGER, 0)
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Create medication holds
  FOR v_hold_item IN SELECT * FROM jsonb_array_elements(v_protocol.medication_holds) LOOP
    INSERT INTO procedure_medication_holds (
      plan_id, specialist_id, drug_name, drug_class,
      hold_days_before, resume_when, reason
    ) VALUES (
      p_plan_id, v_specialist,
      v_hold_item->>'drug_name',
      v_hold_item->>'drug_class',
      COALESCE((v_hold_item->>'hold_days_before')::INTEGER, 1),
      COALESCE(v_hold_item->>'resume_when', 'As instructed by your doctor'),
      COALESCE(v_hold_item->>'reason', '')
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Create resources
  FOR v_resource IN SELECT * FROM jsonb_array_elements(v_protocol.standard_resources) LOOP
    INSERT INTO procedure_resources (
      plan_id, specialist_id, resource_type, name,
      quantity, specification, status, mandatory, sort_order
    ) VALUES (
      p_plan_id, v_specialist,
      (v_resource->>'type')::resource_type,
      v_resource->>'name',
      COALESCE((v_resource->>'quantity')::INTEGER, 1),
      v_resource->>'specification',
      'required',
      COALESCE((v_resource->>'mandatory')::BOOLEAN, TRUE),
      COALESCE((v_resource->>'sort_order')::INTEGER, 0)
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Create care plan from protocol template
  INSERT INTO patient_care_plans (plan_id, specialist_id, sections)
  VALUES (p_plan_id, v_specialist, v_protocol.prep_instructions)
  ON CONFLICT (plan_id) DO NOTHING;

  -- Create consent record
  INSERT INTO procedure_consent (plan_id, specialist_id)
  VALUES (p_plan_id, v_specialist)
  ON CONFLICT (plan_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: check workup completeness
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_workup_complete(p_plan_id UUID)
RETURNS BOOLEAN AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM procedure_workup
    WHERE plan_id = p_plan_id
      AND mandatory = TRUE
      AND status NOT IN ('reviewed_normal','reviewed_acceptable','reviewed_abnormal','waived')
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: check resources confirmed
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_resources_confirmed(p_plan_id UUID)
RETURNS BOOLEAN AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM procedure_resources
    WHERE plan_id = p_plan_id
      AND mandatory = TRUE
      AND status NOT IN ('confirmed', 'not_needed')
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────────────────────
CREATE TRIGGER plans_updated_at
  BEFORE UPDATE ON procedure_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER protocols_updated_at
  BEFORE UPDATE ON procedure_protocols
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER workup_updated_at
  BEFORE UPDATE ON procedure_workup
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER careplan_updated_at
  BEFORE UPDATE ON patient_care_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER consent_updated_at
  BEFORE UPDATE ON procedure_consent
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-update workup_complete flag when workup items change
CREATE OR REPLACE FUNCTION update_plan_workup_flag()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE procedure_plans
  SET workup_complete = check_workup_complete(NEW.plan_id)
  WHERE id = NEW.plan_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workup_completion_check
  AFTER INSERT OR UPDATE ON procedure_workup
  FOR EACH ROW EXECUTE FUNCTION update_plan_workup_flag();

-- Auto-update resources_confirmed flag when resources change
CREATE OR REPLACE FUNCTION update_plan_resources_flag()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE procedure_plans
  SET resources_confirmed = check_resources_confirmed(NEW.plan_id)
  WHERE id = NEW.plan_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resource_confirmation_check
  AFTER INSERT OR UPDATE ON procedure_resources
  FOR EACH ROW EXECUTE FUNCTION update_plan_resources_flag();

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────
ALTER TABLE procedure_protocols            ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedure_plans                ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedure_resources            ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedure_workup               ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedure_medication_holds     ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_care_plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedure_consent              ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedure_checklist_responses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedure_alert_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedure_protocol_defaults    ENABLE ROW LEVEL SECURITY;

CREATE POLICY protocols_isolation    ON procedure_protocols         FOR ALL USING (specialist_id = auth.uid());
CREATE POLICY plans_isolation        ON procedure_plans             FOR ALL USING (specialist_id = auth.uid());
CREATE POLICY resources_isolation    ON procedure_resources         FOR ALL USING (specialist_id = auth.uid());
CREATE POLICY workup_isolation       ON procedure_workup            FOR ALL USING (specialist_id = auth.uid());
CREATE POLICY medholds_isolation     ON procedure_medication_holds  FOR ALL USING (specialist_id = auth.uid());
CREATE POLICY careplan_isolation     ON patient_care_plans          FOR ALL USING (specialist_id = auth.uid());
CREATE POLICY consent_isolation      ON procedure_consent           FOR ALL USING (specialist_id = auth.uid());
CREATE POLICY checklist_isolation    ON procedure_checklist_responses FOR ALL USING (specialist_id = auth.uid());
CREATE POLICY alerts_isolation       ON procedure_alert_log         FOR ALL USING (specialist_id = auth.uid());
CREATE POLICY defaults_read          ON procedure_protocol_defaults FOR SELECT USING (auth.uid() IS NOT NULL);

-- ─────────────────────────────────────────────────────────────
-- SEED: Specialty procedure protocol defaults
-- ─────────────────────────────────────────────────────────────
INSERT INTO procedure_protocol_defaults
  (specialty, procedure_name, procedure_code, description,
   ot_room_type, estimated_duration_mins, anaesthesia_type,
   workup_items, medication_holds, standard_resources,
   prep_instructions, consent_items, checklist_items, post_procedure_plan)
VALUES

-- ══════════════════════════════════════════════════════════
-- INTERVENTIONAL CARDIOLOGY: Coronary Angioplasty (PCI)
-- ══════════════════════════════════════════════════════════
('interventional_cardiology', 'Coronary Angioplasty (PCI)', 'PCI',
 'Percutaneous coronary intervention — balloon angioplasty and stenting',
 'cath_lab', 90, 'sedation',
 -- Workup
 '[
   {"name":"Serum Creatinine","category":"blood","mandatory":true,"sort_order":1,"normal_range":"0.6–1.2 mg/dL","notes":"Contrast safety — hold if Cr > 1.5 or eGFR < 30"},
   {"name":"eGFR","category":"blood","mandatory":true,"sort_order":2,"normal_range":">60 mL/min/1.73m²"},
   {"name":"Platelet Count","category":"blood","mandatory":true,"sort_order":3,"normal_range":"1.5–4.5 lakhs"},
   {"name":"INR / PT","category":"blood","mandatory":true,"sort_order":4,"normal_range":"INR < 2.5 for procedure"},
   {"name":"HbA1c","category":"blood","mandatory":true,"sort_order":5,"normal_range":"<8.5% preferred"},
   {"name":"ECG","category":"cardiac","mandatory":true,"sort_order":6},
   {"name":"Echocardiogram","category":"cardiac","mandatory":true,"sort_order":7,"notes":"EF, wall motion, LV function"},
   {"name":"Haemogram (CBC)","category":"blood","mandatory":true,"sort_order":8,"normal_range":"Hb > 10 g/dL"},
   {"name":"Blood Group and Cross Match","category":"blood","mandatory":true,"sort_order":9},
   {"name":"Coronary Angiography","category":"imaging","mandatory":false,"sort_order":10,"notes":"If diagnostic angio not already done, may do at same sitting"}
 ]',
 -- Medication holds
 '[
   {"drug_name":"Metformin","drug_class":"antidiabetic","hold_days_before":2,"resume_when":"48 hours after procedure if creatinine normal","reason":"Risk of contrast-induced nephropathy with metformin accumulation"},
   {"drug_name":"Warfarin","drug_class":"anticoagulant","hold_days_before":5,"resume_when":"As instructed — INR must be < 2.5 before procedure","reason":"Bleeding risk at access site"},
   {"drug_name":"Rivaroxaban / Apixaban (NOACs)","drug_class":"anticoagulant","hold_days_before":2,"resume_when":"After 24–48 hours, when haemostasis confirmed","reason":"Bleeding risk"},
   {"drug_name":"NSAIDs (Ibuprofen, Diclofenac)","drug_class":"nsaid","hold_days_before":3,"resume_when":"After 72 hours","reason":"Platelet function and renal protection"}
 ]',
 -- Resources
 '[
   {"type":"ot_room","name":"Cardiac Catheterisation Laboratory","mandatory":true,"sort_order":1},
   {"type":"equipment","name":"Fluoroscopy / C-arm","mandatory":true,"sort_order":2},
   {"type":"consumable","name":"Guiding catheter (specify size)","mandatory":true,"sort_order":3},
   {"type":"consumable","name":"Coronary guidewire","mandatory":true,"sort_order":4},
   {"type":"consumable","name":"Drug-eluting stent (specify vessel and lesion length)","mandatory":true,"sort_order":5,"notes":"Size to be confirmed from diagnostic angiography"},
   {"type":"consumable","name":"Contrast medium (iodinated)","mandatory":true,"sort_order":6,"quantity":2},
   {"type":"consumable","name":"Radial sheath 6Fr or femoral sheath 6Fr","mandatory":true,"sort_order":7},
   {"type":"medication","name":"Heparin","mandatory":true,"sort_order":8},
   {"type":"medication","name":"Antiplatelet loading (Aspirin 300mg + Clopidogrel 300mg)","mandatory":true,"sort_order":9},
   {"type":"medication","name":"Contrast allergy premedication if history present","mandatory":false,"sort_order":10},
   {"type":"support_clinician","name":"Cath lab scrub nurse / technician","mandatory":true,"sort_order":11},
   {"type":"support_clinician","name":"Radiation safety officer awareness","mandatory":false,"sort_order":12},
   {"type":"equipment","name":"Intra-aortic balloon pump on standby","mandatory":false,"sort_order":13},
   {"type":"blood_products","name":"Blood group and crossmatch — 2 units packed cells ready","mandatory":true,"sort_order":14}
 ]',
 -- Patient prep instructions
 '[
   {"timing":"d_minus_7","category":"medication","instruction":"Aspirin 75–150mg daily must be continued up to and including the day of procedure. Do NOT stop aspirin unless instructed specifically.","importance":"critical"},
   {"timing":"d_minus_7","category":"medication","instruction":"If you take Metformin for diabetes, STOP it 48 hours before the procedure date.","importance":"critical"},
   {"timing":"d_minus_7","category":"medication","instruction":"If you are on warfarin, you may be asked to stop it 5 days before. Your doctor will advise specifically. Do NOT stop without instruction.","importance":"critical"},
   {"timing":"d_minus_3","category":"logistics","instruction":"Confirm your admission time and location with the hospital coordinator. Bring all previous angiography reports and investigation results.","importance":"routine"},
   {"timing":"d_minus_1","category":"fasting","instruction":"Do NOT eat solid food after midnight. You may drink small sips of plain water up to 2 hours before the procedure.","importance":"critical"},
   {"timing":"d_minus_1","category":"medication","instruction":"Take your blood pressure medications with a small sip of water in the morning as usual, unless told otherwise.","importance":"critical"},
   {"timing":"d_minus_1","category":"hygiene","instruction":"Shower tonight and in the morning. Do not apply any creams or lotions to your groin or wrist area (access sites).","importance":"routine"},
   {"timing":"d_day_morning","category":"logistics","instruction":"Arrive at the hospital at the confirmed time. Bring your ID proof, all reports, and a family member to accompany you. Wear loose, comfortable clothing.","importance":"routine"},
   {"timing":"d_day_morning","category":"medication","instruction":"Blood pressure and heart medications — take as instructed the morning of procedure. Diabetic medications — do NOT take on procedure morning.","importance":"critical"}
 ]',
 -- Consent items
 '[
   {"id":"indication","topic":"Why this procedure is needed","detail":"Block in the heart artery (coronary artery disease) causing chest pain or heart attack risk","risk_category":"information"},
   {"id":"procedure_description","topic":"What the procedure involves","detail":"A thin tube (catheter) is passed through the wrist or groin into the heart artery. A balloon opens the blockage and a metal spring (stent) holds it open.","risk_category":"information"},
   {"id":"alternatives","topic":"Alternatives discussed","detail":"1. Medications only (no procedure)\n2. Bypass surgery (CABG)\n3. No treatment","risk_category":"information"},
   {"id":"success_rate","topic":"Expected outcome","detail":"Technical success > 95% for elective PCI. Symptom relief in most patients.","risk_category":"information"},
   {"id":"common_risks","topic":"Common risks (>1%)","detail":"Access site bruising or haematoma (5%), contrast reaction (1–2%), artery closure requiring emergency CABG (<1%)","risk_category":"common"},
   {"id":"serious_risks","topic":"Serious risks (<1%)","detail":"Heart attack during procedure (<1%), stroke (<0.5%), emergency cardiac surgery (<1%), death (<0.5% for elective)","risk_category":"serious"},
   {"id":"contrast","topic":"Contrast dye (iodine)","detail":"Required to see the arteries on X-ray. Risk of allergy (please confirm if any history) and temporary kidney effect (premedication given if allergy, creatinine checked).","risk_category":"common"},
   {"id":"radiation","topic":"X-ray radiation","detail":"Procedure uses fluoroscopy (X-ray). Dose is low and clinically justified. Pregnancy must be disclosed.","risk_category":"information"},
   {"id":"stent_care","topic":"After the stent","detail":"Two blood-thinning tablets (aspirin + clopidogrel) must be taken together for 12 months minimum after stent insertion. Do NOT stop without consulting cardiologist — risk of stent block.","risk_category":"critical"}
 ]',
 -- Checklist items (WHO Safety adapted for cath lab)
 '[
   {"id":"patient_id","phase":"sign_in","item":"Patient identity confirmed — name, DOB, procedure","mandatory":true},
   {"id":"consent_signed","phase":"sign_in","item":"Consent form signed and in notes","mandatory":true},
   {"id":"allergies_confirmed","phase":"sign_in","item":"Allergy status confirmed — contrast, heparin, latex","mandatory":true},
   {"id":"access_site_marked","phase":"sign_in","item":"Access site confirmed — radial or femoral","mandatory":true},
   {"id":"creatinine_checked","phase":"sign_in","item":"Latest creatinine reviewed and acceptable","mandatory":true},
   {"id":"antiplatelet_given","phase":"sign_in","item":"Antiplatelet loading confirmed (aspirin + clopidogrel or ticagrelor)","mandatory":true},
   {"id":"radiation_briefing","phase":"time_out","item":"Radiation safety measures in place","mandatory":true},
   {"id":"stent_availability","phase":"time_out","item":"Stent size and type confirmed and available in room","mandatory":true},
   {"id":"emergency_equipment","phase":"time_out","item":"Defibrillator and emergency drugs checked","mandatory":true},
   {"id":"team_introduction","phase":"time_out","item":"All team members introduced and roles confirmed","mandatory":true},
   {"id":"access_site_check","phase":"sign_out","item":"Access site haemostasis confirmed","mandatory":true},
   {"id":"outcome_documented","phase":"sign_out","item":"Procedure outcome documented — vessels treated, stents deployed","mandatory":true}
 ]',
 -- Post-procedure plan
 '[
   {"id":"access_site_care","title":"Access site care","timing":"first_24h","content":"Keep wrist/groin site dry and clean. No heavy lifting. If bleeding, apply firm pressure and call immediately."},
   {"id":"bed_rest","title":"Activity after procedure","timing":"first_24h","content":"Radial access: 2 hours bed rest. Femoral access: 6 hours flat bed rest. Do not bend the leg used for access."},
   {"id":"antiplatelet","title":"CRITICAL: Blood thinning tablets","timing":"ongoing","content":"You MUST take BOTH aspirin and clopidogrel (or ticagrelor) every day for at least 12 months. Missing even one dose can cause the stent to block. Do not stop without calling your cardiologist."},
   {"id":"fluids","title":"Drink plenty of water","timing":"first_24h","content":"Drink at least 2–3 litres of water in the 24 hours after the procedure to help flush the contrast dye through your kidneys."},
   {"id":"metformin_resume","title":"Metformin restart (diabetics)","timing":"48h","content":"Metformin can be restarted 48 hours after the procedure ONLY if your kidney function test (creatinine) is normal. Your doctor will advise."},
   {"id":"follow_up","title":"Follow-up appointment","timing":"2_weeks","content":"Return in 2 weeks for wound check and medication review. If any chest pain or breathlessness before then, come immediately to emergency."},
   {"id":"red_flags","title":"When to go to emergency immediately","timing":"ongoing","content":"Go to the nearest emergency or call 112 if you develop:\n• Chest pain or pressure\n• Bleeding that will not stop at the access site\n• Swelling, numbness, or colour change in the arm or leg used for access\n• High fever\n• Sudden breathlessness"}
 ]'),

-- ══════════════════════════════════════════════════════════
-- CARDIAC SURGERY: CABG
-- ══════════════════════════════════════════════════════════
('cardiac_surgery', 'Coronary Artery Bypass Grafting (CABG)', 'CABG',
 'Open-heart surgery to bypass blocked coronary arteries using conduit grafts',
 'main_ot', 300, 'ga',
 '[
   {"name":"Echocardiogram","category":"cardiac","mandatory":true,"sort_order":1,"notes":"EF, wall motion, valve function — essential for surgical planning"},
   {"name":"Coronary Angiography","category":"imaging","mandatory":true,"sort_order":2,"notes":"Detailed anatomy of coronary disease for bypass planning"},
   {"name":"Serum Creatinine + eGFR","category":"blood","mandatory":true,"sort_order":3},
   {"name":"HbA1c","category":"blood","mandatory":true,"sort_order":4},
   {"name":"Haemogram (CBC)","category":"blood","mandatory":true,"sort_order":5,"normal_range":"Hb > 10 g/dL; correct if lower"},
   {"name":"Coagulation Screen (PT, APTT, INR)","category":"blood","mandatory":true,"sort_order":6},
   {"name":"Blood Group, Cross Match, Hold 4 units","category":"blood","mandatory":true,"sort_order":7},
   {"name":"Pulmonary Function Tests (PFTs)","category":"respiratory","mandatory":true,"sort_order":8,"notes":"FEV1 > 50% preferred for GA"},
   {"name":"Carotid Doppler","category":"imaging","mandatory":true,"sort_order":9,"notes":"Significant carotid stenosis changes surgical approach"},
   {"name":"Chest X-Ray","category":"imaging","mandatory":true,"sort_order":10},
   {"name":"ECG","category":"cardiac","mandatory":true,"sort_order":11},
   {"name":"Dental Clearance","category":"other","mandatory":true,"sort_order":12,"notes":"Active dental infection is contraindication — infection of valve/graft"},
   {"name":"Anaesthesia Pre-assessment","category":"other","mandatory":true,"sort_order":13}
 ]',
 '[
   {"drug_name":"Warfarin","drug_class":"anticoagulant","hold_days_before":5,"resume_when":"Post-operative day 2–3 as instructed (INR check)","reason":"Major bleeding risk intraoperatively"},
   {"drug_name":"Clopidogrel / Ticagrelor","drug_class":"antiplatelet","hold_days_before":5,"resume_when":"Post-operative as instructed by cardiologist","reason":"Significant platelet inhibition — excess bleeding risk"},
   {"drug_name":"Aspirin","drug_class":"antiplatelet","hold_days_before":0,"resume_when":"Continue — given on day of surgery","reason":"Continue aspirin up to surgery for graft patency"},
   {"drug_name":"NOACs (rivaroxaban, apixaban, dabigatran)","drug_class":"anticoagulant","hold_days_before":3,"resume_when":"As instructed post-operatively","reason":"Significant bleeding risk"},
   {"drug_name":"ACE inhibitors / ARBs","drug_class":"antihypertensive","hold_days_before":1,"resume_when":"After haemodynamic stability post-op","reason":"Intraoperative hypotension risk on cardiopulmonary bypass"}
 ]',
 '[
   {"type":"ot_room","name":"Main Operating Theatre with cardiac bypass capability","mandatory":true,"sort_order":1},
   {"type":"equipment","name":"Cardiopulmonary Bypass (heart-lung machine)","mandatory":true,"sort_order":2},
   {"type":"support_clinician","name":"Perfusionist (cardiopulmonary bypass specialist)","mandatory":true,"sort_order":3},
   {"type":"anaesthesiologist","name":"Cardiac anaesthesiologist","mandatory":true,"sort_order":4},
   {"type":"equipment","name":"Intraoperative TEE (transoesophageal echo)","mandatory":true,"sort_order":5},
   {"type":"consumable","name":"Bypass conduit — LIMA harvest (standard)","mandatory":true,"sort_order":6},
   {"type":"consumable","name":"Saphenous vein graft (if additional conduit needed)","mandatory":false,"sort_order":7},
   {"type":"equipment","name":"Cell saver (autologous blood recovery)","mandatory":true,"sort_order":8},
   {"type":"icu_bed","name":"Cardiac ICU bed — post-operative","mandatory":true,"sort_order":9},
   {"type":"blood_products","name":"4 units packed red cells crossmatched","mandatory":true,"sort_order":10},
   {"type":"blood_products","name":"FFP (4 units) and platelets on standby","mandatory":true,"sort_order":11},
   {"type":"support_clinician","name":"Scrub nurse trained in cardiac surgery","mandatory":true,"sort_order":12}
 ]',
 '[
   {"timing":"d_minus_7","category":"medication","instruction":"STOP clopidogrel or ticagrelor exactly 5 days before surgery. Do not stop aspirin — continue until the morning of surgery.","importance":"critical"},
   {"timing":"d_minus_7","category":"lifestyle","instruction":"Stop smoking completely now. Smoking significantly increases risk of chest infection after open-heart surgery.","importance":"critical"},
   {"timing":"d_minus_3","category":"logistics","instruction":"Complete all investigations listed. Bring all reports including angiography on admission day.","importance":"critical"},
   {"timing":"d_minus_1","category":"logistics","instruction":"Admit to hospital the day before surgery. Bring 3–5 days of clothing. No jewellery or nail polish.","importance":"routine"},
   {"timing":"d_minus_1","category":"fasting","instruction":"Last solid meal at 10 PM the night before. No food or drink after midnight. Small sip of water with essential medications in the morning only.","importance":"critical"},
   {"timing":"d_minus_1","category":"hygiene","instruction":"Full body shower with antiseptic soap (chlorhexidine) tonight and on the morning of surgery.","importance":"critical"},
   {"timing":"d_day_morning","category":"medication","instruction":"Beta-blockers and statins — take with a small sip of water in the morning. All other medications — as instructed by your surgeon.","importance":"critical"}
 ]',
 '[
   {"id":"indication","topic":"Why bypass surgery is needed","detail":"Critical blockages in multiple heart arteries that cannot be treated with stents — bypass restores blood supply to the heart muscle","risk_category":"information"},
   {"id":"procedure","topic":"What the surgery involves","detail":"The chest is opened through the breastbone. The heart is temporarily stopped and a heart-lung machine keeps circulation going. Blocked arteries are bypassed using your own veins/arteries from the chest or leg.","risk_category":"information"},
   {"id":"alternatives","topic":"Alternatives discussed","detail":"1. Medication only (symptoms not adequately controlled)\n2. Stenting (may not be technically feasible for all lesions)\n3. No surgery (and consequences explained)","risk_category":"information"},
   {"id":"mortality","topic":"Surgical mortality risk","detail":"Elective CABG in good surgical candidates: 1–3%. Higher in emergency, poor LV function, elderly, multiple comorbidities. Individual risk stated explicitly.","risk_category":"serious"},
   {"id":"stroke","topic":"Stroke risk","detail":"0.5–2% risk of stroke. Higher with carotid disease, older age, redo surgery. Discussed with patient.","risk_category":"serious"},
   {"id":"afib","topic":"Post-operative atrial fibrillation","detail":"30–40% of patients develop AF after CABG — usually temporary. May require cardioversion or rate control medications.","risk_category":"common"},
   {"id":"renal","topic":"Kidney function","detail":"Temporary worsening of kidney function in 10–20%. Rarely requires dialysis (<2%).","risk_category":"common"},
   {"id":"wound","topic":"Wound and sternal healing","detail":"Chest wound takes 6–8 weeks to heal. Leg wound (if vein harvest) may take longer. Sternal precautions for 3 months.","risk_category":"information"},
   {"id":"icu","topic":"ICU and recovery","detail":"Typically 1–3 days in cardiac ICU, then 4–7 days on the ward. Total hospital stay 7–10 days.","risk_category":"information"}
 ]',
 '[
   {"id":"patient_id","phase":"sign_in","item":"Patient identity and consent confirmed","mandatory":true},
   {"id":"allergies","phase":"sign_in","item":"Allergies checked — heparin, antibiotics, latex","mandatory":true},
   {"id":"icu_bed","phase":"sign_in","item":"Cardiac ICU bed confirmed available","mandatory":true},
   {"id":"blood_available","phase":"sign_in","item":"Blood products crossmatched and in blood bank","mandatory":true},
   {"id":"team_intro","phase":"time_out","item":"Full team introduction — surgeon, anaesthetist, perfusionist, scrub nurse","mandatory":true},
   {"id":"bypass_plan","phase":"time_out","item":"Bypass strategy confirmed — conduits and target vessels agreed","mandatory":true},
   {"id":"echo_confirmed","phase":"time_out","item":"Intraoperative echo probe in position and tested","mandatory":true},
   {"id":"graft_check","phase":"sign_out","item":"All graft flows confirmed and documented","mandatory":true},
   {"id":"haemostasis","phase":"sign_out","item":"Haemostasis confirmed before chest closure","mandatory":true},
   {"id":"pacing_wires","phase":"sign_out","item":"Epicardial pacing wires placed and functioning","mandatory":true}
 ]',
 '[
   {"id":"icu_care","title":"Intensive care after surgery","timing":"first_24h","content":"You will wake up in the cardiac ICU with a breathing tube in your throat (usually removed within a few hours), chest drain tubes, and a urinary catheter. This is expected and temporary."},
   {"id":"pain_management","title":"Pain management","timing":"ongoing","content":"You will be given regular pain medications. Good pain control helps you breathe deeply and prevents chest infection. Tell the nurse if you are in pain."},
   {"id":"breathing","title":"Deep breathing exercises","timing":"first_week","content":"A physiotherapist will teach you breathing exercises. These are essential to prevent pneumonia. Do them every hour when awake."},
   {"id":"sternal_precautions","title":"Protecting your sternum (breastbone)","timing":"3_months","content":"Do NOT push up with your arms, lift more than 2–3 kg, or do any upper body exercise for 3 months. Your sternum is healing — it takes 8–12 weeks to be solid."},
   {"id":"wound_care","title":"Wound care","timing":"2_weeks","content":"Keep wounds dry for the first 10 days. No bath or swimming — shower only. Return for wound check at 2 weeks."},
   {"id":"anticoagulation","title":"Blood thinners after surgery","timing":"ongoing","content":"You will be started on aspirin and possibly warfarin after surgery depending on your valves. Take exactly as prescribed and attend INR monitoring as scheduled."},
   {"id":"cardiac_rehab","title":"Cardiac rehabilitation","timing":"4_weeks","content":"You will be referred to a cardiac rehabilitation programme starting 4–6 weeks after surgery. This is one of the strongest predictors of long-term recovery — please attend."},
   {"id":"red_flags","title":"When to call emergency (112) immediately","timing":"ongoing","content":"Call 112 if you develop:\n• Chest pain or pressure\n• Sudden breathlessness\n• Bleeding from wound that does not stop with pressure\n• Fever above 38.5°C\n• Wound becomes red, hot, or discharges\n• Any sudden change in vision, speech, or limb weakness"}
 ]'),

-- ══════════════════════════════════════════════════════════
-- NEUROSURGERY: Elective Craniotomy
-- ══════════════════════════════════════════════════════════
('neurosurgery', 'Elective Craniotomy', 'CRANI',
 'Craniotomy for brain tumour, AVM, haematoma, or other intracranial pathology',
 'neuro_ot', 240, 'ga',
 '[
   {"name":"MRI Brain with Contrast","category":"imaging","mandatory":true,"sort_order":1,"notes":"High-resolution 3T preferred. Include functional MRI if eloquent cortex involved."},
   {"name":"CT Brain","category":"imaging","mandatory":true,"sort_order":2,"notes":"For bone anatomy and haemorrhage assessment"},
   {"name":"Coagulation Screen (PT, APTT, INR)","category":"blood","mandatory":true,"sort_order":3,"normal_range":"INR < 1.5 for surgery"},
   {"name":"Haemogram (CBC)","category":"blood","mandatory":true,"sort_order":4,"normal_range":"Hb > 10 g/dL"},
   {"name":"Blood Group and Cross Match (2 units)","category":"blood","mandatory":true,"sort_order":5},
   {"name":"Serum Electrolytes (Na, K)","category":"blood","mandatory":true,"sort_order":6,"notes":"Sodium especially important — hyponatraemia increases cerebral oedema risk"},
   {"name":"Serum Creatinine","category":"blood","mandatory":true,"sort_order":7},
   {"name":"Blood Sugar (fasting)","category":"blood","mandatory":true,"sort_order":8},
   {"name":"ECG","category":"cardiac","mandatory":true,"sort_order":9},
   {"name":"Chest X-Ray","category":"imaging","mandatory":true,"sort_order":10},
   {"name":"MRI Spectroscopy (if tumour)","category":"imaging","mandatory":false,"sort_order":11,"notes":"Aids in tumour characterisation"},
   {"name":"Angiography (if AVM/aneurysm)","category":"imaging","mandatory":false,"sort_order":12}
 ]',
 '[
   {"drug_name":"Warfarin","drug_class":"anticoagulant","hold_days_before":7,"resume_when":"Only when surgeon confirms — typically 5–7 days post-op if haemostasis assured","reason":"Critical bleeding risk intracranially"},
   {"drug_name":"NOACs","drug_class":"anticoagulant","hold_days_before":5,"resume_when":"As instructed post-operatively","reason":"Intracranial bleeding risk"},
   {"drug_name":"Aspirin","drug_class":"antiplatelet","hold_days_before":7,"resume_when":"As instructed — usually 7 days post-op","reason":"Intracranial haemostasis"},
   {"drug_name":"Clopidogrel","drug_class":"antiplatelet","hold_days_before":7,"resume_when":"As instructed","reason":"Intracranial haemostasis"},
   {"drug_name":"Antiepileptic drugs (AEDs)","drug_class":"antiepileptic","hold_days_before":0,"resume_when":"Continue — DO NOT STOP","reason":"Seizure prophylaxis — stopping may cause perioperative seizure"}
 ]',
 '[
   {"type":"ot_room","name":"Dedicated Neurosurgery OT","mandatory":true,"sort_order":1},
   {"type":"equipment","name":"Operative Microscope","mandatory":true,"sort_order":2},
   {"type":"equipment","name":"Neuronavigation system (StealthStation or BrainLab)","mandatory":true,"sort_order":3,"notes":"MRI data to be uploaded 24h before — confirm with OT coordinator"},
   {"type":"anaesthesiologist","name":"Neuroanaesthesiologist","mandatory":true,"sort_order":4},
   {"type":"equipment","name":"ICP monitoring setup (if required)","mandatory":false,"sort_order":5},
   {"type":"support_clinician","name":"Scrub nurse experienced in neurosurgery","mandatory":true,"sort_order":6},
   {"type":"consumable","name":"Craniotomy drill and cranial fixation system (Mayfield)","mandatory":true,"sort_order":7},
   {"type":"consumable","name":"Haemostatic agents (Surgicel, Gelfoam, bone wax)","mandatory":true,"sort_order":8},
   {"type":"consumable","name":"Dural repair material (if required)","mandatory":false,"sort_order":9},
   {"type":"blood_products","name":"2 units packed red cells crossmatched","mandatory":true,"sort_order":10},
   {"type":"icu_bed","name":"Neuro HDU / ICU bed post-operatively","mandatory":true,"sort_order":11},
   {"type":"equipment","name":"Intraoperative ultrasound (if required for lesion localisation)","mandatory":false,"sort_order":12}
 ]',
 '[
   {"timing":"d_minus_7","category":"medication","instruction":"STOP all blood thinners as instructed by your surgeon. Do NOT stop anti-seizure tablets (AEDs) — these must be continued without interruption.","importance":"critical"},
   {"timing":"d_minus_3","category":"logistics","instruction":"MRI brain data must be uploaded to the neuronavigation system at least 24 hours before surgery. Confirm this has been arranged with the hospital coordinator.","importance":"critical"},
   {"timing":"d_minus_1","category":"logistics","instruction":"Admit to hospital. Arrange for a family member to stay with you post-operatively.","importance":"routine"},
   {"timing":"d_minus_1","category":"fasting","instruction":"Nothing to eat or drink after midnight. Sip of water with essential medications in the morning only.","importance":"critical"},
   {"timing":"d_minus_1","category":"hygiene","instruction":"Wash hair thoroughly with shampoo the night before. Do not apply any hair products, oil, or sprays.","importance":"routine"},
   {"timing":"d_day_morning","category":"medication","instruction":"Take your anti-seizure medications with a small sip of water as usual. Do NOT take blood thinners. If you take steroids (dexamethasone) they will be given by IV.","importance":"critical"}
 ]',
 '[
   {"id":"indication","topic":"Why the surgery is needed","detail":"Location and type of brain pathology and why surgical treatment is recommended over conservative management","risk_category":"information"},
   {"id":"procedure","topic":"What craniotomy involves","detail":"A section of the skull is temporarily removed to access the brain, the pathology is treated (tumour removed, haematoma evacuated, etc.), and the bone is replaced and fixed.","risk_category":"information"},
   {"id":"neurological_risk","topic":"Risk of neurological deficit","detail":"Risk of new weakness, numbness, speech difficulty, or vision change. Risk percentage depends on proximity of pathology to eloquent areas — discussed individually.","risk_category":"serious"},
   {"id":"haemorrhage","topic":"Bleeding","detail":"Post-operative haematoma requiring reoperation: 2–5%. Risk increased by anticoagulant use.","risk_category":"serious"},
   {"id":"infection","topic":"Wound infection and meningitis","detail":"Wound infection 2–3%, meningitis <1%. Prophylactic antibiotics given.","risk_category":"serious"},
   {"id":"seizures","topic":"Post-operative seizures","detail":"New seizures in 10–20% of brain tumour cases. Prophylactic AEDs discussed.","risk_category":"common"},
   {"id":"csf_leak","topic":"CSF leak","detail":"<2%. May require surgical repair or lumbar drain.","risk_category":"serious"},
   {"id":"mortality","topic":"Mortality","detail":"Depends on pathology, location, and patient condition. Discussed individually.","risk_category":"serious"}
 ]',
 '[
   {"id":"patient_id","phase":"sign_in","item":"Patient identity, consent, and allergy check","mandatory":true},
   {"id":"neuronavigation","phase":"sign_in","item":"Neuronavigation loaded with correct patient MRI — images verified","mandatory":true},
   {"id":"aed_given","phase":"sign_in","item":"Antiepileptic prophylaxis given (if applicable)","mandatory":true},
   {"id":"antibiotics","phase":"sign_in","item":"Prophylactic antibiotics administered within 60 minutes of incision","mandatory":true},
   {"id":"head_position","phase":"time_out","item":"Head position and Mayfield fixation confirmed — no pressure points","mandatory":true},
   {"id":"team_timeout","phase":"time_out","item":"Team time-out — procedure, site, laterality confirmed verbally","mandatory":true},
   {"id":"microscope","phase":"time_out","item":"Operating microscope focused and white-balanced","mandatory":true},
   {"id":"haemostasis","phase":"sign_out","item":"Complete haemostasis confirmed before dural closure","mandatory":true},
   {"id":"specimen_labelled","phase":"sign_out","item":"Surgical specimen correctly labelled and sent to pathology","mandatory":true},
   {"id":"drain_check","phase":"sign_out","item":"Post-operative drain (if placed) confirmed functioning","mandatory":true}
 ]',
 '[
   {"id":"icu_monitoring","title":"Post-operative monitoring","timing":"first_24h","content":"You will be monitored closely in the neuro ICU or HDU for 24–48 hours. Nurses will check your neurological function (power, speech, orientation) every 1–2 hours."},
   {"id":"head_elevation","title":"Head position","timing":"first_48h","content":"Keep your head elevated at 30° at all times. This reduces brain swelling. Do not lie flat."},
   {"id":"steroids","title":"Steroid tablets","timing":"tapering","content":"You may be given steroid tablets (dexamethasone) to reduce brain swelling after surgery. Take with food. Do not stop suddenly — your doctor will taper the dose gradually."},
   {"id":"seizure_watch","title":"Seizure awareness","timing":"ongoing","content":"You will be on anti-seizure tablets for at least 3–6 months. Do NOT drive until your neurologist confirms it is safe. If you have a seizure, do not drive to hospital — call 112."},
   {"id":"wound_care","title":"Head wound care","timing":"2_weeks","content":"Head sutures removed at 10–14 days. Keep wound dry. No hair washing for 10 days. Report any redness, swelling, or discharge immediately."},
   {"id":"activity_restrictions","title":"Activity restrictions","timing":"3_months","content":"No strenuous activity, bending, or heavy lifting for 8 weeks. Climbing stairs is acceptable from discharge. Return to work depends on your occupation — discuss with your surgeon."},
   {"id":"red_flags","title":"Go to emergency immediately if","timing":"ongoing","content":"Call 112 or go to emergency for:\n• Sudden severe headache\n• Fit or seizure\n• New weakness, numbness, or speech difficulty\n• High fever\n• Wound discharge or increasing swelling\n• Confusion or deteriorating consciousness"}
 ]');
