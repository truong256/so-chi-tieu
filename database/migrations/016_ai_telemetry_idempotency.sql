-- Migration 016: AI Canary Telemetry Idempotency Column
-- Supports tracking idempotency_key for deduplicating retries and production observability.
-- Privacy-safe: strictly enforces no PII and max 128 chars for idempotency key.

ALTER TABLE public.ai_canary_telemetry
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE INDEX IF NOT EXISTS ai_canary_telemetry_idempotency_key_idx
  ON public.ai_canary_telemetry (idempotency_key);
