-- ═══════════════════════════════════════════════════════
-- ClinCollab — Migration 001 (SAFE / IDEMPOTENT)
-- Module 1: Identity, Auth, Profiles, Peer Seeds
-- Multi-tenant isolation via PostgreSQL Row Level Security
--
-- Uses IF NOT EXISTS + exception-safe ENUM creation so this
-- script can be run even after a partial previous attempt.
-- ═══════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- ENUMS  (safe — skip if already exists)
-- ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE specialist_role AS ENUM ('specialist', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE specialist_status AS ENUM ('onboarding', 'active', 'inactive', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE peer_seed_status AS ENUM ('seeded', 'matched', 'active', 'drifting', 'silent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE specialty_type AS ENUM (
    'interventional_cardiology',
    'cardiac_surgery',
    'cardiology',
    'orthopedics',
    'spine_surgery',
    'neurology',
    'neurosurgery',
    'gi_surgery',
    'urology',
    'oncology',
    'reproductive_medicine',
    'dermatology',
    'ophthalmology',
    'internal_medicine',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- TABLE: specialists
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS specialists (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  google_id         TEXT UNIQUE NOT NULL,
  email             TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  specialty         specialty_type NOT NULL,
  city              TEXT NOT NULL,
  role              specialist_role NOT NULL DEFAULT 'specialist',
  status            specialist_status NOT NULL DEFAULT 'onboarding',
  whatsapp_number   TEXT,
  onboarding_step   INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_specialists_google_id ON specialists(google_id);
CREATE INDEX IF NOT EXISTS idx_specialists_email ON specialists(email);
CREATE INDEX IF NOT EXISTS idx_specialists_specialty ON specialists(specialty);
CREATE INDEX IF NOT EXISTS idx_specialists_city ON specialists(city);

-- ─────────────────────────────────────────────
-- TABLE: specialist_profiles
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS specialist_profiles (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id       UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  designation         TEXT,
  sub_specialty       TEXT,
  hospitals           TEXT[] DEFAULT '{}',
  years_experience    INTEGER,
  mci_number          TEXT,
  photo_url           TEXT,
  bio                 TEXT,
  completeness_pct    INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(specialist_id)
);

CREATE INDEX IF NOT EXISTS idx_specialist_profiles_specialist_id ON specialist_profiles(specialist_id);

-- ─────────────────────────────────────────────
-- TABLE: peer_seeds
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS peer_seeds (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  peer_name         TEXT NOT NULL,
  peer_city         TEXT NOT NULL,
  peer_specialty    TEXT,
  peer_clinic       TEXT,
  peer_phone        TEXT,
  status            peer_seed_status NOT NULL DEFAULT 'seeded',
  last_referral_at  TIMESTAMPTZ,
  days_since_last   INTEGER,
  seeded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_peer_seeds_specialist_id ON peer_seeds(specialist_id);
CREATE INDEX IF NOT EXISTS idx_peer_seeds_status ON peer_seeds(status);

-- ─────────────────────────────────────────────
-- TABLE: specialist_consents
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS specialist_consents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  consent_version   TEXT NOT NULL DEFAULT '1.0',
  consented_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address        INET,
  user_agent        TEXT
);

CREATE INDEX IF NOT EXISTS idx_consents_specialist_id ON specialist_consents(specialist_id);

-- ─────────────────────────────────────────────
-- TABLE: device_sessions
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_sessions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id         UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  refresh_token_hash    TEXT NOT NULL,
  device_hint           TEXT,
  ip_address            INET,
  last_active           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_specialist_id ON device_sessions(specialist_id);

-- ─────────────────────────────────────────────
-- TABLE: audit_logs
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  actor_id        UUID,
  actor_role      TEXT NOT NULL,
  action          TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  resource_id     UUID,
  metadata        JSONB DEFAULT '{}',
  ip_address      INET,
  user_agent      TEXT,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON audit_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- Immutable audit — prevent updates and deletes
DO $$ BEGIN
  CREATE RULE no_update_audit AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE RULE no_delete_audit AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- FUNCTION + TRIGGER: updated_at
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER specialists_updated_at
    BEFORE UPDATE ON specialists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON specialist_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER peer_seeds_updated_at
    BEFORE UPDATE ON peer_seeds
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE specialists         ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialist_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE peer_seeds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialist_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs          ENABLE ROW LEVEL SECURITY;

-- specialists: own row + admin read
DO $$ BEGIN
  CREATE POLICY specialists_own_row ON specialists
    FOR ALL USING (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY specialists_admin_read ON specialists
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM specialists s WHERE s.id = auth.uid() AND s.role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- specialist_profiles: own row + admin read
DO $$ BEGIN
  CREATE POLICY profiles_own_row ON specialist_profiles
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY profiles_admin_read ON specialist_profiles
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM specialists s WHERE s.id = auth.uid() AND s.role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- peer_seeds: own rows only
DO $$ BEGIN
  CREATE POLICY peer_seeds_own_rows ON peer_seeds
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- specialist_consents
DO $$ BEGIN
  CREATE POLICY consents_own_row ON specialist_consents
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY consents_admin_read ON specialist_consents
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM specialists s WHERE s.id = auth.uid() AND s.role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- device_sessions
DO $$ BEGIN
  CREATE POLICY sessions_own_rows ON device_sessions
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- audit_logs
DO $$ BEGIN
  CREATE POLICY audit_insert ON audit_logs
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY audit_admin_read ON audit_logs
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM specialists s WHERE s.id = auth.uid() AND s.role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- FUNCTION + TRIGGER: auto-create profile on specialist insert
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_specialist_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO specialist_profiles (specialist_id)
  VALUES (NEW.id)
  ON CONFLICT (specialist_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  CREATE TRIGGER auto_create_profile
    AFTER INSERT ON specialists
    FOR EACH ROW EXECUTE FUNCTION create_specialist_profile();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
