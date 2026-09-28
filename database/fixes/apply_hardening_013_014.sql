-- ============================================================================
-- SỔ CHI TIÊU — REPAIR ADMIN RBAC SCHEMA & SECURITY HARDENING
-- Copy and run in Supabase Dashboard > SQL Editor > New query > Run.
-- ============================================================================

BEGIN;

-- ─── 1. PUBLIC.APP_ROLE ENUM ────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'app_role'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.app_role AS ENUM ('user', 'admin');
  END IF;
END $$;

-- ─── 2. PUBLIC.USER_ROLES TABLE ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user'::public.app_role,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_user_id_unique UNIQUE (user_id)
);

-- ─── 3. USER_ROLES INDEX ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS user_roles_user_id_role_idx
  ON public.user_roles (user_id, role);

-- ─── 4. ENABLE RLS ON USER_ROLES ────────────────────────────────────────────
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ─── 5. OWN-ROLE SELECT POLICY (STRICT ANTI-SELF-PROMOTION) ─────────────────
DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
DROP POLICY IF EXISTS user_roles_insert_prohibited ON public.user_roles;
DROP POLICY IF EXISTS user_roles_update_prohibited ON public.user_roles;
DROP POLICY IF EXISTS user_roles_delete_prohibited ON public.user_roles;

-- Authenticated users can ONLY view their own assigned role record
CREATE POLICY user_roles_select_own ON public.user_roles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Strict Anti Self-Promotion:
-- NO INSERT, UPDATE, or DELETE policies exist for authenticated or anon roles.
-- Table-level permissions explicitly restrict modification:
GRANT SELECT ON public.user_roles TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM PUBLIC, anon, authenticated;

-- ─── 6. SECURITY DEFINER HELPER: has_role ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_role(
  p_user_id uuid,
  p_role public.app_role
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = p_role
  );
$$;

-- ─── 7. SECURITY DEFINER HELPER: is_admin ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.has_role(auth.uid(), 'admin'::public.app_role);
$$;

-- ─── 8. SECURITY DEFINER HELPER: get_my_role ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT role::text INTO v_role
  FROM public.user_roles
  WHERE user_id = auth.uid();

  RETURN COALESCE(v_role, 'user');
END;
$$;

-- ─── 9. STRICT EXECUTE PRIVILEGES ON ROLE FUNCTIONS ─────────────────────────
-- Internal checker has_role is NOT directly callable by client roles
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;

-- Client-facing RPCs: strictly authenticated only
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

-- ─── 10. AUTH TRIGGER PROVISIONING (PRESERVING CLOUD PROFILE LOGIC) ─────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name text;
  v_username  text;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1), 'Bạn');
  v_username  := NULLIF(btrim(lower(COALESCE(NEW.raw_user_meta_data->>'username', ''))), '');

  -- 1. Create or update profile
  INSERT INTO public.profiles (id, username, full_name, currency, language)
  VALUES (
    NEW.id,
    NULLIF(left(v_username, 24), ''),
    left(v_full_name, 120),
    'VND',
    'vi'
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      username  = COALESCE(profiles.username, EXCLUDED.username),
      updated_at = now();

  -- 2. Default RBAC provision: strictly 'user'. NEVER admin.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user'::public.app_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Protect trigger function from direct RPC invocation
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Reattach trigger cleanly
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ─── 11. BACKFILL EXISTING USERS ────────────────────────────────────────────
-- Backfill existing profiles and auth users with default 'user' role if not already assigned
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'user'::public.app_role
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'user'::public.app_role
FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- ─── 12. DEPENDENT ADMIN OBJECTS: AI USAGE & AUDIT LOGS (010) ───────────────
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  feature text NOT NULL,
  model text NOT NULL,
  success boolean NOT NULL DEFAULT true,
  latency_ms integer NOT NULL DEFAULT 0,
  error_code text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_logs_created_at_idx
  ON public.ai_usage_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_logs_feature_created_at_idx
  ON public.ai_usage_logs (feature, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_logs_user_id_idx
  ON public.ai_usage_logs (user_id);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_logs_admin_select ON public.ai_usage_logs;
CREATE POLICY ai_usage_logs_admin_select ON public.ai_usage_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.ai_usage_logs TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ai_usage_logs FROM PUBLIC, anon, authenticated;

-- Immutable Admin Audit Logs
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_at_idx
  ON public.admin_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_action_created_at_idx
  ON public.admin_audit_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_admin_id_idx
  ON public.admin_audit_logs (admin_id);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_audit_logs_admin_select ON public.admin_audit_logs;
CREATE POLICY admin_audit_logs_admin_select ON public.admin_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.admin_audit_logs TO authenticated;
REVOKE UPDATE, DELETE ON public.admin_audit_logs FROM PUBLIC, anon, authenticated;

-- Secure Audit Recording RPC
CREATE OR REPLACE FUNCTION public.record_admin_audit(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_log_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'AUTH_FORBIDDEN:Chỉ quản trị viên mới có quyền ghi nhật ký kiểm toán.';
  END IF;

  INSERT INTO public.admin_audit_logs (
    admin_id,
    action,
    target_type,
    target_id,
    metadata
  ) VALUES (
    v_admin_id,
    p_action,
    p_target_type,
    p_target_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_admin_audit(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_admin_audit(text, text, text, jsonb) TO authenticated;

-- ─── 13. DEPENDENT ADMIN OBJECTS: SYSTEM SETTINGS (011) ──────────────────────
CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_settings_read ON public.system_settings;
CREATE POLICY system_settings_read ON public.system_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS system_settings_admin_modify ON public.system_settings;
CREATE POLICY system_settings_admin_modify ON public.system_settings
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO authenticated;

-- Seed default flags idempotently
INSERT INTO public.system_settings (key, value, description)
VALUES
  ('ai_enabled', 'true'::jsonb, 'Bật/tắt tính năng Trợ lý AI và phân tích thông minh'),
  ('receipt_scan_enabled', 'true'::jsonb, 'Bật/tắt tính năng quét và trích xuất hóa đơn tự động'),
  ('maintenance_mode', 'false'::jsonb, 'Chế độ bảo trì hệ thống')
ON CONFLICT (key) DO NOTHING;

-- Secret protection trigger function
CREATE OR REPLACE FUNCTION public.trg_protect_system_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(NEW.key) LIKE '%key%' OR lower(NEW.key) LIKE '%secret%' OR lower(NEW.key) LIKE '%token%' OR lower(NEW.key) LIKE '%password%' THEN
    RAISE EXCEPTION 'FORBIDDEN_KEY:Không được lưu trữ khóa bảo mật hoặc secret vào bảng cấu hình hệ thống.';
  END IF;

  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_system_settings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_system_settings ON public.system_settings;
CREATE TRIGGER trg_protect_system_settings
  BEFORE INSERT OR UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.trg_protect_system_settings();

-- ─── 14. SECURITY DEFINER & RPC ACCESS HARDENING (013) ──────────────────────
DO $$
BEGIN
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

  IF to_regprocedure('public.trg_guard_financial_totals()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_guard_financial_totals() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trg_validate_owned_relations()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_validate_owned_relations() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.check_wallet_available_balance(uuid,numeric)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.check_wallet_available_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.get_true_wallet_balances()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_true_wallet_balances() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_true_wallet_balances() TO authenticated;
  END IF;

  IF to_regprocedure('public.close_budget(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.close_budget(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.close_budget(uuid) TO authenticated;
  END IF;
END $$;

-- ─── 15. PERFORMANCE INDEXES & RLS OPTIMIZATION (014) ───────────────────────
CREATE INDEX IF NOT EXISTS fund_allocations_budget_id_idx
  ON public.fund_allocations (budget_id) WHERE budget_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS fund_allocations_goal_id_idx
  ON public.fund_allocations (goal_id) WHERE goal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS fund_allocations_wallet_id_idx
  ON public.fund_allocations (wallet_id) WHERE wallet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS recurring_occurrences_transaction_id_idx
  ON public.recurring_occurrences (transaction_id) WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS savings_goals_source_wallet_id_idx
  ON public.savings_goals (source_wallet_id) WHERE source_wallet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_goal_id_idx
  ON public.transactions (goal_id) WHERE goal_id IS NOT NULL;

-- Drop duplicate indexes
DROP INDEX IF EXISTS public.transactions_user_occurred_idx;
DROP INDEX IF EXISTS public.transfers_user_occurred_idx;

-- Consolidate policies & optimize with (SELECT auth.uid())
-- Wallets
DROP POLICY IF EXISTS "Wallets are viewable by owner" ON public.wallets;
DROP POLICY IF EXISTS "Wallets can be inserted by owner" ON public.wallets;
DROP POLICY IF EXISTS "Wallets can be updated by owner" ON public.wallets;
DROP POLICY IF EXISTS "Wallets can be deleted by owner" ON public.wallets;
DROP POLICY IF EXISTS "Users can manage own wallets" ON public.wallets;

CREATE POLICY "Users can manage own wallets" ON public.wallets
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Categories
DROP POLICY IF EXISTS "Categories are viewable by owner" ON public.categories;
DROP POLICY IF EXISTS "Categories can be inserted by owner" ON public.categories;
DROP POLICY IF EXISTS "Categories can be updated by owner" ON public.categories;
DROP POLICY IF EXISTS "Categories can be deleted by owner" ON public.categories;
DROP POLICY IF EXISTS "Users can manage own categories" ON public.categories;

CREATE POLICY "Users can manage own categories" ON public.categories
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Transactions
DROP POLICY IF EXISTS "Transactions are viewable by owner" ON public.transactions;
DROP POLICY IF EXISTS "Transactions can be inserted by owner" ON public.transactions;
DROP POLICY IF EXISTS "Transactions can be updated by owner" ON public.transactions;
DROP POLICY IF EXISTS "Transactions can be deleted by owner" ON public.transactions;
DROP POLICY IF EXISTS "Users can manage own transactions" ON public.transactions;

CREATE POLICY "Users can manage own transactions" ON public.transactions
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Transfers
DROP POLICY IF EXISTS "Transfers are viewable by owner" ON public.transfers;
DROP POLICY IF EXISTS "Transfers can be inserted by owner" ON public.transfers;
DROP POLICY IF EXISTS "Transfers can be updated by owner" ON public.transfers;
DROP POLICY IF EXISTS "Transfers can be deleted by owner" ON public.transfers;
DROP POLICY IF EXISTS "Users can manage own transfers" ON public.transfers;

CREATE POLICY "Users can manage own transfers" ON public.transfers
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Budgets
DROP POLICY IF EXISTS "Budgets are viewable by owner" ON public.budgets;
DROP POLICY IF EXISTS "Budgets can be inserted by owner" ON public.budgets;
DROP POLICY IF EXISTS "Budgets can be updated by owner" ON public.budgets;
DROP POLICY IF EXISTS "Budgets can be deleted by owner" ON public.budgets;
DROP POLICY IF EXISTS "Users can manage own budgets" ON public.budgets;

CREATE POLICY "Users can manage own budgets" ON public.budgets
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Savings Goals
DROP POLICY IF EXISTS "Savings goals are viewable by owner" ON public.savings_goals;
DROP POLICY IF EXISTS "Savings goals can be inserted by owner" ON public.savings_goals;
DROP POLICY IF EXISTS "Savings goals can be updated by owner" ON public.savings_goals;
DROP POLICY IF EXISTS "Savings goals can be deleted by owner" ON public.savings_goals;
DROP POLICY IF EXISTS "Users can manage own savings goals" ON public.savings_goals;

CREATE POLICY "Users can manage own savings goals" ON public.savings_goals
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Recurring Transactions
DROP POLICY IF EXISTS "Recurring transactions are viewable by owner" ON public.recurring_transactions;
DROP POLICY IF EXISTS "Recurring transactions can be inserted by owner" ON public.recurring_transactions;
DROP POLICY IF EXISTS "Recurring transactions can be updated by owner" ON public.recurring_transactions;
DROP POLICY IF EXISTS "Recurring transactions can be deleted by owner" ON public.recurring_transactions;
DROP POLICY IF EXISTS "Users can manage own recurring transactions" ON public.recurring_transactions;

CREATE POLICY "Users can manage own recurring transactions" ON public.recurring_transactions
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Fund Allocations
DROP POLICY IF EXISTS "Users can manage own fund allocations" ON public.fund_allocations;

CREATE POLICY "Users can manage own fund allocations" ON public.fund_allocations
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Profiles
DROP POLICY IF EXISTS "Profiles are viewable by owner" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can manage own profile" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

COMMIT;
