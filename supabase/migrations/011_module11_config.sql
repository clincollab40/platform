-- ═══════════════════════════════════════════════════════════════
-- ClinCollab — Migration 011
-- Module 11: Master Configuration Management
--
-- Architecture:
-- • 5-level config hierarchy: platform → plan → org → specialist → session
-- • Every config read is cached at session level (no extra DB hit per page)
-- • All changes immutably logged in config_audit_log
-- • RLS: specialists see only their own org config
-- • Admins see all via admin policies
-- • Config propagation: platform_defaults → plan → org_config → specialist_config
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────
CREATE TYPE plan_tier AS ENUM (
  'starter',        -- M1+M2+M3: solo practitioner
  'growth',         -- M1–M6: group practice
  'professional',   -- M1–M9: hospital department
  'enterprise',     -- M1–M10: full platform
  'custom'          -- bespoke per-org configuration
);

CREATE TYPE org_status AS ENUM (
  'trial',          -- 30-day trial
  'active',         -- paying / active
  'suspended',      -- payment failure or policy violation
  'cancelled',      -- churned
  'demo'            -- internal demo / sandbox
);

CREATE TYPE module_key AS ENUM (
  'm1_identity',
  'm2_network',
  'm3_referrals',
  'm4_chatbot',
  'm5_triage',
  'm6_synthesis',
  'm7_transcription',
  'm8_procedure_planner',
  'm9_communication',
  'm10_content'
);

CREATE TYPE geography AS ENUM (
  'india', 'gcc', 'sea', 'uk', 'aus', 'usa', 'global'
);

-- ─────────────────────────────────────────────────────────────
-- TABLE: organisations
-- The top-level tenant. Every specialist belongs to exactly one org.
-- An org has a plan_tier and a set of overrides on top of the plan.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE organisations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,       -- url-safe org identifier
  plan_tier           plan_tier NOT NULL DEFAULT 'starter',
  status              org_status NOT NULL DEFAULT 'trial',
  geography           geography NOT NULL DEFAULT 'india',

  -- Contact and billing
  admin_email         TEXT NOT NULL,
  billing_email       TEXT,
  phone               TEXT,
  city                TEXT,
  country             TEXT DEFAULT 'India',

  -- Trial / subscription
  trial_ends_at       TIMESTAMPTZ,
  subscription_starts_at TIMESTAMPTZ,
  subscription_ends_at   TIMESTAMPTZ,

  -- Limits (NULL = unlimited for this org)
  max_specialists     INTEGER,          -- NULL = plan default applies
  max_referrals_pm    INTEGER,          -- max referrals per month
  max_content_pm      INTEGER,          -- max content generations per month
  max_transcriptions_pm INTEGER,        -- max transcription sessions per month
  storage_gb_limit    NUMERIC(6,2),     -- total storage quota

  -- Regulatory / geography flags
  data_residency_region TEXT DEFAULT 'ap-south-1',  -- AWS/Supabase region
  hipaa_mode          BOOLEAN DEFAULT FALSE,
  gdpr_mode           BOOLEAN DEFAULT FALSE,
  abdm_mode           BOOLEAN DEFAULT TRUE,
  ucpmp_mode          BOOLEAN DEFAULT TRUE,         -- India pharma compliance

  -- Branding (for white-label)
  custom_logo_url     TEXT,
  custom_colour       TEXT,
  custom_domain       TEXT,

  -- Metadata
  notes               TEXT,            -- internal admin notes
  created_by          UUID,            -- which admin created this org
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orgs_slug   ON organisations(slug);
CREATE INDEX idx_orgs_status ON organisations(status);
CREATE INDEX idx_orgs_tier   ON organisations(plan_tier);

-- ─────────────────────────────────────────────────────────────
-- TABLE: org_specialists
-- Maps specialists to organisations (multi-tenant link table)
-- A specialist can belong to one org at a time.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE org_specialists (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  org_role        TEXT NOT NULL DEFAULT 'member',   -- 'owner', 'admin', 'member'
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invited_by      UUID REFERENCES specialists(id),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(specialist_id)   -- one org per specialist
);

CREATE INDEX idx_org_specialists_org  ON org_specialists(org_id);
CREATE INDEX idx_org_specialists_spec ON org_specialists(specialist_id);

-- ─────────────────────────────────────────────────────────────
-- TABLE: plan_definitions
-- What each plan tier includes by default.
-- Read-only seed data — managed by ClinCollab admin only.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE plan_definitions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tier                plan_tier NOT NULL UNIQUE,
  display_name        TEXT NOT NULL,
  description         TEXT,
  enabled_modules     module_key[] NOT NULL DEFAULT '{}',

  -- Default limits
  default_max_specialists     INTEGER NOT NULL DEFAULT 1,
  default_max_referrals_pm    INTEGER NOT NULL DEFAULT 50,
  default_max_content_pm      INTEGER NOT NULL DEFAULT 0,
  default_max_transcriptions_pm INTEGER NOT NULL DEFAULT 0,
  default_storage_gb          NUMERIC(5,2) NOT NULL DEFAULT 1.0,

  -- Feature flags included in this plan
  -- JSONB: { "whatsapp_delivery": true, "tier2_evidence": false, ... }
  included_features   JSONB NOT NULL DEFAULT '{}',

  -- Which report types are available
  available_reports   TEXT[] DEFAULT '{}',

  -- Which export formats are available
  available_exports   TEXT[] DEFAULT '{}',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- TABLE: org_module_config
-- Per-org overrides on top of the plan.
-- One row per module per org.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE org_module_config (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  module_key      module_key NOT NULL,
  is_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Fine-grained feature flags within this module for this org
  -- e.g. { "tier2_evidence": true, "whatsapp_delivery": false, "patient_education": false }
  feature_flags   JSONB NOT NULL DEFAULT '{}',
  -- Per-module limits override
  monthly_limit   INTEGER,           -- NULL = plan default
  notes           TEXT,
  updated_by      UUID REFERENCES specialists(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, module_key)
);

CREATE INDEX idx_org_module_org    ON org_module_config(org_id);
CREATE INDEX idx_org_module_key    ON org_module_config(module_key);
CREATE INDEX idx_org_module_enabled ON org_module_config(org_id) WHERE is_enabled = TRUE;

-- ─────────────────────────────────────────────────────────────
-- TABLE: specialist_permissions
-- Per-specialist overrides within an org.
-- Inherits org config but can be restricted or elevated.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE specialist_permissions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  module_key      module_key NOT NULL,
  -- 'inherit' = follow org setting, 'enabled' = explicitly on, 'disabled' = explicitly off
  permission      TEXT NOT NULL DEFAULT 'inherit',
  feature_flags   JSONB NOT NULL DEFAULT '{}',   -- additional fine-grained overrides
  granted_by      UUID REFERENCES specialists(id),
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT,
  UNIQUE(org_id, specialist_id, module_key)
);

CREATE INDEX idx_permissions_specialist ON specialist_permissions(specialist_id);
CREATE INDEX idx_permissions_org        ON specialist_permissions(org_id);

-- ─────────────────────────────────────────────────────────────
-- TABLE: feature_flag_registry
-- Master list of every feature flag in the system.
-- Documents what each flag does, which module it belongs to,
-- and its safe default. Used to render admin UI dynamically.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE feature_flag_registry (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flag_key        TEXT NOT NULL UNIQUE,          -- e.g. 'm10.tier2_evidence'
  module_key      module_key NOT NULL,
  display_name    TEXT NOT NULL,
  description     TEXT NOT NULL,
  default_value   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Which plan tiers include this flag by default
  included_from_tier plan_tier,
  -- Safety classification
  risk_level      TEXT NOT NULL DEFAULT 'low',   -- 'low', 'medium', 'high', 'critical'
  requires_admin  BOOLEAN DEFAULT FALSE,         -- only super-admin can change
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_flag_registry_module ON feature_flag_registry(module_key);

-- ─────────────────────────────────────────────────────────────
-- TABLE: usage_events
-- Every usage action recorded for billing, limits, analytics.
-- Immutable — append-only.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE usage_events (
  id              UUID NOT NULL DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organisations(id),
  specialist_id   UUID REFERENCES specialists(id),
  module_key      module_key NOT NULL,
  event_type      TEXT NOT NULL,      -- 'referral_created', 'content_generated', 'triage_sent' etc.
  metadata        JSONB DEFAULT '{}', -- additional context
  billed          BOOLEAN DEFAULT FALSE,
  event_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, event_at)          -- partition key must be part of PK
) PARTITION BY RANGE (event_at);

-- Partition by month for performance
CREATE TABLE usage_events_y2025_q1 PARTITION OF usage_events
  FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE usage_events_y2025_q2 PARTITION OF usage_events
  FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE usage_events_y2025_q3 PARTITION OF usage_events
  FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE usage_events_y2025_q4 PARTITION OF usage_events
  FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
CREATE TABLE usage_events_y2026_q1 PARTITION OF usage_events
  FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE usage_events_y2026_q2 PARTITION OF usage_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE usage_events_default  PARTITION OF usage_events DEFAULT;

CREATE INDEX idx_usage_org_month ON usage_events(org_id, event_at DESC);
CREATE INDEX idx_usage_module    ON usage_events(module_key, event_at DESC);
CREATE INDEX idx_usage_type      ON usage_events(event_type, event_at DESC);

-- ─────────────────────────────────────────────────────────────
-- TABLE: config_audit_log
-- Immutable log of every configuration change.
-- Who changed what, when, from what to what.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE config_audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organisations(id),
  specialist_id   UUID REFERENCES specialists(id),
  changed_by      UUID REFERENCES specialists(id),
  change_type     TEXT NOT NULL,     -- 'module_enabled', 'module_disabled', 'flag_changed', 'plan_changed', 'limit_changed'
  entity_type     TEXT NOT NULL,     -- 'organisation', 'specialist_permission'
  entity_id       UUID NOT NULL,
  field_name      TEXT NOT NULL,
  old_value       TEXT,
  new_value       TEXT,
  change_reason   TEXT,
  ip_address      TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_org        ON config_audit_log(org_id, changed_at DESC);
CREATE INDEX idx_audit_specialist ON config_audit_log(specialist_id, changed_at DESC);
CREATE INDEX idx_audit_changed_by ON config_audit_log(changed_by, changed_at DESC);

-- ─────────────────────────────────────────────────────────────
-- VIEW: v_specialist_entitlements
-- The resolved config for any specialist.
-- Merges: plan → org_module_config → specialist_permissions
-- This is what every module reads to check access.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_specialist_entitlements AS
SELECT
  s.id                    AS specialist_id,
  s.name                  AS specialist_name,
  s.specialty,
  s.role                  AS specialist_role,
  os.org_id,
  o.name                  AS org_name,
  o.slug                  AS org_slug,
  o.plan_tier,
  o.status                AS org_status,
  o.geography,
  o.hipaa_mode,
  o.gdpr_mode,
  o.abdm_mode,
  o.ucpmp_mode,
  os.org_role,
  -- Build enabled module set:
  -- Take plan defaults, apply org overrides, apply specialist overrides
  ARRAY(
    SELECT DISTINCT mk::TEXT
    FROM unnest(pd.enabled_modules) mk
    WHERE NOT EXISTS (
      SELECT 1 FROM org_module_config omc
      WHERE omc.org_id = os.org_id
        AND omc.module_key = mk::module_key
        AND omc.is_enabled = FALSE
    )
    UNION
    SELECT omc2.module_key::TEXT
    FROM org_module_config omc2
    WHERE omc2.org_id = os.org_id AND omc2.is_enabled = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM unnest(pd.enabled_modules) pm WHERE pm = omc2.module_key
      )
  ) AS enabled_modules,
  pd.included_features    AS plan_features,
  -- Effective feature flags = plan_features merged with org overrides
  pd.included_features || COALESCE(
    (SELECT jsonb_object_agg(module_key::TEXT, feature_flags)
     FROM org_module_config WHERE org_id = os.org_id),
    '{}'::JSONB
  ) AS effective_features
FROM specialists s
JOIN org_specialists os ON os.specialist_id = s.id AND os.is_active = TRUE
JOIN organisations o ON o.id = os.org_id
JOIN plan_definitions pd ON pd.tier = o.plan_tier;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: check_module_access(specialist_id, module_key)
-- Used by server actions to gate module access.
-- Returns TRUE if the specialist can access this module.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_module_access(
  p_specialist_id UUID,
  p_module_key    TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_enabled_modules TEXT[];
  v_org_status      TEXT;
  v_spec_permission TEXT;
BEGIN
  -- Check org status first
  SELECT o.status::TEXT INTO v_org_status
  FROM org_specialists os
  JOIN organisations o ON o.id = os.org_id
  WHERE os.specialist_id = p_specialist_id AND os.is_active = TRUE;

  IF v_org_status NOT IN ('active', 'trial', 'demo') THEN
    RETURN FALSE;
  END IF;

  -- Check specialist-level override first
  SELECT permission INTO v_spec_permission
  FROM specialist_permissions
  WHERE specialist_id = p_specialist_id
    AND module_key = p_module_key::module_key;

  IF v_spec_permission = 'disabled' THEN RETURN FALSE; END IF;
  IF v_spec_permission = 'enabled'  THEN RETURN TRUE;  END IF;

  -- Fall back to org+plan entitlements
  SELECT enabled_modules INTO v_enabled_modules
  FROM v_specialist_entitlements
  WHERE specialist_id = p_specialist_id;

  RETURN p_module_key = ANY(v_enabled_modules);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: get_feature_flag(specialist_id, flag_key)
-- Returns the resolved value of a feature flag for a specialist.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_feature_flag(
  p_specialist_id UUID,
  p_flag_key      TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_features JSONB;
BEGIN
  SELECT effective_features INTO v_features
  FROM v_specialist_entitlements
  WHERE specialist_id = p_specialist_id;

  IF v_features IS NULL THEN
    RETURN (SELECT default_value FROM feature_flag_registry WHERE flag_key = p_flag_key);
  END IF;

  RETURN COALESCE((v_features ->> p_flag_key)::BOOLEAN,
    (SELECT default_value FROM feature_flag_registry WHERE flag_key = p_flag_key),
    FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: record_usage_event
-- Called by each module when a significant action occurs.
-- Used for billing, limit enforcement, analytics.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_usage_event(
  p_specialist_id UUID,
  p_module_key    TEXT,
  p_event_type    TEXT,
  p_metadata      JSONB DEFAULT '{}'
)
RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id
  FROM org_specialists
  WHERE specialist_id = p_specialist_id AND is_active = TRUE;

  IF v_org_id IS NULL THEN RETURN; END IF;

  INSERT INTO usage_events (org_id, specialist_id, module_key, event_type, metadata)
  VALUES (v_org_id, p_specialist_id, p_module_key::module_key, p_event_type, p_metadata);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────────────────────
CREATE TRIGGER orgs_updated_at
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER org_module_config_updated_at
  BEFORE UPDATE ON org_module_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create org_module_config rows when org is created
CREATE OR REPLACE FUNCTION setup_org_modules_on_create()
RETURNS TRIGGER AS $$
DECLARE
  v_enabled_modules module_key[];
  mk module_key;
BEGIN
  -- Get the plan's enabled modules
  SELECT enabled_modules INTO v_enabled_modules
  FROM plan_definitions WHERE tier = NEW.plan_tier;

  -- Insert a config row for every possible module
  FOREACH mk IN ARRAY ARRAY[
    'm1_identity','m2_network','m3_referrals','m4_chatbot','m5_triage',
    'm6_synthesis','m7_transcription','m8_procedure_planner','m9_communication','m10_content'
  ]::module_key[] LOOP
    INSERT INTO org_module_config (org_id, module_key, is_enabled)
    VALUES (NEW.id, mk, mk = ANY(v_enabled_modules))
    ON CONFLICT (org_id, module_key) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_setup_modules
  AFTER INSERT ON organisations
  FOR EACH ROW EXECUTE FUNCTION setup_org_modules_on_create();

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────
ALTER TABLE organisations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_specialists        ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_module_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialist_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_definitions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_registry  ENABLE ROW LEVEL SECURITY;

-- Specialists see their own org
CREATE POLICY orgs_read ON organisations FOR SELECT
  USING (id IN (SELECT org_id FROM org_specialists WHERE specialist_id = auth.uid()));

-- Admins see all
CREATE POLICY orgs_admin ON organisations FOR ALL
  USING (auth.uid() IN (SELECT id FROM specialists WHERE role = 'admin'));

-- Module config: org members can read; org admins can write
CREATE POLICY org_module_read ON org_module_config FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_specialists WHERE specialist_id = auth.uid()));
CREATE POLICY org_module_admin_write ON org_module_config FOR ALL
  USING (auth.uid() IN (SELECT s.id FROM specialists s WHERE s.role = 'admin'));

-- Specialist permissions: self can read, admin can write
CREATE POLICY spec_perm_read ON specialist_permissions FOR SELECT
  USING (specialist_id = auth.uid() OR
         auth.uid() IN (SELECT id FROM specialists WHERE role = 'admin'));
CREATE POLICY spec_perm_write ON specialist_permissions FOR ALL
  USING (auth.uid() IN (SELECT id FROM specialists WHERE role = 'admin'));

-- Usage events: own org read only
CREATE POLICY usage_read ON usage_events FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_specialists WHERE specialist_id = auth.uid()));

-- Audit log: admin only
CREATE POLICY audit_admin ON config_audit_log FOR ALL
  USING (auth.uid() IN (SELECT id FROM specialists WHERE role = 'admin'));

-- Plan definitions and flag registry: all authenticated can read
CREATE POLICY plans_read ON plan_definitions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY flags_read ON feature_flag_registry FOR SELECT USING (auth.uid() IS NOT NULL);

-- ─────────────────────────────────────────────────────────────
-- SEED: Plan definitions
-- ─────────────────────────────────────────────────────────────
INSERT INTO plan_definitions (
  tier, display_name, description, enabled_modules,
  default_max_specialists, default_max_referrals_pm, default_max_content_pm,
  default_max_transcriptions_pm, default_storage_gb,
  included_features, available_reports, available_exports
) VALUES

('starter', 'Starter', 'Solo practitioner — network building and referral management',
  ARRAY['m1_identity','m2_network','m3_referrals']::module_key[],
  1, 50, 0, 0, 1.0,
  '{"whatsapp_notifications": true, "csv_export": false, "api_access": false, "white_label": false}'::JSONB,
  ARRAY['referral_summary'],
  ARRAY['pdf']
),

('growth', 'Growth', 'Group practice — patient engagement, triage, AI synthesis',
  ARRAY['m1_identity','m2_network','m3_referrals','m4_chatbot','m5_triage','m6_synthesis']::module_key[],
  3, 200, 0, 0, 5.0,
  '{"whatsapp_notifications": true, "csv_export": true, "api_access": false, "white_label": false, "tier2_evidence": false}'::JSONB,
  ARRAY['referral_summary','triage_summary','appointment_report'],
  ARRAY['pdf','csv']
),

('professional', 'Professional', 'Hospital department — full procedural workflow and transcription',
  ARRAY['m1_identity','m2_network','m3_referrals','m4_chatbot','m5_triage','m6_synthesis',
        'm7_transcription','m8_procedure_planner','m9_communication']::module_key[],
  10, 1000, 0, 50, 25.0,
  '{"whatsapp_notifications": true, "csv_export": true, "api_access": true, "white_label": false, "tier2_evidence": false, "who_checklist": true, "stakeholder_comms": true}'::JSONB,
  ARRAY['referral_summary','triage_summary','appointment_report','procedure_report','transcription_log'],
  ARRAY['pdf','csv','docx']
),

('enterprise', 'Enterprise', 'Full platform — all modules, clinical content engine, unlimited usage',
  ARRAY['m1_identity','m2_network','m3_referrals','m4_chatbot','m5_triage','m6_synthesis',
        'm7_transcription','m8_procedure_planner','m9_communication','m10_content']::module_key[],
  -1, -1, 100, 200, 100.0,
  '{"whatsapp_notifications": true, "csv_export": true, "api_access": true, "white_label": true, "tier2_evidence": true, "who_checklist": true, "stakeholder_comms": true, "patient_education_lock": true}'::JSONB,
  ARRAY['referral_summary','triage_summary','appointment_report','procedure_report','transcription_log','content_library','usage_analytics'],
  ARRAY['pdf','csv','docx','pptx','json']
),

('custom', 'Custom', 'Bespoke configuration — individual module selection and limits',
  ARRAY[]::module_key[],
  1, 50, 0, 0, 1.0,
  '{}'::JSONB,
  ARRAY[],
  ARRAY['pdf']
);

-- ─────────────────────────────────────────────────────────────
-- SEED: Feature flag registry
-- ─────────────────────────────────────────────────────────────
INSERT INTO feature_flag_registry (flag_key, module_key, display_name, description, default_value, included_from_tier, risk_level, requires_admin) VALUES

-- M3 Referrals
('m3.case_messaging',       'm3_referrals','Case messaging','Two-way messaging between specialist and referring doctor',TRUE,'starter','low',FALSE),
('m3.bulk_csv_import',      'm3_referrals','Bulk CSV import','Import referring doctors from CSV file',FALSE,'growth','low',FALSE),
('m3.referral_analytics',   'm3_referrals','Referral analytics','Referral volume and trend reports',TRUE,'starter','low',FALSE),

-- M4 Chatbot
('m4.appointment_booking',  'm4_chatbot','Appointment booking','WhatsApp appointment booking chatbot flow',TRUE,'growth','low',FALSE),
('m4.emergency_intercept',  'm4_chatbot','Emergency intercept','Automatic 112 redirect for emergency keywords',TRUE,'growth','critical',TRUE),
('m4.multilingual',         'm4_chatbot','Hindi/Telugu support','Chatbot responds in Hindi and Telugu',TRUE,'growth','low',FALSE),

-- M5 Triage
('m5.red_flag_alerts',      'm5_triage','Red flag WhatsApp alerts','Immediate specialist alert on urgent triage flag',TRUE,'growth','high',FALSE),
('m5.auto_trigger_synthesis','m5_triage','Auto-trigger synthesis','Automatically trigger M6 synthesis when triage completes',TRUE,'growth','low',FALSE),
('m5.multilingual_form',    'm5_triage','Multilingual triage form','Patient triage form in Hindi and Telugu',TRUE,'growth','low',FALSE),

-- M6 Synthesis
('m6.whatsapp_delivery',    'm6_synthesis','WhatsApp brief delivery','Send synthesis brief to specialist via WhatsApp',TRUE,'growth','low',FALSE),
('m6.cross_module_data',    'm6_synthesis','Cross-module data aggregation','Aggregate data from all connected modules',TRUE,'growth','low',FALSE),

-- M7 Transcription
('m7.raw_transcript_access','m7_transcription','Raw transcript access','Specialist can view raw Whisper transcript',TRUE,'professional','medium',FALSE),
('m7.referrer_summary',     'm7_transcription','Referrer summary delivery','Send clinical summary to referring doctor',TRUE,'professional','low',FALSE),
('m7.icd10_coding',         'm7_transcription','ICD-10 code extraction','Automatically extract ICD-10 codes from transcript',TRUE,'professional','medium',FALSE),

-- M8 Procedure Planner
('m8.who_checklist',        'm8_procedure_planner','WHO Safety Checklist','WHO surgical safety checklist for procedures',TRUE,'professional','high',FALSE),
('m8.resource_booking',     'm8_procedure_planner','Resource booking','OT room and equipment booking workflow',TRUE,'professional','low',FALSE),
('m8.medication_holds',     'm8_procedure_planner','Medication hold management','Track and communicate medication holds',TRUE,'professional','high',FALSE),

-- M9 Communication
('m9.patient_adherence_tracking','m9_communication','Patient adherence tracking','Track patient preparation adherence via WhatsApp',TRUE,'professional','medium',FALSE),
('m9.auto_escalation',      'm9_communication','Automatic escalation','Auto-escalate when confirmations are overdue',TRUE,'professional','high',FALSE),
('m9.referring_doctor_milestones','m9_communication','Referring doctor milestone alerts','Notify referring doctor at procedure milestones',TRUE,'professional','low',FALSE),

-- M10 Content
('m10.tier2_evidence',      'm10_content','Tier 2 emerging evidence','Show pre-publication and conference data section',TRUE,'enterprise','medium',FALSE),
('m10.patient_education',   'm10_content','Patient education content','Generate patient-facing educational materials',TRUE,'enterprise','high',FALSE),
('m10.pptx_export',         'm10_content','PowerPoint export','Generate downloadable PPTX presentations',TRUE,'enterprise','low',FALSE),
('m10.deep_dive_depth',     'm10_content','Deep dive research depth','Allow deep dive (20+ source) content generation',FALSE,'enterprise','low',FALSE),

-- Cross-module / platform
('platform.api_access',     'm1_identity','API access','Enable REST API access for this org',FALSE,'professional','high',TRUE),
('platform.white_label',    'm1_identity','White label branding','Custom logo, colours, domain',FALSE,'enterprise','medium',TRUE),
('platform.data_export_all','m1_identity','Full data export','Export all data as JSON/CSV',FALSE,'professional','medium',FALSE),
('platform.sso',            'm1_identity','SSO / SAML','Single sign-on integration',FALSE,'enterprise','high',TRUE);
