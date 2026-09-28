-- Migration 013: Security Definer and RPC Access Hardening
-- Resolves Supabase Security Advisor warnings by revoking public execute on trigger-only functions
-- and strictly scoping client-callable RPCs to authenticated role with internal ownership checks.

-- 1. REVOKE EXECUTE ON TRIGGER-ONLY FUNCTIONS (Prevent direct API/RPC invocation)
-- In PostgreSQL, triggers execute functions with database trigger context;
-- sessions do NOT need direct EXECUTE privileges on trigger functions.

DO $$
BEGIN
  -- Trigger functions from 006, 008, 009, 011, 012
  IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trg_validate_transaction()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_validate_transaction() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trg_restore_budget_transaction()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_restore_budget_transaction() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trg_validate_transfer()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_validate_transfer() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trg_release_reserved_funds()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_release_reserved_funds() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trg_validate_transaction_delete()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_validate_transaction_delete() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trg_validate_transfer_delete()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_validate_transfer_delete() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trg_guard_wallet_totals()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_guard_wallet_totals() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trg_validate_category_relations()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_validate_category_relations() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trg_protect_system_settings()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_protect_system_settings() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trg_guard_financial_totals()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_guard_financial_totals() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trg_validate_owned_relations()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_validate_owned_relations() FROM PUBLIC, anon, authenticated;
  END IF;

  -- Obsolete or internal helper functions
  IF to_regprocedure('public.check_wallet_available_balance(uuid,numeric)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.check_wallet_available_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.has_role(uuid,public.app_role)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- 2. ENSURE EXPLICIT PRIVILEGES ON AUTHENTICATED INTENTIONAL RPCs
-- Strip PUBLIC and anon; keep ONLY authenticated.
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

REVOKE ALL ON FUNCTION public.record_admin_audit(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_admin_audit(text, text, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.get_true_wallet_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_true_wallet_balances() TO authenticated;

REVOKE ALL ON FUNCTION public.close_budget(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_budget(uuid) TO authenticated;
