-- Migration 017: AI Telemetry Integrity Hardening & Database-Level Idempotency
-- 1. Lock down write permissions: Deny anon and authenticated users from inserting telemetry directly.
--    Only service_role (backend server with SUPABASE_SERVICE_ROLE_KEY) is granted INSERT.
-- 2. Enforce database-level idempotency via partial UNIQUE index on idempotency_key.
-- 3. Enforce maximum key length constraint (<= 128 characters) on idempotency_key.

-- Step 1: Revoke direct INSERT privileges from browser/client roles
DROP POLICY IF EXISTS ai_canary_telemetry_insert ON public.ai_canary_telemetry;

REVOKE INSERT ON public.ai_canary_telemetry FROM anon, authenticated;

-- Grant INSERT & management permissions strictly to service_role (server-side only)
GRANT ALL ON public.ai_canary_telemetry TO service_role;

-- Allow authenticated users SELECT only if they are administrators (per existing policy)
GRANT SELECT ON public.ai_canary_telemetry TO authenticated;

-- Step 2: Clean any potential historical duplicates before creating unique index
DELETE FROM public.ai_canary_telemetry a
USING public.ai_canary_telemetry b
WHERE a.idempotency_key IS NOT NULL
  AND a.idempotency_key = b.idempotency_key
  AND (a.created_at > b.created_at OR (a.created_at = b.created_at AND a.id > b.id));

-- Step 3: Replace standard index with Partial UNIQUE Index for distributed idempotency
DROP INDEX IF EXISTS public.ai_canary_telemetry_idempotency_key_idx;

CREATE UNIQUE INDEX IF NOT EXISTS ai_canary_telemetry_idempotency_key_uidx
  ON public.ai_canary_telemetry (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Step 4: Enforce max 128-char constraint at database level
ALTER TABLE public.ai_canary_telemetry
  DROP CONSTRAINT IF EXISTS ai_canary_telemetry_idempotency_key_len_chk;

ALTER TABLE public.ai_canary_telemetry
  ADD CONSTRAINT ai_canary_telemetry_idempotency_key_len_chk
  CHECK (
    idempotency_key IS NULL
    OR length(idempotency_key) <= 128
  );
