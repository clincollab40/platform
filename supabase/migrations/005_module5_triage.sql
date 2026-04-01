-- ═══════════════════════════════════════════════════════
-- ClinCollab — Migration 005
-- Module 5: Virtual Triage Nurse
-- Fully customisable per specialist · FHIR Questionnaire aligned
-- ═══════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────
CREATE TYPE question_type AS ENUM (
  'text',           -- free text
  'number',         -- numeric input
  'yes_no',         -- yes / no
  'single_choice',  -- select one from list
  'multi_choice',   -- select multiple
  'scale',          -- 1–10 scale
  'date',           -- date picker
  'vitals_bp',      -- systolic/diastolic pair
  'vitals_single',  -- single vital (HR, SpO2, etc.)
  'section_header'  -- visual separator, not a question
);

CREATE TYPE triage_status AS ENUM (
  'pending', 'in_progress', 'completed', 'abandoned', 'expired'
);

CREATE TYPE red_flag_level AS ENUM ('none', 'routine', 'needs_review', 'urgent');

CREATE TYPE protocol_type AS ENUM (
  'new_patient', 'pre_procedure', 'follow_up',
  'emergency_walkIn', 'post_procedure', 'general'
);

-- ─────────────────────────────────────────────
-- TABLE: triage_protocols
-- One per specialist per consultation type
-- ─────────────────────────────────────────────
CREATE TABLE triage_protocols (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  specialty_context TEXT,              -- e.g. 'Interventional Cardiology'
  protocol_type     protocol_type NOT NULL DEFAULT 'new_patient',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  version           INTEGER NOT NULL DEFAULT 1,
  welcome_message   TEXT DEFAULT 'Hello! I am the virtual triage nurse. I will ask you a few clinical questions before your consultation. Please answer as accurately as possible.',
  completion_message TEXT DEFAULT 'Thank you. Your clinical summary has been sent to your doctor. Please wait to be called.',
  estimated_minutes INTEGER DEFAULT 5,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_protocols_specialist ON triage_protocols(specialist_id);
CREATE INDEX idx_protocols_active ON triage_protocols(specialist_id, is_active);

-- Ensure only one default per specialist
CREATE UNIQUE INDEX idx_protocols_one_default
  ON triage_protocols(specialist_id)
  WHERE is_default = TRUE;

-- ─────────────────────────────────────────────
-- TABLE: triage_questions
-- Ordered questions within a protocol
-- branch_logic JSONB structure:
-- { "conditions": [{ "question_id": "uuid", "operator": "eq|gt|lt|contains|not_eq", "value": "..." }],
--   "logic": "AND|OR", "action": "show|hide|skip_to", "target_question_id": "uuid" }
-- red_flag_rules JSONB structure:
-- { "operator": "eq|gt|lt|contains|not_eq", "value": "...", "level": "urgent|needs_review", "message": "..." }
-- ─────────────────────────────────────────────
CREATE TABLE triage_questions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  protocol_id     UUID NOT NULL REFERENCES triage_protocols(id) ON DELETE CASCADE,
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  question_text   TEXT NOT NULL,
  question_text_hi TEXT,              -- Hindi translation (optional)
  question_text_te TEXT,              -- Telugu translation (optional)
  question_type   question_type NOT NULL DEFAULT 'text',
  options         JSONB DEFAULT '[]', -- [{"value":"...","label":"..."}]
  is_required     BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  section         TEXT,               -- Groups questions visually e.g. "Cardiac History"
  help_text       TEXT,               -- Shown below question as guidance
  unit            TEXT,               -- e.g. "mmHg", "kg", "bpm"
  min_value       NUMERIC,
  max_value       NUMERIC,
  branch_logic    JSONB DEFAULT '[]', -- Array of branching rules
  red_flag_rules  JSONB DEFAULT '[]', -- Array of red flag conditions
  fhir_link_id    TEXT,               -- FHIR Questionnaire linkId for interoperability
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_questions_protocol ON triage_questions(protocol_id, sort_order);
CREATE INDEX idx_questions_specialist ON triage_questions(specialist_id);

-- ─────────────────────────────────────────────
-- TABLE: triage_sessions
-- One per patient triage attempt
-- ─────────────────────────────────────────────
CREATE TABLE triage_sessions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  protocol_id       UUID NOT NULL REFERENCES triage_protocols(id),
  appointment_id    UUID REFERENCES appointments(id),
  referral_case_id  UUID REFERENCES referral_cases(id),

  -- Patient identity (self-reported at triage start)
  patient_name      TEXT NOT NULL,
  patient_mobile    TEXT,
  patient_age       INTEGER,
  patient_gender    TEXT,

  -- Access
  access_token      TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  token_expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),

  -- Status
  status            triage_status NOT NULL DEFAULT 'pending',
  current_question_index INTEGER NOT NULL DEFAULT 0,
  total_questions   INTEGER NOT NULL DEFAULT 0,

  -- Results
  red_flag_level    red_flag_level NOT NULL DEFAULT 'none',
  red_flag_summary  TEXT,
  ai_synopsis       TEXT,   -- AI-generated one-paragraph clinical summary

  -- Meta
  language          TEXT NOT NULL DEFAULT 'en',
  channel           TEXT NOT NULL DEFAULT 'web', -- web | whatsapp
  completed_at      TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_triage_sessions_specialist ON triage_sessions(specialist_id);
CREATE INDEX idx_sessions_appointment ON triage_sessions(appointment_id);
CREATE INDEX idx_sessions_referral ON triage_sessions(referral_case_id);
CREATE INDEX idx_sessions_token ON triage_sessions(access_token);
CREATE INDEX idx_sessions_status ON triage_sessions(specialist_id, status);
CREATE INDEX idx_sessions_created ON triage_sessions(specialist_id, created_at DESC);

-- ─────────────────────────────────────────────
-- TABLE: triage_answers
-- One row per question answered in a session
-- ─────────────────────────────────────────────
CREATE TABLE triage_answers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID NOT NULL REFERENCES triage_sessions(id) ON DELETE CASCADE,
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  question_id     UUID NOT NULL REFERENCES triage_questions(id),
  answer_value    TEXT NOT NULL,        -- Raw value
  answer_display  TEXT,                 -- Human-readable display value
  is_red_flag     BOOLEAN NOT NULL DEFAULT FALSE,
  red_flag_level  red_flag_level NOT NULL DEFAULT 'none',
  red_flag_message TEXT,
  answered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, question_id)
);

CREATE INDEX idx_answers_session ON triage_answers(session_id);
CREATE INDEX idx_answers_specialist ON triage_answers(specialist_id);
CREATE INDEX idx_answers_red_flag ON triage_answers(session_id) WHERE is_red_flag = TRUE;

-- ─────────────────────────────────────────────
-- TABLE: triage_protocol_templates
-- Read-only seed data — specialty starter templates
-- ─────────────────────────────────────────────
CREATE TABLE triage_protocol_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialty   TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  protocol_type protocol_type NOT NULL DEFAULT 'new_patient',
  questions   JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_specialty ON triage_protocol_templates(specialty);

-- ─────────────────────────────────────────────
-- FUNCTION: evaluate red flags for a session answer
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION evaluate_triage_red_flags(
  p_session_id  UUID,
  p_question_id UUID,
  p_answer      TEXT
)
RETURNS TABLE(is_flag BOOLEAN, flag_level red_flag_level, flag_message TEXT) AS $$
DECLARE
  v_rules JSONB;
  v_rule  JSONB;
  v_triggered BOOLEAN := FALSE;
  v_level red_flag_level := 'none';
  v_message TEXT := NULL;
  v_op TEXT;
  v_val TEXT;
  v_answer_num NUMERIC;
  v_val_num NUMERIC;
BEGIN
  SELECT red_flag_rules INTO v_rules
  FROM triage_questions WHERE id = p_question_id;

  IF v_rules IS NULL OR jsonb_array_length(v_rules) = 0 THEN
    RETURN QUERY SELECT FALSE, 'none'::red_flag_level, NULL::TEXT;
    RETURN;
  END IF;

  -- Try to parse answer as numeric for numeric comparisons
  BEGIN v_answer_num := p_answer::NUMERIC; EXCEPTION WHEN OTHERS THEN v_answer_num := NULL; END;

  FOR v_rule IN SELECT * FROM jsonb_array_elements(v_rules) LOOP
    v_op  := v_rule->>'operator';
    v_val := v_rule->>'value';

    BEGIN v_val_num := v_val::NUMERIC; EXCEPTION WHEN OTHERS THEN v_val_num := NULL; END;

    v_triggered := CASE
      WHEN v_op = 'eq'       THEN LOWER(p_answer) = LOWER(v_val)
      WHEN v_op = 'not_eq'   THEN LOWER(p_answer) != LOWER(v_val)
      WHEN v_op = 'gt'       THEN v_answer_num IS NOT NULL AND v_val_num IS NOT NULL AND v_answer_num > v_val_num
      WHEN v_op = 'gte'      THEN v_answer_num IS NOT NULL AND v_val_num IS NOT NULL AND v_answer_num >= v_val_num
      WHEN v_op = 'lt'       THEN v_answer_num IS NOT NULL AND v_val_num IS NOT NULL AND v_answer_num < v_val_num
      WHEN v_op = 'lte'      THEN v_answer_num IS NOT NULL AND v_val_num IS NOT NULL AND v_answer_num <= v_val_num
      WHEN v_op = 'contains' THEN LOWER(p_answer) LIKE '%' || LOWER(v_val) || '%'
      ELSE FALSE
    END;

    IF v_triggered THEN
      v_level   := (v_rule->>'level')::red_flag_level;
      v_message := v_rule->>'message';
      EXIT;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_triggered, v_level, v_message;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────
-- FUNCTION: compute overall session red flag level
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_session_red_flag_level(p_session_id UUID)
RETURNS red_flag_level AS $$
DECLARE
  v_has_urgent     BOOLEAN;
  v_has_review     BOOLEAN;
BEGIN
  SELECT
    EXISTS(SELECT 1 FROM triage_answers WHERE session_id = p_session_id AND red_flag_level = 'urgent'),
    EXISTS(SELECT 1 FROM triage_answers WHERE session_id = p_session_id AND red_flag_level = 'needs_review')
  INTO v_has_urgent, v_has_review;

  IF v_has_urgent THEN RETURN 'urgent';
  ELSIF v_has_review THEN RETURN 'needs_review';
  ELSE RETURN 'none';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────
CREATE TRIGGER protocols_updated_at
  BEFORE UPDATE ON triage_protocols
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON triage_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE triage_protocols          ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_questions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_answers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_protocol_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY protocols_isolation ON triage_protocols
  FOR ALL USING (specialist_id = auth.uid());

CREATE POLICY questions_isolation ON triage_questions
  FOR ALL USING (specialist_id = auth.uid());

CREATE POLICY sessions_isolation ON triage_sessions
  FOR ALL USING (specialist_id = auth.uid());

CREATE POLICY answers_isolation ON triage_answers
  FOR ALL USING (specialist_id = auth.uid());

-- Templates are read-only for all authenticated users
CREATE POLICY templates_read ON triage_protocol_templates
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ─────────────────────────────────────────────
-- SEED: Specialty protocol templates
-- ─────────────────────────────────────────────
INSERT INTO triage_protocol_templates (specialty, name, description, protocol_type, questions) VALUES

-- INTERVENTIONAL CARDIOLOGY — New OPD Patient
('interventional_cardiology', 'Interventional Cardiology — New OPD', 'Standard new patient assessment for interventional cardiology OPD', 'new_patient', '[
  {"sort_order":1,"question_text":"What is the main reason for your visit today?","question_type":"text","is_required":true,"section":"Presenting Complaint"},
  {"sort_order":2,"question_text":"How long have you had this problem?","question_type":"single_choice","is_required":true,"section":"Presenting Complaint","options":[{"value":"days","label":"Days"},{"value":"weeks","label":"Weeks"},{"value":"months","label":"Months"},{"value":"years","label":"Years"}]},
  {"sort_order":3,"question_text":"Do you have chest pain or chest tightness?","question_type":"yes_no","is_required":true,"section":"Cardiac Symptoms","red_flag_rules":[{"operator":"eq","value":"yes","level":"needs_review","message":"Patient reports chest pain — review before consultation"}]},
  {"sort_order":4,"question_text":"How would you describe the chest pain?","question_type":"single_choice","is_required":false,"section":"Cardiac Symptoms","options":[{"value":"pressure","label":"Pressure / heaviness"},{"value":"sharp","label":"Sharp / stabbing"},{"value":"burning","label":"Burning"},{"value":"tightness","label":"Tightness"}],"branch_logic":[{"conditions":[{"question_ref_order":3,"operator":"eq","value":"yes"}],"action":"show"}]},
  {"sort_order":5,"question_text":"Does the pain spread to your arm, jaw, or neck?","question_type":"yes_no","is_required":false,"section":"Cardiac Symptoms","red_flag_rules":[{"operator":"eq","value":"yes","level":"urgent","message":"Radiation to arm/jaw — possible ACS — urgent review required"}],"branch_logic":[{"conditions":[{"question_ref_order":3,"operator":"eq","value":"yes"}],"action":"show"}]},
  {"sort_order":6,"question_text":"Do you get short of breath with activity?","question_type":"yes_no","is_required":true,"section":"Cardiac Symptoms"},
  {"sort_order":7,"question_text":"Have you had any fainting episodes (syncope)?","question_type":"yes_no","is_required":true,"section":"Cardiac Symptoms","red_flag_rules":[{"operator":"eq","value":"yes","level":"needs_review","message":"Syncope reported"}]},
  {"sort_order":8,"question_text":"Have you had a heart attack, angioplasty, or bypass surgery before?","question_type":"yes_no","is_required":true,"section":"Cardiac History"},
  {"sort_order":9,"question_text":"Do you have diabetes?","question_type":"yes_no","is_required":true,"section":"Medical History"},
  {"sort_order":10,"question_text":"Do you have high blood pressure?","question_type":"yes_no","is_required":true,"section":"Medical History"},
  {"sort_order":11,"question_text":"Do you have kidney disease?","question_type":"yes_no","is_required":true,"section":"Medical History"},
  {"sort_order":12,"question_text":"Are you allergic to contrast dye (used in angiography)?","question_type":"yes_no","is_required":true,"section":"Allergies","red_flag_rules":[{"operator":"eq","value":"yes","level":"urgent","message":"Contrast allergy reported — mandatory pre-procedure review"}]},
  {"sort_order":13,"question_text":"What blood thinning medications are you currently taking?","question_type":"multi_choice","is_required":false,"section":"Current Medications","options":[{"value":"aspirin","label":"Aspirin"},{"value":"clopidogrel","label":"Clopidogrel (Plavix)"},{"value":"warfarin","label":"Warfarin"},{"value":"rivaroxaban","label":"Rivaroxaban (Xarelto)"},{"value":"none","label":"None of the above"}]},
  {"sort_order":14,"question_text":"Blood pressure (if you have measured it recently)","question_type":"vitals_bp","is_required":false,"section":"Vitals","unit":"mmHg","red_flag_rules":[{"operator":"gte","value":"180","level":"urgent","message":"Systolic BP ≥ 180 mmHg — hypertensive urgency"}]},
  {"sort_order":15,"question_text":"Heart rate (pulse rate)","question_type":"vitals_single","is_required":false,"section":"Vitals","unit":"bpm","red_flag_rules":[{"operator":"gt","value":"120","level":"needs_review","message":"Heart rate > 120 bpm"},{"operator":"lt","value":"40","level":"urgent","message":"Heart rate < 40 bpm — bradycardia"}]}
]'),

-- CARDIAC SURGERY — Pre-operative Assessment
('cardiac_surgery', 'Cardiac Surgery — Pre-operative Assessment', 'Pre-operative triage for cardiac surgery patients', 'pre_procedure', '[
  {"sort_order":1,"question_text":"What surgery have you been scheduled for?","question_type":"text","is_required":true,"section":"Procedure"},
  {"sort_order":2,"question_text":"How many flights of stairs can you climb without stopping due to breathlessness?","question_type":"single_choice","is_required":true,"section":"Functional Status","options":[{"value":"none","label":"Cannot climb stairs"},{"value":"one","label":"1 flight"},{"value":"two","label":"2 flights"},{"value":"more","label":"3 or more flights"}],"red_flag_rules":[{"operator":"eq","value":"none","level":"needs_review","message":"Patient cannot climb stairs — low functional capacity"}]},
  {"sort_order":3,"question_text":"Do you have breathlessness at rest or when lying flat?","question_type":"yes_no","is_required":true,"section":"Functional Status","red_flag_rules":[{"operator":"eq","value":"yes","level":"urgent","message":"Breathlessness at rest — review urgently"}]},
  {"sort_order":4,"question_text":"Have you had any cardiac surgery or intervention before?","question_type":"yes_no","is_required":true,"section":"Cardiac History"},
  {"sort_order":5,"question_text":"Do you have diabetes?","question_type":"yes_no","is_required":true,"section":"Medical History"},
  {"sort_order":6,"question_text":"If yes to diabetes — what was your last HbA1c reading?","question_type":"number","is_required":false,"section":"Medical History","unit":"%","red_flag_rules":[{"operator":"gte","value":"10","level":"needs_review","message":"HbA1c ≥ 10% — poor glycaemic control, anaesthesia risk"}]},
  {"sort_order":7,"question_text":"Do you currently smoke?","question_type":"yes_no","is_required":true,"section":"Medical History"},
  {"sort_order":8,"question_text":"Do you have any lung disease (COPD, asthma)?","question_type":"yes_no","is_required":true,"section":"Medical History"},
  {"sort_order":9,"question_text":"Do you have kidney disease?","question_type":"yes_no","is_required":true,"section":"Medical History"},
  {"sort_order":10,"question_text":"What is your approximate weight?","question_type":"number","is_required":false,"section":"Vitals","unit":"kg"},
  {"sort_order":11,"question_text":"What is your approximate height?","question_type":"number","is_required":false,"section":"Vitals","unit":"cm"},
  {"sort_order":12,"question_text":"Are you on blood thinning medications? If yes, list them.","question_type":"text","is_required":false,"section":"Medications"}
]'),

-- NEUROSURGERY — New OPD Patient
('neurosurgery', 'Neurosurgery — New OPD Assessment', 'Standard new patient triage for neurosurgery OPD', 'new_patient', '[
  {"sort_order":1,"question_text":"What is the main problem you have come for today?","question_type":"text","is_required":true,"section":"Presenting Complaint"},
  {"sort_order":2,"question_text":"Do you have headache?","question_type":"yes_no","is_required":true,"section":"Neurological Symptoms"},
  {"sort_order":3,"question_text":"On a scale of 1 to 10, how severe is your headache? (1 = mild, 10 = worst ever)","question_type":"scale","is_required":false,"section":"Neurological Symptoms","min_value":1,"max_value":10,"red_flag_rules":[{"operator":"gte","value":"8","level":"urgent","message":"Severe headache score ≥ 8 — possible raised ICP or SAH"}],"branch_logic":[{"conditions":[{"question_ref_order":2,"operator":"eq","value":"yes"}],"action":"show"}]},
  {"sort_order":4,"question_text":"Did the headache start suddenly (thunderclap) or come on gradually?","question_type":"single_choice","is_required":false,"section":"Neurological Symptoms","options":[{"value":"sudden","label":"Suddenly — worst headache of my life"},{"value":"gradual","label":"Gradually over days or weeks"}],"red_flag_rules":[{"operator":"eq","value":"sudden","level":"urgent","message":"Thunderclap headache — exclude subarachnoid haemorrhage urgently"}],"branch_logic":[{"conditions":[{"question_ref_order":2,"operator":"eq","value":"yes"}],"action":"show"}]},
  {"sort_order":5,"question_text":"Do you have weakness or numbness in any arm or leg?","question_type":"yes_no","is_required":true,"section":"Neurological Symptoms","red_flag_rules":[{"operator":"eq","value":"yes","level":"needs_review","message":"Motor or sensory deficit reported"}]},
  {"sort_order":6,"question_text":"Have you had any seizures (fits)?","question_type":"yes_no","is_required":true,"section":"Neurological Symptoms","red_flag_rules":[{"operator":"eq","value":"yes","level":"needs_review","message":"Seizure history reported"}]},
  {"sort_order":7,"question_text":"Have you had any loss of consciousness?","question_type":"yes_no","is_required":true,"section":"Neurological Symptoms","red_flag_rules":[{"operator":"eq","value":"yes","level":"urgent","message":"Loss of consciousness reported"}]},
  {"sort_order":8,"question_text":"Have you had any difficulty with speech or understanding?","question_type":"yes_no","is_required":true,"section":"Neurological Symptoms","red_flag_rules":[{"operator":"eq","value":"yes","level":"needs_review","message":"Speech or comprehension difficulty"}]},
  {"sort_order":9,"question_text":"Have you had a CT scan or MRI of the brain/spine for this problem?","question_type":"yes_no","is_required":true,"section":"Investigations"},
  {"sort_order":10,"question_text":"Have you had any previous brain or spine surgery?","question_type":"yes_no","is_required":true,"section":"History"},
  {"sort_order":11,"question_text":"Are you on any blood thinning medications?","question_type":"yes_no","is_required":true,"section":"Medications","red_flag_rules":[{"operator":"eq","value":"yes","level":"needs_review","message":"Anticoagulants — relevant to surgical planning"}]}
]'),

-- ORTHOPAEDICS — New OPD Patient
('orthopedics', 'Orthopaedics — New OPD Assessment', 'Standard new patient triage for orthopaedic OPD', 'new_patient', '[
  {"sort_order":1,"question_text":"Which part of your body is the problem in?","question_type":"single_choice","is_required":true,"section":"Location","options":[{"value":"knee","label":"Knee"},{"value":"hip","label":"Hip"},{"value":"shoulder","label":"Shoulder"},{"value":"spine","label":"Spine / back"},{"value":"ankle_foot","label":"Ankle / foot"},{"value":"wrist_hand","label":"Wrist / hand"},{"value":"other","label":"Other"}]},
  {"sort_order":2,"question_text":"What is your main symptom?","question_type":"multi_choice","is_required":true,"section":"Symptoms","options":[{"value":"pain","label":"Pain"},{"value":"swelling","label":"Swelling"},{"value":"stiffness","label":"Stiffness"},{"value":"weakness","label":"Weakness"},{"value":"numbness","label":"Numbness or tingling"},{"value":"instability","label":"Giving way / instability"},{"value":"deformity","label":"Deformity"}]},
  {"sort_order":3,"question_text":"On a scale of 1 to 10, how severe is your pain at its worst? (1 = mild, 10 = unbearable)","question_type":"scale","is_required":true,"section":"Symptoms","min_value":1,"max_value":10,"red_flag_rules":[{"operator":"gte","value":"8","level":"needs_review","message":"Severe pain score ≥ 8"}]},
  {"sort_order":4,"question_text":"How long have you had this problem?","question_type":"single_choice","is_required":true,"section":"History","options":[{"value":"days","label":"Days"},{"value":"weeks","label":"Weeks"},{"value":"months","label":"Months"},{"value":"years","label":"Years"}]},
  {"sort_order":5,"question_text":"Did it start after an injury or accident?","question_type":"yes_no","is_required":true,"section":"History"},
  {"sort_order":6,"question_text":"Do you have numbness or weakness in your arms or legs?","question_type":"yes_no","is_required":true,"section":"Neurological","red_flag_rules":[{"operator":"eq","value":"yes","level":"needs_review","message":"Neurological symptoms — neurological involvement possible"}]},
  {"sort_order":7,"question_text":"How far can you walk before the pain stops you?","question_type":"single_choice","is_required":false,"section":"Function","options":[{"value":"cannot_walk","label":"Cannot walk"},{"value":"short","label":"Less than 100 metres"},{"value":"medium","label":"100–500 metres"},{"value":"long","label":"More than 500 metres"}]},
  {"sort_order":8,"question_text":"Have you had surgery on this area before?","question_type":"yes_no","is_required":true,"section":"History"},
  {"sort_order":9,"question_text":"Have you had X-ray, MRI, or CT scan for this problem?","question_type":"yes_no","is_required":true,"section":"Investigations"},
  {"sort_order":10,"question_text":"What is your approximate weight?","question_type":"number","is_required":false,"section":"Vitals","unit":"kg"}
]');
