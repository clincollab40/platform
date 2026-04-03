-- ═══════════════════════════════════════════════════════
-- ClinCollab — Migration 002
-- Module 2: Doctor Network Map
-- Referrers, referral logs, notes, health snapshots
-- ═══════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE referrer_status AS ENUM ('new', 'active', 'drifting', 'silent', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE case_type AS ENUM ('procedure', 'opd_consultation', 'emergency', 'investigation', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- TABLE: referrers
-- The private peer network of each specialist
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  clinic_name       TEXT,
  clinic_area       TEXT,
  city              TEXT NOT NULL,
  mobile            TEXT,
  whatsapp          TEXT,
  specialty         TEXT,
  status            referrer_status NOT NULL DEFAULT 'new',
  total_referrals   INTEGER NOT NULL DEFAULT 0,
  last_referral_at  TIMESTAMPTZ,
  days_since_last   INTEGER, -- computed in queries: EXTRACT(DAY FROM NOW()-last_referral_at)
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  imported_from_seed UUID REFERENCES peer_seeds(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrers_specialist_id ON referrers(specialist_id);
CREATE INDEX IF NOT EXISTS idx_referrers_status ON referrers(status);
CREATE INDEX IF NOT EXISTS idx_referrers_city ON referrers(city);
CREATE INDEX IF NOT EXISTS idx_referrers_last_referral ON referrers(last_referral_at DESC NULLS LAST);
-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_referrers_search ON referrers
  USING GIN(to_tsvector('english', name || ' ' || COALESCE(clinic_name,'') || ' ' || COALESCE(specialty,'')));

-- ─────────────────────────────────────────────
-- TABLE: referral_logs
-- Manual log of referrals received
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  referrer_id     UUID NOT NULL REFERENCES referrers(id) ON DELETE CASCADE,
  referred_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  case_type       case_type NOT NULL DEFAULT 'procedure',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_logs_specialist_id ON referral_logs(specialist_id);
CREATE INDEX IF NOT EXISTS idx_referral_logs_referrer_id ON referral_logs(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_logs_referred_on ON referral_logs(referred_on DESC);

-- ─────────────────────────────────────────────
-- TABLE: referrer_notes
-- Free-text notes the specialist adds per referrer
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrer_notes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id   UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  referrer_id     UUID NOT NULL REFERENCES referrers(id) ON DELETE CASCADE,
  note            TEXT NOT NULL,
  noted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrer_notes_referrer_id ON referrer_notes(referrer_id);

-- ─────────────────────────────────────────────
-- TABLE: network_health_snapshots
-- Daily snapshot for trend analysis
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS network_health_snapshots (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  specialist_id     UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  snapshot_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  total_referrers   INTEGER NOT NULL DEFAULT 0,
  active_count      INTEGER NOT NULL DEFAULT 0,
  drifting_count    INTEGER NOT NULL DEFAULT 0,
  silent_count      INTEGER NOT NULL DEFAULT 0,
  new_count         INTEGER NOT NULL DEFAULT 0,
  health_score      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(specialist_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_specialist_date ON network_health_snapshots(specialist_id, snapshot_date DESC);

-- ─────────────────────────────────────────────
-- VIEW: v_admin_network_health
-- Admin sees aggregate metrics — zero referrer PII
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_admin_network_health AS
SELECT
  s.id                AS specialist_id,
  s.name              AS specialist_name,
  s.specialty,
  s.city,
  s.status            AS specialist_status,
  COUNT(r.id) FILTER (WHERE r.is_deleted = FALSE)                           AS total_referrers,
  COUNT(r.id) FILTER (WHERE r.status = 'active'   AND r.is_deleted = FALSE) AS active_count,
  COUNT(r.id) FILTER (WHERE r.status = 'drifting' AND r.is_deleted = FALSE) AS drifting_count,
  COUNT(r.id) FILTER (WHERE r.status = 'silent'   AND r.is_deleted = FALSE) AS silent_count,
  COUNT(r.id) FILTER (WHERE r.status = 'new'      AND r.is_deleted = FALSE) AS new_count,
  COALESCE(
    ROUND(
      100.0 * COUNT(r.id) FILTER (WHERE r.status = 'active' AND r.is_deleted = FALSE)
      / NULLIF(COUNT(r.id) FILTER (WHERE r.is_deleted = FALSE), 0)
    ), 0
  )::INTEGER                                                                 AS active_ratio_pct,
  s.last_active_at
FROM specialists s
LEFT JOIN referrers r ON r.specialist_id = s.id
GROUP BY s.id, s.name, s.specialty, s.city, s.status, s.last_active_at;

-- ─────────────────────────────────────────────
-- FUNCTION: update referrer status after log
-- Auto-recomputes status when a referral is logged
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_referrer_after_log()
RETURNS TRIGGER AS $$
DECLARE
  v_days_since INTEGER;
  v_new_status referrer_status;
BEGIN
  -- Update last_referral_at and total count on referrers
  UPDATE referrers
  SET
    last_referral_at = (
      SELECT MAX(referred_on::TIMESTAMPTZ)
      FROM referral_logs
      WHERE referrer_id = NEW.referrer_id
    ),
    total_referrals = (
      SELECT COUNT(*)
      FROM referral_logs
      WHERE referrer_id = NEW.referrer_id
    ),
    updated_at = NOW()
  WHERE id = NEW.referrer_id;

  -- Recompute status
  SELECT days_since_last INTO v_days_since
  FROM referrers WHERE id = NEW.referrer_id;

  v_new_status := CASE
    WHEN v_days_since IS NULL THEN 'new'
    WHEN v_days_since < 30   THEN 'active'
    WHEN v_days_since < 90   THEN 'drifting'
    ELSE 'silent'
  END;

  UPDATE referrers SET status = v_new_status WHERE id = NEW.referrer_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  CREATE TRIGGER referral_logged
    AFTER INSERT ON referral_logs
    FOR EACH ROW EXECUTE FUNCTION update_referrer_after_log();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- FUNCTION: health score computation
-- Called on demand and on snapshot
-- Score = weighted combination of active ratio + trend
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_network_health_score(p_specialist_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_total     INTEGER;
  v_active    INTEGER;
  v_drifting  INTEGER;
  v_score     INTEGER;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE is_deleted = FALSE),
    COUNT(*) FILTER (WHERE status = 'active' AND is_deleted = FALSE),
    COUNT(*) FILTER (WHERE status = 'drifting' AND is_deleted = FALSE)
  INTO v_total, v_active, v_drifting
  FROM referrers
  WHERE specialist_id = p_specialist_id;

  IF v_total = 0 THEN RETURN 0; END IF;

  -- Score: active = 1pt, drifting = 0.4pt, max 100
  v_score := LEAST(100,
    ROUND(
      100.0 * (v_active + (v_drifting * 0.4)) / GREATEST(v_total, 1)
    )::INTEGER
  );

  RETURN v_score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────
-- FUNCTION: migrate peer seeds to referrers
-- Converts Module 1 seed data to full referrer records
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION migrate_peer_seeds_to_referrers(p_specialist_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_seed RECORD;
BEGIN
  FOR v_seed IN
    SELECT * FROM peer_seeds
    WHERE specialist_id = p_specialist_id
      AND id NOT IN (
        SELECT imported_from_seed FROM referrers
        WHERE specialist_id = p_specialist_id
          AND imported_from_seed IS NOT NULL
      )
  LOOP
    INSERT INTO referrers (
      specialist_id, name, city, specialty,
      status, imported_from_seed
    ) VALUES (
      p_specialist_id,
      v_seed.peer_name,
      v_seed.peer_city,
      v_seed.peer_specialty,
      'new',
      v_seed.id
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────
-- UPDATED_AT triggers
-- ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TRIGGER referrers_updated_at
    BEFORE UPDATE ON referrers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE referrers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrer_notes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_health_snapshots ENABLE ROW LEVEL SECURITY;

-- referrers: own rows only — the critical privacy boundary
DO $$ BEGIN
  CREATE POLICY referrers_isolation ON referrers
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- referral_logs: own rows only
DO $$ BEGIN
  CREATE POLICY referral_logs_isolation ON referral_logs
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- referrer_notes: own rows only
DO $$ BEGIN
  CREATE POLICY referrer_notes_isolation ON referrer_notes
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- snapshots: own rows only
DO $$ BEGIN
  CREATE POLICY snapshots_isolation ON network_health_snapshots
    FOR ALL USING (specialist_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- SECURITY TEST: cross-specialist access attempt
-- Run this to verify isolation is working
-- ─────────────────────────────────────────────
-- SELECT COUNT(*) FROM referrers; -- Should return only current user's rows
-- SELECT COUNT(*) FROM referral_logs; -- Same
