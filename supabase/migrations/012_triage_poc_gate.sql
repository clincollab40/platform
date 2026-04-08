-- ════════════════════════════════════════════════════════════════════════════
-- Migration 012 — Triage POC Gate & 6-language support
--
-- Adds to triage_protocols:
--   poc_name        TEXT          — Name/role of the Point of Contact
--   poc_mobile      TEXT          — WhatsApp number alerts go to
--   review_required BOOLEAN       — Whether POC must review before doctor sees
--   poc_alert_on    TEXT          — 'urgent' | 'urgent,needs_review' | 'all'
--
-- Adds to triage_questions:
--   question_text_kn TEXT          — Kannada translation
--   question_text_mr TEXT          — Marathi translation
--   question_text_bn TEXT          — Bengali translation
--
-- Adds to triage_sessions:
--   poc_reviewed_at  TIMESTAMPTZ   — When POC marked the session reviewed
--   poc_notes        TEXT          — POC review notes for the doctor
-- ════════════════════════════════════════════════════════════════════════════

-- ── POC fields on triage_protocols ────────────────────────────────────────────
ALTER TABLE triage_protocols
  ADD COLUMN IF NOT EXISTS poc_name        TEXT,
  ADD COLUMN IF NOT EXISTS poc_mobile      TEXT,
  ADD COLUMN IF NOT EXISTS review_required BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS poc_alert_on    TEXT    NOT NULL DEFAULT 'urgent,needs_review';

COMMENT ON COLUMN triage_protocols.poc_name        IS 'Name or role of the Point of Contact (e.g. Clinic Coordinator)';
COMMENT ON COLUMN triage_protocols.poc_mobile      IS 'WhatsApp number for POC — receives real-time flag alerts and completion summaries';
COMMENT ON COLUMN triage_protocols.review_required IS 'When true, triage stays pending_review until POC marks it reviewed before doctor sees it';
COMMENT ON COLUMN triage_protocols.poc_alert_on    IS 'Comma-separated trigger levels: urgent | urgent,needs_review | all';

-- ── Additional language columns on triage_questions ───────────────────────────
ALTER TABLE triage_questions
  ADD COLUMN IF NOT EXISTS question_text_kn TEXT,  -- Kannada
  ADD COLUMN IF NOT EXISTS question_text_mr TEXT,  -- Marathi
  ADD COLUMN IF NOT EXISTS question_text_bn TEXT;  -- Bengali

COMMENT ON COLUMN triage_questions.question_text_kn IS 'Kannada (ಕನ್ನಡ) translation of the question';
COMMENT ON COLUMN triage_questions.question_text_mr IS 'Marathi (मराठी) translation of the question';
COMMENT ON COLUMN triage_questions.question_text_bn IS 'Bengali (বাংলা) translation of the question';

-- ── POC review tracking on triage_sessions ────────────────────────────────────
ALTER TABLE triage_sessions
  ADD COLUMN IF NOT EXISTS poc_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS poc_notes       TEXT;

COMMENT ON COLUMN triage_sessions.poc_reviewed_at IS 'Timestamp when POC marked this session as reviewed';
COMMENT ON COLUMN triage_sessions.poc_notes        IS 'Optional POC notes added during review, visible to doctor';

-- ── Index for POC review queue ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_triage_sessions_poc_review
  ON triage_sessions (specialist_id, status, poc_reviewed_at)
  WHERE status = 'completed' AND poc_reviewed_at IS NULL;
