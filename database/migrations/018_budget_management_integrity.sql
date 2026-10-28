-- ==========================================================================
-- Migration 018: Budget Management Integrity & Envelope Budgeting Standardization
-- ==========================================================================
-- 1. Fix close_budget to never leak reserved funds when deleting unspent budgets
-- 2. Preserve budget spending limit (amount) in adjust_budget_funds without overwriting it
-- 3. Support flexible budget creation (pure limit tracking or envelope allocation)
-- 4. Provide update_budget_limit RPC to update budget spending limit safely

-- ─── 1. CLOSE_BUDGET: Fix money locking bug ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_budget(p_budget_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_budget public.budgets%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED:Chưa đăng nhập.'; END IF;
  SELECT * INTO v_budget FROM public.budgets
  WHERE id = p_budget_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BUDGET_FORBIDDEN:Ngân sách không thuộc tài khoản.'; END IF;

  PERFORM set_config('app.finance_rpc', 'on', true);

  -- Always release any remaining funded envelope money back to the wallet
  IF v_budget.source_wallet_id IS NOT NULL AND v_budget.remaining_amount > 0 THEN
    UPDATE public.wallets
    SET reserved_amount = GREATEST(0, reserved_amount - v_budget.remaining_amount), updated_at = now()
    WHERE id = v_budget.source_wallet_id AND user_id = v_user_id;

    INSERT INTO public.fund_allocations(user_id, type, wallet_id, budget_id, amount, note)
    VALUES (v_user_id, 'budget_to_wallet', v_budget.source_wallet_id, v_budget.id, v_budget.remaining_amount, 'Hoàn trả khi đóng/xóa ngân sách');
  END IF;

  -- If transactions exist for this budget, archive it as 'cancelled' to preserve transaction history
  IF EXISTS (SELECT 1 FROM public.transactions WHERE budget_id = v_budget.id) THEN
    UPDATE public.budgets
    SET remaining_amount = 0,
        status = 'cancelled',
        updated_at = now()
    WHERE id = v_budget.id;
    RETURN 'closed';
  END IF;

  -- If no transactions exist, safely delete the budget
  DELETE FROM public.budgets WHERE id = v_budget.id;
  RETURN 'deleted';
END;
$$;

-- ─── 2. ADJUST_BUDGET_FUNDS: Do not overwrite amount (spending limit) ─────────
CREATE OR REPLACE FUNCTION public.adjust_budget_funds(
  p_budget_id uuid,
  p_wallet_id uuid,
  p_amount numeric,
  p_direction text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_budget public.budgets%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_check jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED:Chưa đăng nhập.'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount::text = 'NaN' OR p_amount > 1000000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT:Số tiền không hợp lệ.';
  END IF;
  SELECT * INTO v_budget FROM public.budgets WHERE id = p_budget_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BUDGET_FORBIDDEN:Ngân sách không thuộc tài khoản.'; END IF;

  IF p_direction = 'allocate' THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id AND user_id = v_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_FORBIDDEN:Ví không thuộc tài khoản.'; END IF;
    IF v_budget.source_wallet_id IS NOT NULL AND v_budget.source_wallet_id <> p_wallet_id AND v_budget.remaining_amount > 0 THEN
      RAISE EXCEPTION 'BUDGET_WALLET_MISMATCH:Hãy rút hết ngân sách trước khi đổi ví nguồn.';
    END IF;
    v_check := public.check_wallet_available_balance(p_wallet_id, p_amount);
    IF NOT (v_check->>'allowed')::boolean THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE:Ví không đủ số dư khả dụng.'; END IF;
    PERFORM set_config('app.finance_rpc', 'on', true);
    UPDATE public.budgets SET
      allocated_amount = allocated_amount + p_amount,
      remaining_amount = remaining_amount + p_amount,
      -- DO NOT OVERWRITE amount (spending limit)
      source_wallet_id = p_wallet_id,
      status = 'active',
      updated_at = now()
    WHERE id = p_budget_id;
    UPDATE public.wallets SET reserved_amount = reserved_amount + p_amount, updated_at = now() WHERE id = p_wallet_id;
    INSERT INTO public.fund_allocations(user_id, type, wallet_id, budget_id, amount, note)
    VALUES (v_user_id, 'wallet_to_budget', p_wallet_id, p_budget_id, p_amount, 'Phân bổ ngân sách');
  ELSIF p_direction = 'return' THEN
    IF v_budget.source_wallet_id IS NULL OR p_wallet_id <> v_budget.source_wallet_id THEN
      RAISE EXCEPTION 'BUDGET_WALLET_MISMATCH:Ngân sách không liên kết ví nguồn này.';
    END IF;
    SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id AND user_id = v_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_FORBIDDEN:Ví không thuộc tài khoản.'; END IF;
    IF p_amount > v_budget.remaining_amount THEN RAISE EXCEPTION 'INSUFFICIENT_BUDGET:Số tiền rút vượt số dư ngân sách.'; END IF;
    PERFORM set_config('app.finance_rpc', 'on', true);
    UPDATE public.budgets SET
      allocated_amount = GREATEST(0, allocated_amount - p_amount),
      remaining_amount = GREATEST(0, remaining_amount - p_amount),
      -- DO NOT OVERWRITE amount (spending limit)
      updated_at = now()
    WHERE id = p_budget_id;
    UPDATE public.wallets SET reserved_amount = GREATEST(0, reserved_amount - p_amount), updated_at = now() WHERE id = p_wallet_id;
    INSERT INTO public.fund_allocations(user_id, type, wallet_id, budget_id, amount, note)
    VALUES (v_user_id, 'budget_to_wallet', p_wallet_id, p_budget_id, p_amount, 'Rút tiền khỏi ngân sách');
  ELSE
    RAISE EXCEPTION 'INVALID_DIRECTION:Hướng điều chỉnh không hợp lệ.';
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─── 3. CREATE_BUDGET_WITH_ALLOCATION: Flexible allocation & keep limit ───────
CREATE OR REPLACE FUNCTION public.create_budget_with_allocation(
  p_name text,
  p_amount numeric,
  p_wallet_id uuid DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_period text DEFAULT 'monthly',
  p_period_start date DEFAULT CURRENT_DATE,
  p_alert_percent integer DEFAULT 80,
  p_initial_allocation numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_budget_id uuid;
  v_allocation numeric := 0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED:Chưa đăng nhập.'; END IF;
  IF btrim(COALESCE(p_name, '')) = '' OR length(p_name) > 120 THEN RAISE EXCEPTION 'INVALID_NAME:Tên ngân sách không hợp lệ.'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT:Hạn mức ngân sách phải lớn hơn 0.';
  END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories WHERE id = p_category_id AND user_id = v_user_id
  ) THEN RAISE EXCEPTION 'CATEGORY_FORBIDDEN:Danh mục không thuộc tài khoản.'; END IF;
  IF p_period NOT IN ('weekly', 'monthly', 'yearly') OR p_alert_percent NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'INVALID_BUDGET:Chu kỳ hoặc ngưỡng cảnh báo không hợp lệ.';
  END IF;

  PERFORM set_config('app.finance_rpc', 'on', true);

  -- Determine initial allocation amount:
  -- If p_initial_allocation is explicitly provided, use it.
  -- Otherwise, if p_wallet_id is provided, default to p_amount for backward compatibility.
  IF p_wallet_id IS NOT NULL THEN
    v_allocation := COALESCE(p_initial_allocation, p_amount);
  ELSE
    v_allocation := 0;
  END IF;

  INSERT INTO public.budgets(
    user_id, name, amount, allocated_amount, spent_amount, remaining_amount,
    category_id, source_wallet_id, period, period_start, alert_percent, status
  ) VALUES (
    v_user_id, btrim(p_name), p_amount, 0, 0, 0,
    p_category_id, p_wallet_id, p_period, p_period_start, p_alert_percent, 'active'
  ) RETURNING id INTO v_budget_id;

  IF p_wallet_id IS NOT NULL AND v_allocation > 0 THEN
    PERFORM public.adjust_budget_funds(v_budget_id, p_wallet_id, v_allocation, 'allocate');
  END IF;

  RETURN v_budget_id;
END;
$$;

-- ─── 4. UPDATE_BUDGET_LIMIT: Safely update spending limit ─────────────────────
CREATE OR REPLACE FUNCTION public.update_budget_limit(
  p_budget_id uuid,
  p_amount numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED:Chưa đăng nhập.'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT:Hạn mức ngân sách phải lớn hơn 0.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.budgets WHERE id = p_budget_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'BUDGET_FORBIDDEN:Ngân sách không thuộc tài khoản.';
  END IF;

  PERFORM set_config('app.finance_rpc', 'on', true);
  UPDATE public.budgets
  SET amount = p_amount, updated_at = now()
  WHERE id = p_budget_id AND user_id = v_user_id;

  RETURN jsonb_build_object('success', true, 'amount', p_amount);
END;
$$;

-- ─── 5. SECURITY & PRIVILEGES ─────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.close_budget(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_budget(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.adjust_budget_funds(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_budget_funds(uuid, uuid, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_budget_with_allocation(text, numeric, uuid, uuid, text, date, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_budget_with_allocation(text, numeric, uuid, uuid, text, date, integer, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.update_budget_limit(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_budget_limit(uuid, numeric) TO authenticated;
