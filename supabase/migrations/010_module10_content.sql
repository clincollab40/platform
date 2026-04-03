-- ═══════════════════════════════════════════════════════════════
-- ClinCollab — Migration 010
-- Module 10: Clinical Content Engine
--
-- Two-tier evidence framework:
--   Tier 1: Published, peer-reviewed (score >= 3) — main body
--   Tier 2: Emerging, pre-publication from reputed sources — separate panel
--
-- Architecture principles:
--   • content_requests references specialists only — no FKs to other modules
--   • Raw content is stored as structured JSONB — rendered on demand
--   • Immutable trace log drives SSE progress stream
--   • Generated files stored in Supabase Storage (content-outputs bucket)
--   • RLS on all tables: specialist_id = auth.uid()
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE content_type AS ENUM (
    'cme_presentation',       -- CME slides (PPTX)
    'conference_abstract',    -- Conference abstract (DOCX)
    'grand_rounds',           -- Grand rounds teaching slides (PPTX)
    'referral_guide',         -- Referring doctor 1-pager (DOCX)
    'clinical_protocol',      -- Department protocol (DOCX)
    'patient_education',      -- Patient-facing material (DOCX)
    'roundtable_points',      -- Talking points (DOCX)
    'case_discussion'         -- MDT/case discussion (DOCX)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE content_audience AS ENUM (
    'specialist_peers',
    'junior_doctors',
    'referring_physicians',
    'patients_families',
    'administrators'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE content_depth AS ENUM (
    'overview',    -- 6–10 sources, ~10 sections
    'standard',    -- 10–15 sources, ~15 sections (default)
    'deep_dive'    -- 20+ sources, 20+ sections
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE content_status AS ENUM (
    'queued',
    'decomposing',    -- step 1: topic intelligence
    'searching',      -- step 2: literature search
    'scoring',        -- step 3: credibility scoring
    'extracting',     -- step 4: content extraction
    'structuring',    -- step 5: content structuring
    'generating',     -- step 6: file generation
    'completed',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE evidence_tier AS ENUM (
    'tier1',    -- published, peer-reviewed, score >= 3
    'tier2'     -- emerging, pre-publication from reputed source
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE evidence_level AS ENUM (
    'strong',     -- Tier 1, score 4–5
    'moderate',   -- Tier 1, score 3
    'guideline',  -- Society guideline recommendation
    'emerging',   -- Tier 2 source
    'deleted'     -- No credible source — section deleted
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- TABLE: content_requests
-- One per generation job. Soft refs only.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  -- User inputs
  topic             TEXT NOT NULL,
  content_type      content_type NOT NULL,
  specialty         TEXT NOT NULL,
  audience          content_audience NOT NULL DEFAULT 'specialist_peers',
  depth             content_depth NOT NULL DEFAULT 'standard',
  special_instructions TEXT,

  -- Processing
  status            content_status NOT NULL DEFAULT 'queued',
  error_message     TEXT,
  processing_started_at TIMESTAMPTZ,
  processing_ended_at   TIMESTAMPTZ,

  -- Results summary
  total_sources_found   INTEGER DEFAULT 0,
  tier1_sources_used    INTEGER DEFAULT 0,
  tier2_sources_found   INTEGER DEFAULT 0,
  sections_generated    INTEGER DEFAULT 0,
  sections_deleted      INTEGER DEFAULT 0,   -- deleted for lack of evidence

  -- Patient education lock (must be reviewed before download)
  requires_specialist_review BOOLEAN DEFAULT FALSE,
  specialist_reviewed        BOOLEAN DEFAULT FALSE,
  reviewed_at               TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_requests_specialist ON content_requests(specialist_id);
CREATE INDEX IF NOT EXISTS idx_content_requests_status     ON content_requests(specialist_id, status);
CREATE INDEX IF NOT EXISTS idx_content_requests_type       ON content_requests(specialist_id, content_type);
CREATE INDEX IF NOT EXISTS idx_content_requests_created    ON content_requests(specialist_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- TABLE: content_agent_traces
-- Immutable log of every agent step — drives SSE progress stream
-- Never deleted — full audit trail of what the agent did
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_agent_traces (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id        UUID NOT NULL REFERENCES content_requests(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  step_number       INTEGER NOT NULL,
  step_name         TEXT NOT NULL,           -- 'topic_decomposition', 'search_1', etc.
  step_label        TEXT NOT NULL,           -- human-readable for SSE display
  step_status       TEXT NOT NULL,           -- 'running', 'completed', 'failed', 'skipped'
  detail            TEXT,                    -- e.g. "Found 4 sources for: PCI in diabetics"
  sources_count     INTEGER,                 -- sources found in this step
  duration_ms       INTEGER,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traces_request ON content_agent_traces(request_id, step_number);

-- ─────────────────────────────────────────────────────────────
-- TABLE: content_sources
-- Every URL the agent reviewed — used and excluded
-- Two-tier classification built in
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_sources (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id        UUID NOT NULL REFERENCES content_requests(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  -- Source metadata
  url               TEXT NOT NULL,
  title             TEXT,
  authors           TEXT,                    -- "Smith J, Kumar A, et al."
  journal           TEXT,
  publication_year  INTEGER,
  volume_pages      TEXT,                    -- "2023;388:1234-1245"
  doi               TEXT,
  trial_id          TEXT,                    -- NCT number for ClinicalTrials.gov

  -- Credibility scoring
  credibility_score INTEGER NOT NULL DEFAULT 0,   -- 0–5
  evidence_tier     evidence_tier,                 -- tier1 or tier2
  source_type       TEXT,                          -- 'rct', 'guideline', 'conference', 'preprint', etc.
  institution       TEXT,                          -- for Tier 2: the publishing institution

  -- Usage
  used_in_output    BOOLEAN NOT NULL DEFAULT FALSE,
  excluded_reason   TEXT,                          -- why excluded (score < 3, cannot_fetch, etc.)
  abstract_only     BOOLEAN DEFAULT FALSE,         -- could not access full text
  fetch_status      TEXT DEFAULT 'not_fetched',    -- 'fetched', 'abstract_only', 'failed'

  -- Vancouver citation (pre-formatted)
  vancouver_citation TEXT,                         -- full formatted citation string
  citation_number    INTEGER,                      -- assigned position in reference list

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_request  ON content_sources(request_id);
CREATE INDEX IF NOT EXISTS idx_sources_used     ON content_sources(request_id) WHERE used_in_output = TRUE;
CREATE INDEX IF NOT EXISTS idx_sources_tier     ON content_sources(request_id, evidence_tier);

-- ─────────────────────────────────────────────────────────────
-- TABLE: content_sections
-- Structured content sections — the actual generated content
-- Stored as text — rendered to PPTX/DOCX on download
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_sections (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id        UUID NOT NULL REFERENCES content_requests(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  section_title     TEXT NOT NULL,
  section_type      TEXT NOT NULL,    -- 'intro', 'evidence', 'guideline', 'case', 'conclusion', 'references', 'emerging'
  content_text      TEXT NOT NULL,    -- the generated content

  -- Evidence metadata
  evidence_level    evidence_level NOT NULL DEFAULT 'strong',
  evidence_tier     evidence_tier NOT NULL DEFAULT 'tier1',
  evidence_summary  TEXT,             -- "3 sources: NEJM 2023, ACC Guidelines 2023, JACC 2022"
  source_ids        UUID[],           -- references to content_sources

  -- For PPTX: speaker notes
  speaker_notes     TEXT,

  -- For citation display in-text
  citation_numbers  INTEGER[],        -- [1, 3, 7] references to citation_number in sources

  -- Editing
  is_edited         BOOLEAN DEFAULT FALSE,
  edited_text       TEXT,             -- if specialist edited inline
  edited_at         TIMESTAMPTZ,

  -- Ordering
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_tier2_section  BOOLEAN DEFAULT FALSE,   -- true = goes in Emerging Evidence panel

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sections_request   ON content_sections(request_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sections_tier      ON content_sections(request_id, evidence_tier);
CREATE INDEX IF NOT EXISTS idx_sections_tier2     ON content_sections(request_id) WHERE is_tier2_section = TRUE;

-- ─────────────────────────────────────────────────────────────
-- TABLE: content_outputs
-- Generated files — one per format per request
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_outputs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id        UUID NOT NULL REFERENCES content_requests(id) ON DELETE CASCADE,
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,

  format            TEXT NOT NULL,           -- 'pptx' or 'docx'
  file_name         TEXT NOT NULL,
  file_url          TEXT,                    -- Supabase Storage signed URL
  file_size_kb      INTEGER,

  include_tier2     BOOLEAN DEFAULT TRUE,    -- user chose to include/exclude emerging evidence
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ,             -- signed URL expiry
  download_count    INTEGER DEFAULT 0,
  last_downloaded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outputs_request ON content_outputs(request_id);

-- ─────────────────────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TRIGGER content_requests_updated_at
    BEFORE UPDATE ON content_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER content_sections_updated_at
    BEFORE UPDATE ON content_sections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auto-set requires_specialist_review for patient education
CREATE OR REPLACE FUNCTION set_patient_education_review_flag()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.content_type = 'patient_education' THEN
    NEW.requires_specialist_review := TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER patient_education_review_flag
    BEFORE INSERT ON content_requests
    FOR EACH ROW EXECUTE FUNCTION set_patient_education_review_flag();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────
ALTER TABLE content_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_agent_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_sources      ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_sections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_outputs      ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY content_requests_isolation ON content_requests
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_traces_isolation ON content_agent_traces
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_sources_isolation ON content_sources
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_sections_isolation ON content_sections
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_outputs_isolation ON content_outputs
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
