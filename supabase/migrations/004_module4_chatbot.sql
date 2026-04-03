-- ═══════════════════════════════════════════════════════
-- ClinCollab — Migration 004
-- Module 4: Patient Chatbot + Appointment Booking
-- ═══════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE appointment_status AS ENUM (
    'confirmed', 'rescheduled', 'cancelled', 'completed', 'no_show'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE booking_channel AS ENUM ('whatsapp', 'web_widget', 'manual', 'referral');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chat_outcome AS ENUM (
    'answered', 'booked', 'escalated', 'emergency', 'abandoned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chat_role AS ENUM ('patient', 'assistant', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- TABLE: chatbot_configs
-- Specialist's practice configuration for the chatbot
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chatbot_configs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id         UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  clinic_name           TEXT,
  address               TEXT,
  google_maps_url       TEXT,
  timings               JSONB DEFAULT '{
    "monday":    {"open": "09:00", "close": "18:00", "closed": false},
    "tuesday":   {"open": "09:00", "close": "18:00", "closed": false},
    "wednesday": {"open": "09:00", "close": "18:00", "closed": false},
    "thursday":  {"open": "09:00", "close": "18:00", "closed": false},
    "friday":    {"open": "09:00", "close": "18:00", "closed": false},
    "saturday":  {"open": "09:00", "close": "13:00", "closed": false},
    "sunday":    {"open": null,    "close": null,    "closed": true}
  }',
  fee_consultation      INTEGER,
  fee_followup          INTEGER,
  procedures            TEXT[] DEFAULT '{}',
  languages             TEXT[] DEFAULT '{English}',
  escalation_mobile     TEXT,
  escalation_hours      TEXT DEFAULT 'Monday to Saturday, 9am to 6pm',
  booking_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  booking_advance_days  INTEGER NOT NULL DEFAULT 14,
  is_live               BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_number       TEXT,
  welcome_message       TEXT DEFAULT 'Hello! I am the virtual assistant for Dr. {{doctor_name}}. How can I help you today?',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(specialist_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_configs_specialist ON chatbot_configs(specialist_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_configs_whatsapp ON chatbot_configs(whatsapp_number);

-- ─────────────────────────────────────────────
-- TABLE: chatbot_faqs
-- Specialist-defined Q&A pairs (priority knowledge)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chatbot_faqs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faqs_specialist_id ON chatbot_faqs(specialist_id);

-- ─────────────────────────────────────────────
-- TABLE: appointment_slot_templates
-- Weekly schedule template — generates actual slots
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointment_slot_templates (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id       UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  day_of_week         INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun
  start_time          TIME NOT NULL,
  end_time            TIME NOT NULL,
  slot_duration_mins  INTEGER NOT NULL DEFAULT 15,
  max_per_slot        INTEGER NOT NULL DEFAULT 1,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slot_templates_specialist ON appointment_slot_templates(specialist_id);

-- ─────────────────────────────────────────────
-- TABLE: appointment_slots
-- Generated slots for specific dates
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointment_slots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  slot_date       DATE NOT NULL,
  slot_time       TIME NOT NULL,
  duration_mins   INTEGER NOT NULL DEFAULT 15,
  max_capacity    INTEGER NOT NULL DEFAULT 1,
  booked_count    INTEGER NOT NULL DEFAULT 0,
  is_blocked      BOOLEAN NOT NULL DEFAULT FALSE,
  block_reason    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(specialist_id, slot_date, slot_time)
);

CREATE INDEX IF NOT EXISTS idx_slots_specialist_date ON appointment_slots(specialist_id, slot_date);
CREATE INDEX IF NOT EXISTS idx_slots_available ON appointment_slots(specialist_id, slot_date, is_blocked)
  WHERE booked_count < max_capacity AND is_blocked = FALSE;

-- ─────────────────────────────────────────────
-- TABLE: appointments
-- Confirmed appointment bookings
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  slot_id           UUID NOT NULL REFERENCES appointment_slots(id),
  patient_name      TEXT NOT NULL,
  patient_mobile    TEXT NOT NULL,
  patient_gender    TEXT,
  reason            TEXT,
  channel           booking_channel NOT NULL DEFAULT 'whatsapp',
  status            appointment_status NOT NULL DEFAULT 'confirmed',
  referral_case_id  UUID REFERENCES referral_cases(id),
  session_id        UUID,
  reminder_sent_24h BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_sent_1h  BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT,
  cancelled_reason  TEXT,
  booked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_specialist ON appointments(specialist_id);
CREATE INDEX IF NOT EXISTS idx_appointments_slot ON appointments(slot_id);
CREATE INDEX IF NOT EXISTS idx_appointments_mobile ON appointments(patient_mobile);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(specialist_id, booked_at DESC);

-- ─────────────────────────────────────────────
-- TABLE: chat_sessions
-- One per patient conversation
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  channel           booking_channel NOT NULL DEFAULT 'whatsapp',
  patient_mobile    TEXT,
  patient_name      TEXT,
  wa_contact_name   TEXT,
  session_start     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  intent_summary    TEXT,
  outcome           chat_outcome,
  escalated         BOOLEAN NOT NULL DEFAULT FALSE,
  appointment_id    UUID REFERENCES appointments(id),
  message_count     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_specialist ON chat_sessions(specialist_id);
CREATE INDEX IF NOT EXISTS idx_sessions_mobile ON chat_sessions(patient_mobile);
CREATE INDEX IF NOT EXISTS idx_sessions_last_message ON chat_sessions(specialist_id, last_message_at DESC);

-- ─────────────────────────────────────────────
-- TABLE: chat_messages
-- Individual messages within a session
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  role            chat_role NOT NULL,
  content         TEXT NOT NULL,
  intent          TEXT,
  confidence      NUMERIC(3,2),
  wa_message_id   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_specialist ON chat_messages(specialist_id);

-- ─────────────────────────────────────────────
-- FUNCTION: generate slots from template
-- Creates appointment_slots for a date range from template
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_appointment_slots(
  p_specialist_id UUID,
  p_from_date     DATE,
  p_to_date       DATE
)
RETURNS INTEGER AS $$
DECLARE
  v_template  RECORD;
  v_date      DATE;
  v_time      TIME;
  v_count     INTEGER := 0;
BEGIN
  v_date := p_from_date;

  WHILE v_date <= p_to_date LOOP
    FOR v_template IN
      SELECT * FROM appointment_slot_templates
      WHERE specialist_id = p_specialist_id
        AND day_of_week = EXTRACT(DOW FROM v_date)::INTEGER
        AND is_active = TRUE
    LOOP
      v_time := v_template.start_time;
      WHILE v_time < v_template.end_time LOOP
        INSERT INTO appointment_slots (
          specialist_id, slot_date, slot_time,
          duration_mins, max_capacity
        ) VALUES (
          p_specialist_id, v_date, v_time,
          v_template.slot_duration_mins,
          v_template.max_per_slot
        )
        ON CONFLICT (specialist_id, slot_date, slot_time) DO NOTHING;

        v_count := v_count + 1;
        v_time  := v_time + (v_template.slot_duration_mins || ' minutes')::INTERVAL;
      END LOOP;
    END LOOP;

    v_date := v_date + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────
-- FUNCTION: book slot with optimistic locking
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION book_appointment_slot(
  p_slot_id       UUID,
  p_specialist_id UUID,
  p_patient_name  TEXT,
  p_patient_mobile TEXT,
  p_reason        TEXT,
  p_channel       booking_channel,
  p_session_id    UUID DEFAULT NULL
)
RETURNS TABLE(
  appointment_id  UUID,
  success         BOOLEAN,
  error_message   TEXT
) AS $$
DECLARE
  v_slot      RECORD;
  v_appt_id   UUID;
BEGIN
  -- Lock the slot row
  SELECT * INTO v_slot
  FROM appointment_slots
  WHERE id = p_slot_id
    AND specialist_id = p_specialist_id
    AND is_blocked = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'Slot not available';
    RETURN;
  END IF;

  IF v_slot.booked_count >= v_slot.max_capacity THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'Slot is fully booked';
    RETURN;
  END IF;

  -- Create appointment
  INSERT INTO appointments (
    specialist_id, slot_id, patient_name, patient_mobile,
    reason, channel, session_id
  ) VALUES (
    p_specialist_id, p_slot_id, p_patient_name,
    p_patient_mobile, p_reason, p_channel, p_session_id
  ) RETURNING id INTO v_appt_id;

  -- Increment booked count
  UPDATE appointment_slots
  SET booked_count = booked_count + 1
  WHERE id = p_slot_id;

  RETURN QUERY SELECT v_appt_id, TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- TRIGGERS: updated_at
-- ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TRIGGER chatbot_configs_updated_at
    BEFORE UPDATE ON chatbot_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE chatbot_configs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_faqs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_slot_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_slots        ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages            ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY chatbot_configs_isolation ON chatbot_configs
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY faqs_isolation ON chatbot_faqs
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY slot_templates_isolation ON appointment_slot_templates
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY slots_isolation ON appointment_slots
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY appointments_isolation ON appointments
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY sessions_isolation ON chat_sessions
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY chat_messages_isolation ON chat_messages
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Service role bypass used by webhook handler
-- (WhatsApp webhook runs with service role — no auth.uid())

-- ─────────────────────────────────────────────
-- DEFAULT FAQS seed (common cardiology questions)
-- Specialist can customise these after onboarding
-- ─────────────────────────────────────────────
-- Inserted per specialist via application logic on chatbot setup
