-- ═══════════════════════════════════════════════════════════════
-- ClinCollab — Migration 007
-- Module 7: Consultation Transcription Agent
--
-- Architecture principles enforced here:
-- • transcription_sessions references ONLY specialists — no FK to
--   other module tables (soft references only, for resilience)
-- • Raw audio is NEVER stored — only duration + processing status
-- • All extracted PHI stored encrypted (enforced at app layer)
-- • Structured notes go through specialist REVIEW before any output
-- • Cascade failure: if transcription fails, appointments/referrals unaffected
-- • Note templates are per-specialist, per-specialty, fully customisable
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────
CREATE TYPE transcription_status AS ENUM (
  'recording',        -- audio being captured
  'processing',       -- uploaded, Whisper transcribing
  'extracting',       -- LLM extracting structured note
  'pending_review',   -- awaiting specialist review
  'approved',         -- specialist reviewed and approved
  'sent_to_patient',  -- patient summary dispatched
  'failed',           -- processing failed
  'cancelled'         -- specialist discarded
);

CREATE TYPE consultation_type AS ENUM (
  'new_opd',          -- first outpatient consultation
  'follow_up',        -- follow-up visit
  'pre_procedure',    -- pre-procedure assessment/consent
  'procedure_note',   -- intra/post-procedure note
  'discharge',        -- discharge summary dictation
  'emergency',        -- emergency consultation
  'teleconsult'       -- telephone/video consultation
);

CREATE TYPE note_section_type AS ENUM (
  'history',
  'examination',
  'investigations',
  'assessment',
  'plan',
  'medications',
  'patient_instructions',
  'follow_up',
  'procedure_details',
  'risk_discussion',
  'custom'
);

-- ─────────────────────────────────────────────────────────────
-- TABLE: note_templates
-- Specialist-defined structured note templates
-- One template per consultation type per specialty
-- Fully customisable — specialist defines which sections appear,
-- what AI should extract for each, and what goes to the patient
-- ─────────────────────────────────────────────────────────────
CREATE TABLE note_templates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  specialty_context TEXT,                   -- e.g. 'interventional_cardiology'
  consultation_type consultation_type NOT NULL DEFAULT 'new_opd',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Template sections — JSONB array of section definitions
  -- Each section:
  -- { id, type, label, extraction_prompt, include_in_patient_summary,
  --   required, sort_order, ai_hint }
  sections          JSONB NOT NULL DEFAULT '[]',

  -- What the patient summary should include
  patient_summary_sections  TEXT[] DEFAULT '{}',
  patient_summary_preamble  TEXT,      -- "Dear [Patient Name]," header
  patient_summary_closing   TEXT,      -- "Please contact us if..."

  -- Processing config
  speaker_labels    BOOLEAN NOT NULL DEFAULT TRUE,  -- distinguish doctor vs patient
  auto_approve      BOOLEAN NOT NULL DEFAULT FALSE, -- skip review step
  language          TEXT NOT NULL DEFAULT 'en',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_note_templates_specialist ON note_templates(specialist_id);
CREATE INDEX idx_note_templates_active ON note_templates(specialist_id, is_active);
CREATE UNIQUE INDEX idx_note_templates_default
  ON note_templates(specialist_id, consultation_type)
  WHERE is_default = TRUE;

-- ─────────────────────────────────────────────────────────────
-- TABLE: transcription_sessions
-- One per consultation recording
-- NOTE: raw audio is NEVER stored here — only metadata
-- Audio bytes exist only in memory during Whisper processing
-- ─────────────────────────────────────────────────────────────
CREATE TABLE transcription_sessions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id         UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  template_id           UUID REFERENCES note_templates(id),

  -- Soft references to other modules (no FK — for resilience)
  appointment_id        UUID,           -- from M4
  referral_case_id      UUID,           -- from M3
  triage_session_id     UUID,           -- from M5
  synthesis_job_id      UUID,           -- from M6

  -- Patient identity (copied at session start for note generation)
  patient_name          TEXT NOT NULL,
  patient_mobile        TEXT,
  patient_age           INTEGER,
  patient_gender        TEXT,

  -- Audio metadata — no raw audio stored
  audio_duration_secs   INTEGER,
  audio_language        TEXT NOT NULL DEFAULT 'en',
  recording_started_at  TIMESTAMPTZ,
  recording_ended_at    TIMESTAMPTZ,

  -- Processing
  status                transcription_status NOT NULL DEFAULT 'recording',
  consultation_type     consultation_type NOT NULL DEFAULT 'new_opd',

  -- Raw transcript (Whisper output) — stored for reference, not shared
  raw_transcript        TEXT,           -- full verbatim transcript
  speaker_segments      JSONB,          -- [{ speaker, start, end, text }]

  -- Error handling
  error_message         TEXT,
  retry_count           INTEGER NOT NULL DEFAULT 0,
  processing_started_at TIMESTAMPTZ,
  processing_ended_at   TIMESTAMPTZ,

  -- Specialist review
  reviewed_at           TIMESTAMPTZ,
  reviewed_by           UUID REFERENCES specialists(id),
  review_notes          TEXT,           -- specialist's amendments

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transcription_specialist ON transcription_sessions(specialist_id);
CREATE INDEX idx_transcription_status ON transcription_sessions(status);
CREATE INDEX idx_transcription_appointment ON transcription_sessions(appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX idx_transcription_referral ON transcription_sessions(referral_case_id) WHERE referral_case_id IS NOT NULL;
CREATE INDEX idx_transcription_created ON transcription_sessions(specialist_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- TABLE: consultation_notes
-- One structured note per transcription session
-- AI-generated, specialist-reviewed, specialist-approved
-- ─────────────────────────────────────────────────────────────
CREATE TABLE consultation_notes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id        UUID NOT NULL REFERENCES transcription_sessions(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  template_id       UUID REFERENCES note_templates(id),

  -- Structured note sections — keyed by section type
  -- { history, examination, investigations, assessment, plan, medications,
  --   patient_instructions, follow_up, procedure_details, custom: {} }
  sections          JSONB NOT NULL DEFAULT '{}',

  -- AI metadata
  ai_model          TEXT,               -- e.g. 'llama-3.3-70b-versatile'
  ai_confidence     NUMERIC(3,2),       -- 0–1 overall confidence
  ai_flags          JSONB DEFAULT '[]', -- [{ type, message, section }]
  -- Flag types: 'medication_alert', 'dosage_check', 'allergy_conflict',
  --             'missing_critical_field', 'unclear_instruction'

  -- Patient summary (plain English, WhatsApp-ready)
  patient_summary   TEXT,

  -- Referring doctor summary (for M3 case update)
  referrer_summary  TEXT,

  -- ICD-10 codes extracted
  icd10_codes       TEXT[],

  -- Specialist amendments (what they changed during review)
  amendments        JSONB DEFAULT '[]', -- [{ section, field, old_value, new_value, amended_at }]

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id)
);

CREATE INDEX idx_notes_session ON consultation_notes(session_id);
CREATE INDEX idx_notes_specialist ON consultation_notes(specialist_id);

-- ─────────────────────────────────────────────────────────────
-- TABLE: note_template_defaults
-- Pre-seeded specialty templates — read-only, used as starting points
-- ─────────────────────────────────────────────────────────────
CREATE TABLE note_template_defaults (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialty         TEXT NOT NULL,
  consultation_type consultation_type NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  sections          JSONB NOT NULL DEFAULT '[]',
  patient_summary_preamble TEXT,
  patient_summary_closing  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_template_defaults_specialty ON note_template_defaults(specialty);

-- ─────────────────────────────────────────────────────────────
-- TABLE: transcription_delivery_log
-- Immutable audit of every patient/referrer notification sent
-- ─────────────────────────────────────────────────────────────
CREATE TABLE transcription_delivery_log (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id        UUID NOT NULL REFERENCES transcription_sessions(id),
  specialist_id     UUID NOT NULL REFERENCES specialists(id),
  recipient_type    TEXT NOT NULL,   -- 'patient', 'referring_doctor'
  channel           TEXT NOT NULL,   -- 'whatsapp', 'in_app'
  summary_type      TEXT NOT NULL,   -- 'patient_summary', 'referrer_summary'
  delivered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  whatsapp_message_id TEXT,
  content_hash      TEXT            -- hash of sent content for audit
);

CREATE INDEX idx_delivery_session ON transcription_delivery_log(session_id);

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: auto-link transcription to synthesis
-- When a transcription is approved, create a synthesis refresh job
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_synthesis_on_note_approval()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending_review' THEN
    -- Soft dispatch — synthesis job created asynchronously
    PERFORM pg_notify(
      'transcription_approved',
      json_build_object(
        'session_id',    NEW.id,
        'specialist_id', NEW.specialist_id,
        'patient_name',  NEW.patient_name
      )::TEXT
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER note_approval_trigger
  AFTER UPDATE ON transcription_sessions
  FOR EACH ROW EXECUTE FUNCTION trigger_synthesis_on_note_approval();

-- ─────────────────────────────────────────────────────────────
-- TRIGGERS: updated_at
-- ─────────────────────────────────────────────────────────────
CREATE TRIGGER note_templates_updated_at
  BEFORE UPDATE ON note_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER transcription_sessions_updated_at
  BEFORE UPDATE ON transcription_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER consultation_notes_updated_at
  BEFORE UPDATE ON consultation_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────
ALTER TABLE note_templates             ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcription_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultation_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcription_delivery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_template_defaults     ENABLE ROW LEVEL SECURITY;

CREATE POLICY templates_isolation ON note_templates
  FOR ALL USING (specialist_id = auth.uid());

CREATE POLICY sessions_isolation ON transcription_sessions
  FOR ALL USING (specialist_id = auth.uid());

CREATE POLICY notes_isolation ON consultation_notes
  FOR ALL USING (specialist_id = auth.uid());

CREATE POLICY delivery_isolation ON transcription_delivery_log
  FOR ALL USING (specialist_id = auth.uid());

-- Template defaults: all authenticated users can read
CREATE POLICY defaults_read ON note_template_defaults
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ─────────────────────────────────────────────────────────────
-- SEED: Specialty note template defaults
-- ─────────────────────────────────────────────────────────────
INSERT INTO note_template_defaults (specialty, consultation_type, name, description, sections, patient_summary_preamble, patient_summary_closing) VALUES

('interventional_cardiology', 'new_opd', 'Interventional Cardiology — New OPD Consultation',
 'Standard new OPD note for interventional cardiology',
 '[
   {"id":"history","type":"history","label":"Presenting Complaint and History","sort_order":1,"required":true,"extraction_prompt":"Extract the chief complaint, duration, character of symptoms (especially chest pain — SOCRATES), associated symptoms (breathlessness, palpitations, syncope, oedema), and any precipitating or relieving factors mentioned.","include_in_patient_summary":false,"ai_hint":"Include all cardiac symptoms mentioned. Note exact duration and severity."},
   {"id":"cardiac_history","type":"history","label":"Past Cardiac History","sort_order":2,"required":true,"extraction_prompt":"Extract prior cardiac events (MI, CABG, PCI, valve procedures), stent details if mentioned, prior angiography results, ECHO findings, ECG history.","include_in_patient_summary":false,"ai_hint":"Note stent names and dates if spoken."},
   {"id":"risk_factors","type":"history","label":"Cardiovascular Risk Factors","sort_order":3,"required":true,"extraction_prompt":"Extract: hypertension (and medication), diabetes (type and medication), dyslipidaemia, smoking status and pack-years, family history of CAD, obesity.","include_in_patient_summary":false},
   {"id":"medications","type":"medications","label":"Current Medications","sort_order":4,"required":true,"extraction_prompt":"List all medications mentioned with dose and frequency. Flag antiplatelet agents (aspirin, clopidogrel, ticagrelor) and anticoagulants (warfarin, rivaroxaban, apixaban) explicitly.","include_in_patient_summary":true,"ai_hint":"Accuracy critical — flag any potential interactions mentioned."},
   {"id":"examination","type":"examination","label":"Clinical Examination Findings","sort_order":5,"required":true,"extraction_prompt":"Extract BP, heart rate, SpO2, weight, JVP, heart sounds, murmurs, peripheral pulses, signs of heart failure (oedema, crepitations), any other examination findings mentioned.","include_in_patient_summary":false},
   {"id":"investigations","type":"investigations","label":"Investigations Reviewed","sort_order":6,"required":false,"extraction_prompt":"Extract ECG findings, echocardiography results (EF, wall motion, valve function), stress test results, coronary angiography findings (vessel, stenosis %), troponin and other lab results discussed.","include_in_patient_summary":false},
   {"id":"assessment","type":"assessment","label":"Clinical Assessment and Diagnosis","sort_order":7,"required":true,"extraction_prompt":"Extract the specialist\'s assessment, working diagnosis, and differential diagnoses if mentioned.","include_in_patient_summary":true,"ai_hint":"Use exact clinical terms spoken. Do not paraphrase diagnoses."},
   {"id":"plan","type":"plan","label":"Management Plan","sort_order":8,"required":true,"extraction_prompt":"Extract the full management plan: investigations ordered, medications started/changed/stopped, procedures planned, referrals, lifestyle advice given.","include_in_patient_summary":true},
   {"id":"procedure_plan","type":"procedure_details","label":"Procedure Plan (if applicable)","sort_order":9,"required":false,"extraction_prompt":"If a procedure was discussed or planned, extract: procedure name, indication, planned date, pre-procedure instructions (NPO, medication holds), risk discussion, consent topics covered.","include_in_patient_summary":true},
   {"id":"patient_instructions","type":"patient_instructions","label":"Patient Instructions","sort_order":10,"required":true,"extraction_prompt":"Extract all instructions given to the patient: activity restrictions, diet advice, medication instructions, warning signs to watch for, when to call the clinic, when to go to emergency.","include_in_patient_summary":true,"ai_hint":"This section goes directly to the patient — use plain language."},
   {"id":"follow_up","type":"follow_up","label":"Follow-up Plan","sort_order":11,"required":true,"extraction_prompt":"Extract the follow-up timeline: when to return, what investigations to bring, who to contact for queries.","include_in_patient_summary":true}
 ]',
 'Dear [PATIENT_NAME],\n\nThank you for your consultation with Dr. [SPECIALIST_NAME] today ([DATE]). Here is a summary of your visit.',
 'If you have any questions or concerns before your next appointment, please contact our clinic. In case of emergency — chest pain, breathlessness, or any sudden change — please call 112 immediately.\n\nDr. [SPECIALIST_NAME]\n[CLINIC_NAME]'
),

('cardiac_surgery', 'pre_procedure', 'Cardiac Surgery — Pre-operative Assessment',
 'Pre-operative consultation note for cardiac surgery',
 '[
   {"id":"presenting","type":"history","label":"Presenting Problem and Surgical Indication","sort_order":1,"required":true,"extraction_prompt":"Extract the surgical indication, primary diagnosis, and reason the patient is being seen for pre-operative assessment.","include_in_patient_summary":false},
   {"id":"functional_status","type":"examination","label":"Functional Status","sort_order":2,"required":true,"extraction_prompt":"Extract exercise tolerance (METS or functional class), exertional symptoms, breathlessness, angina class, peripheral vascular symptoms.","include_in_patient_summary":false},
   {"id":"surgical_history","type":"history","label":"Prior Surgical and Cardiac History","sort_order":3,"required":true,"extraction_prompt":"Prior cardiac surgeries, valve procedures, CABG details, co-existing conditions, prior anaesthetic issues.","include_in_patient_summary":false},
   {"id":"comorbidities","type":"history","label":"Co-morbidities and Anaesthetic Risk","sort_order":4,"required":true,"extraction_prompt":"Diabetes (HbA1c if mentioned), hypertension, renal function (creatinine/eGFR), respiratory disease (FEV1 if mentioned), smoking, BMI, frailty assessment, carotid disease, peripheral vascular disease.","include_in_patient_summary":false},
   {"id":"medications","type":"medications","label":"Medications and Holds","sort_order":5,"required":true,"extraction_prompt":"All current medications. Specifically extract any medication HOLDS discussed pre-operatively (aspirin hold, anticoagulant bridging, beta-blocker continuation, statin status).","include_in_patient_summary":true},
   {"id":"investigations","type":"investigations","label":"Pre-operative Investigations","sort_order":6,"required":true,"extraction_prompt":"ECHO (EF, valve function, wall motion), coronary angiography results, CT chest/abdomen findings, carotid Doppler, pulmonary function, blood results (Hb, Cr, HbA1c), blood type, ECG.","include_in_patient_summary":false},
   {"id":"surgical_plan","type":"procedure_details","label":"Planned Surgery","sort_order":7,"required":true,"extraction_prompt":"Exact procedure planned (e.g. on-pump CABG x3, MVR, AVR, combined procedure), surgical approach, cardioplegia type, bypass plan.","include_in_patient_summary":true},
   {"id":"risk_discussion","type":"risk_discussion","label":"Risk Discussion and Consent","sort_order":8,"required":true,"extraction_prompt":"Extract the risk discussion as documented: overall surgical risk (%), specific risks discussed (mortality, stroke, renal failure, reoperation, transfusion), patient\'s understanding and any specific concerns raised.","include_in_patient_summary":false,"ai_hint":"This is medico-legal documentation — extract verbatim from what was stated."},
   {"id":"pre_op_instructions","type":"patient_instructions","label":"Pre-operative Instructions","sort_order":9,"required":true,"extraction_prompt":"NPO instructions, medication instructions on day of surgery, admission time and location, items to bring, showering/skin prep instructions, what to avoid.","include_in_patient_summary":true},
   {"id":"follow_up","type":"follow_up","label":"Next Steps","sort_order":10,"required":true,"extraction_prompt":"Pre-admission date, surgery date if confirmed, who to call with queries, when and where to report.","include_in_patient_summary":true}
 ]',
 'Dear [PATIENT_NAME],\n\nThank you for your pre-operative consultation with Dr. [SPECIALIST_NAME] on [DATE]. Here is a summary of your consultation and your instructions before surgery.',
 'If you have any questions before your procedure, please call our clinic. If you develop fever, chest pain, or any new symptoms before the surgery date, contact us immediately.\n\nDr. [SPECIALIST_NAME]\n[CLINIC_NAME]'
),

('neurosurgery', 'new_opd', 'Neurosurgery — New OPD Consultation',
 'Standard new OPD note for neurosurgery',
 '[
   {"id":"presenting","type":"history","label":"Presenting Complaint","sort_order":1,"required":true,"extraction_prompt":"Extract the chief complaint, onset, duration, character, progression, and any precipitating events. For headache: severity (VAS), location, radiation, onset pattern (sudden vs gradual). For spinal: dermatomal distribution, functional impact.","include_in_patient_summary":false},
   {"id":"neuro_history","type":"history","label":"Neurological History","sort_order":2,"required":true,"extraction_prompt":"Prior neurosurgical procedures, seizure history (type, frequency, current AEDs), prior head or spine trauma, stroke history, prior neuroimaging.","include_in_patient_summary":false},
   {"id":"current_symptoms","type":"history","label":"Current Neurological Symptoms","sort_order":3,"required":true,"extraction_prompt":"Headache, limb weakness or numbness, gait disturbance, speech difficulty, visual changes, cognitive symptoms, bowel/bladder dysfunction, balance problems. Note laterality.","include_in_patient_summary":false},
   {"id":"medications","type":"medications","label":"Medications","sort_order":4,"required":true,"extraction_prompt":"All medications. Specifically: anticoagulants, antiepileptics, steroids, any recent medication changes.","include_in_patient_summary":true},
   {"id":"examination","type":"examination","label":"Neurological Examination","sort_order":5,"required":true,"extraction_prompt":"GCS, cranial nerves examined and findings, motor power by limb (MRC grading if mentioned), sensory examination, reflexes, cerebellar signs, gait assessment, spine tenderness and range of motion.","include_in_patient_summary":false},
   {"id":"imaging","type":"investigations","label":"Imaging and Investigations Reviewed","sort_order":6,"required":true,"extraction_prompt":"CT/MRI brain findings (lesion location, size, enhancement, surrounding oedema), spine MRI (disc level, cord compression, signal changes), angiography results, biopsy results if available. Note who reported the imaging.","include_in_patient_summary":false},
   {"id":"assessment","type":"assessment","label":"Clinical Assessment","sort_order":7,"required":true,"extraction_prompt":"Diagnosis, working differential, MDT discussion mentioned.","include_in_patient_summary":true},
   {"id":"plan","type":"plan","label":"Management Plan","sort_order":8,"required":true,"extraction_prompt":"Conservative vs surgical management decision. If surgery: procedure, timing, urgency. If conservative: medications, further investigations, repeat imaging schedule. MDT referral.","include_in_patient_summary":true},
   {"id":"surgical_discussion","type":"procedure_details","label":"Surgical Plan and Risk Discussion","sort_order":9,"required":false,"extraction_prompt":"If surgery discussed: exact procedure, approach, anticipated duration, specific risks discussed (neurological deficit, infection, CSF leak, recurrence, anaesthetic risk), patient questions and responses.","include_in_patient_summary":false,"ai_hint":"Medico-legal — extract verbatim risk statements."},
   {"id":"patient_instructions","type":"patient_instructions","label":"Patient Instructions","sort_order":10,"required":true,"extraction_prompt":"Driving restrictions, activity restrictions, warning signs (sudden severe headache, new weakness, seizure — go to emergency), medication instructions, when to call clinic.","include_in_patient_summary":true},
   {"id":"follow_up","type":"follow_up","label":"Follow-up","sort_order":11,"required":true,"extraction_prompt":"Next appointment, repeat imaging if ordered, which investigations to have done before return visit.","include_in_patient_summary":true}
 ]',
 'Dear [PATIENT_NAME],\n\nThank you for your consultation with Dr. [SPECIALIST_NAME] on [DATE]. Here is a summary of your visit.',
 'If you develop sudden severe headache, new weakness, loss of consciousness, or any sudden change — please call 112 and go to the nearest emergency room immediately.\n\nDr. [SPECIALIST_NAME]\n[CLINIC_NAME]'
);
