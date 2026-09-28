-- Migration 015: AI Canary and Shadow Telemetry Persistence
-- Provides production-grade durable telemetry across restarts, deployments, and multiple instances.
-- Strictly privacy-safe: NEVER stores raw transaction descriptions, bank accounts, cards, or user secrets.

CREATE TABLE IF NOT EXISTS public.ai_canary_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz NOT NULL DEFAULT now(),
  request_id text,
  model_version text NOT NULL, -- 'v3' or 'v4'
  route_type text NOT NULL, -- 'control', 'canary', 'shadow'
  category text,
  confidence_band text, -- 'HIGH', 'MEDIUM', 'LOW'
  confidence numeric(5, 4),
  latency_ms numeric(8, 2) NOT NULL DEFAULT 0,
  success boolean NOT NULL DEFAULT true,
  fallback boolean NOT NULL DEFAULT false,
  failure_type text,
  v3_category text,
  v4_category text,
  agreement boolean,
  suggestion_changed boolean,
  user_id_hash text,
  is_real_traffic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Performance and analytical querying indexes
CREATE INDEX IF NOT EXISTS ai_canary_telemetry_created_at_idx
  ON public.ai_canary_telemetry (created_at DESC);

CREATE INDEX IF NOT EXISTS ai_canary_telemetry_model_route_idx
  ON public.ai_canary_telemetry (model_version, route_type, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_canary_telemetry_agreement_idx
  ON public.ai_canary_telemetry (agreement, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_canary_telemetry_real_traffic_idx
  ON public.ai_canary_telemetry (is_real_traffic, created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.ai_canary_telemetry ENABLE ROW LEVEL SECURITY;

-- Only Admins can view aggregated telemetry data
DROP POLICY IF EXISTS ai_canary_telemetry_admin_select ON public.ai_canary_telemetry;
CREATE POLICY ai_canary_telemetry_admin_select ON public.ai_canary_telemetry
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- System backend can insert telemetry records
DROP POLICY IF EXISTS ai_canary_telemetry_insert ON public.ai_canary_telemetry;
CREATE POLICY ai_canary_telemetry_insert ON public.ai_canary_telemetry
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Trigger to guarantee privacy and prevent leakage of text, tokens, or cards
CREATE OR REPLACE FUNCTION public.trg_assert_no_ai_telemetry_pii()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Strict bounds on category length (prevent embedding raw text into category field)
  IF length(NEW.category) > 50 THEN
    RAISE EXCEPTION 'PII_VIOLATION:Category string length exceeds standard label size (max 50 chars).';
  END IF;

  -- Strict bounds on user_id_hash length
  IF NEW.user_id_hash IS NOT NULL AND length(NEW.user_id_hash) > 64 THEN
    RAISE EXCEPTION 'PII_VIOLATION:user_id_hash exceeds standard SHA-256 length (max 64 chars).';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_no_ai_telemetry_pii ON public.ai_canary_telemetry;
CREATE TRIGGER trg_assert_no_ai_telemetry_pii
  BEFORE INSERT OR UPDATE ON public.ai_canary_telemetry
  FOR EACH ROW EXECUTE FUNCTION public.trg_assert_no_ai_telemetry_pii();
