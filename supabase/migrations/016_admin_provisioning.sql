-- ═══════════════════════════════════════════════════════════════
-- ClinCollab — Migration 016
-- Admin Provisioning: Implementation Steps, Test Runs, User Invitations
--
-- Adds three support tables for the Master Configuration module:
--   • implementation_steps  — provisioning checklist per org
--   • test_runs             — module health-check results per org
--   • user_invitations      — pending email invitations to join an org
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE step_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'skipped',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE test_result AS ENUM (
    'pass',
    'fail',
    'skip',
    'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE invitation_status AS ENUM (
    'pending',
    'accepted',
    'expired',
    'revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE invited_role AS ENUM (
    'owner',
    'admin',
    'member'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- TABLE: implementation_steps
-- A fixed checklist of provisioning steps per org.
-- Created automatically when a new org is provisioned.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS implementation_steps (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  step_key        TEXT NOT NULL,           -- e.g. 'create_org', 'configure_modules'
  step_number     INT  NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  status          step_status NOT NULL DEFAULT 'pending',
  completed_by    UUID REFERENCES specialists(id),
  completed_at    TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_impl_steps_org ON implementation_steps(org_id);

-- ─────────────────────────────────────────────────────────────
-- TABLE: test_runs
-- Records results of module health-check test suites.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  triggered_by    UUID REFERENCES specialists(id),
  module_key      TEXT,                    -- NULL = full suite; else single module
  status          step_status NOT NULL DEFAULT 'pending',
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  total_tests     INT NOT NULL DEFAULT 0,
  passed          INT NOT NULL DEFAULT 0,
  failed          INT NOT NULL DEFAULT 0,
  skipped         INT NOT NULL DEFAULT 0,
  results         JSONB DEFAULT '[]',      -- array of { module, test, result, message }
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_runs_org ON test_runs(org_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- TABLE: user_invitations
-- Tracks email invitations sent to specialists to join an org.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_invitations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  org_role        invited_role NOT NULL DEFAULT 'member',
  status          invitation_status NOT NULL DEFAULT 'pending',
  invited_by      UUID REFERENCES specialists(id),
  specialist_id   UUID REFERENCES specialists(id),   -- set when accepted
  token           TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at     TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  message         TEXT,                              -- optional personal note
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, email)
);

CREATE INDEX IF NOT EXISTS idx_invitations_org   ON user_invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON user_invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON user_invitations(token);

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: provision_implementation_steps(org_id UUID, admin_id UUID)
-- Inserts the standard 8-step provisioning checklist for a new org.
-- Called inside provisionOrgAction server action.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION provision_implementation_steps(
  p_org_id   UUID,
  p_admin_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO implementation_steps (org_id, step_key, step_number, title, description, status, completed_by, completed_at)
  VALUES
    (p_org_id, 'create_org',         1, 'Organisation created',             'Basic org record created with plan and geography.',                       'completed', p_admin_id, NOW()),
    (p_org_id, 'configure_modules',  2, 'Modules configured',               'Enable/disable modules as per the agreed SOW.',                           'pending',   NULL, NULL),
    (p_org_id, 'invite_admin',       3, 'Org admin invited',                'Send invitation to the org admin user.',                                  'pending',   NULL, NULL),
    (p_org_id, 'onboard_specialists',4, 'Specialists onboarded',            'Invite all specialist users and assign roles.',                           'pending',   NULL, NULL),
    (p_org_id, 'configure_integrations', 5, 'Integrations configured',      'Set up WhatsApp, EHR, or other third-party integrations where required.', 'pending',   NULL, NULL),
    (p_org_id, 'run_test_suite',     6, 'Test suite passed',                'Run the module health-check suite and verify all pass.',                  'pending',   NULL, NULL),
    (p_org_id, 'train_admin',        7, 'Admin training completed',         'Walk the org admin through the platform and hand over user guide.',       'pending',   NULL, NULL),
    (p_org_id, 'go_live',            8, 'Go-live sign-off',                 'Customer confirmed live. Set org status to active.',                      'pending',   NULL, NULL)
  ON CONFLICT (org_id, step_key) DO NOTHING;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- RLS — implementation_steps
-- NOTE: auth.uid() returns UUID, matched against specialists.id (UUID).
--       Never compare against google_id (TEXT) — type mismatch.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE implementation_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_steps" ON implementation_steps;
CREATE POLICY "admin_all_steps" ON implementation_steps
  FOR ALL TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM specialists WHERE role = 'admin'
    )
  );

DROP POLICY IF EXISTS "org_owner_view_steps" ON implementation_steps;
CREATE POLICY "org_owner_view_steps" ON implementation_steps
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM org_specialists os
      WHERE os.specialist_id = auth.uid()
        AND os.org_id = implementation_steps.org_id
        AND os.org_role IN ('owner', 'admin')
        AND os.is_active = true
    )
  );

-- ─────────────────────────────────────────────────────────────
-- RLS — test_runs
-- ─────────────────────────────────────────────────────────────
ALTER TABLE test_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_tests" ON test_runs;
CREATE POLICY "admin_all_tests" ON test_runs
  FOR ALL TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM specialists WHERE role = 'admin'
    )
  );

DROP POLICY IF EXISTS "org_owner_view_tests" ON test_runs;
CREATE POLICY "org_owner_view_tests" ON test_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM org_specialists os
      WHERE os.specialist_id = auth.uid()
        AND os.org_id = test_runs.org_id
        AND os.org_role IN ('owner', 'admin')
        AND os.is_active = true
    )
  );

-- ─────────────────────────────────────────────────────────────
-- RLS — user_invitations
-- ─────────────────────────────────────────────────────────────
ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_invitations" ON user_invitations;
CREATE POLICY "admin_all_invitations" ON user_invitations
  FOR ALL TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM specialists WHERE role = 'admin'
    )
  );

DROP POLICY IF EXISTS "org_admin_manage_invitations" ON user_invitations;
CREATE POLICY "org_admin_manage_invitations" ON user_invitations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM org_specialists os
      WHERE os.specialist_id = auth.uid()
        AND os.org_id = user_invitations.org_id
        AND os.org_role IN ('owner', 'admin')
        AND os.is_active = true
    )
  );
