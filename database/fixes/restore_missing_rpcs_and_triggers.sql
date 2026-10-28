-- ============================================================================
-- SỔ CHI TIÊU -- KHÔI PHỤC RPC TÀI CHÍNH & RÀNG BUỘC SAU KHI RESTORE DATABASE
-- ============================================================================
-- Hướng dẫn (tùy chọn nâng cao):
--   Mở Supabase Dashboard > SQL Editor > New Query > Dán nội dung file này > Run
--   Lưu ý: Frontend & Backend hiện đã có cơ chế fallback tự động nên bạn vẫn lưu
--   dữ liệu bình thường ngay cả khi chưa chạy script này. Chạy script này giúp
--   khôi phục đầy đủ các hàm RPC chạy nguyên tử (atomic) trên PostgreSQL.
-- ============================================================================

-- 1. Cho phép icon rỗng hoặc mặc định hợp lệ trên wallets & categories
ALTER TABLE public.wallets ALTER COLUMN icon SET DEFAULT 'wallet';
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_icon_check;
ALTER TABLE public.wallets ADD CONSTRAINT wallets_icon_check CHECK (char_length(icon) <= 32);

ALTER TABLE public.categories ALTER COLUMN icon SET DEFAULT 'circle';
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_icon_check;
ALTER TABLE public.categories ADD CONSTRAINT categories_icon_check CHECK (char_length(icon) <= 32);

-- Mở rộng frequency cho recurring_transactions để tương thích chuẩn v2
ALTER TABLE public.recurring_transactions DROP CONSTRAINT IF EXISTS recurring_transactions_frequency_check;
ALTER TABLE public.recurring_transactions ADD CONSTRAINT recurring_transactions_frequency_check
  CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semi-annually', 'yearly', 'custom'));

-- 2. Hàm kiểm tra số dư khả dụng của ví
CREATE OR REPLACE FUNCTION public.check_wallet_available_balance(
  p_wallet_id uuid,
  p_expense_amount numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_wallet public.wallets%ROWTYPE;
  v_current_balance numeric;
  v_reserved numeric;
  v_available numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED:Chưa đăng nhập.';
  END IF;
  IF p_expense_amount IS NULL OR p_expense_amount <= 0 OR p_expense_amount > 1000000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT:Số tiền phải lớn hơn 0 và nằm trong giới hạn cho phép.';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE id = p_wallet_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_FORBIDDEN:Ví không tồn tại hoặc không thuộc tài khoản.';
  END IF;

  SELECT
    COALESCE(v_wallet.balance, 0)
      + COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income' AND t.wallet_id = p_wallet_id), 0)
      - COALESCE(SUM(t.amount) FILTER (
          WHERE t.type = 'expense'
            AND (t.wallet_id = p_wallet_id OR (t.payment_source_type = 'budget' AND b.source_wallet_id = p_wallet_id))
        ), 0)
  INTO v_current_balance
  FROM public.transactions t
  LEFT JOIN public.budgets b ON b.id = t.budget_id
  WHERE t.user_id = v_user_id;

  SELECT
    v_current_balance
      + COALESCE(SUM(tr.amount) FILTER (WHERE tr.to_wallet_id = p_wallet_id), 0)
      - COALESCE(SUM(tr.amount) FILTER (WHERE tr.from_wallet_id = p_wallet_id), 0)
  INTO v_current_balance
  FROM public.transfers tr
  WHERE tr.user_id = v_user_id;

  SELECT
    COALESCE((SELECT SUM(remaining_amount) FROM public.budgets
      WHERE user_id = v_user_id AND source_wallet_id = p_wallet_id AND status = 'active' AND remaining_amount > 0), 0)
    + COALESCE((SELECT SUM(reserved_in_wallet) FROM public.savings_goals
      WHERE user_id = v_user_id AND source_wallet_id = p_wallet_id AND reserved_in_wallet > 0), 0)
  INTO v_reserved;

  v_available := COALESCE(v_current_balance, v_wallet.balance) - COALESCE(v_reserved, 0);
  RETURN jsonb_build_object(
    'allowed', p_expense_amount <= v_available,
    'wallet_name', v_wallet.name,
    'available_balance', v_available,
    'missing_amount', GREATEST(p_expense_amount - v_available, 0)
  );
END;
$$;

-- 3. Hàm tính số dư thực tế của tất cả ví thuộc user
CREATE OR REPLACE FUNCTION public.get_true_wallet_balances()
RETURNS TABLE (wallet_id uuid, true_balance numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT w.id,
    w.balance
    + COALESCE((SELECT SUM(t.amount) FROM public.transactions t WHERE t.user_id = auth.uid() AND t.wallet_id = w.id AND t.type = 'income'), 0)
    - COALESCE((SELECT SUM(t.amount) FROM public.transactions t LEFT JOIN public.budgets b ON b.id = t.budget_id
        WHERE t.user_id = auth.uid() AND t.type = 'expense'
          AND (t.wallet_id = w.id OR (t.payment_source_type = 'budget' AND b.source_wallet_id = w.id))), 0)
    + COALESCE((SELECT SUM(tr.amount) FROM public.transfers tr WHERE tr.user_id = auth.uid() AND tr.to_wallet_id = w.id), 0)
    - COALESCE((SELECT SUM(tr.amount) FROM public.transfers tr WHERE tr.user_id = auth.uid() AND tr.from_wallet_id = w.id), 0)
  FROM public.wallets w
  WHERE w.user_id = auth.uid();
$$;

-- 4. Các hàm RPC quản lý Ngân sách (Chuẩn Migration 018)
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
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000000 THEN
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
  IF btrim(COALESCE(p_name, '')) = '' OR length(p_name) > 100 THEN RAISE EXCEPTION 'INVALID_NAME:Tên ngân sách phải từ 1 đến 100 ký tự.'; END IF;
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

  IF v_budget.source_wallet_id IS NOT NULL AND v_budget.remaining_amount > 0 THEN
    UPDATE public.wallets
    SET reserved_amount = GREATEST(0, reserved_amount - v_budget.remaining_amount), updated_at = now()
    WHERE id = v_budget.source_wallet_id AND user_id = v_user_id;

    INSERT INTO public.fund_allocations(user_id, type, wallet_id, budget_id, amount, note)
    VALUES (v_user_id, 'budget_to_wallet', v_budget.source_wallet_id, v_budget.id, v_budget.remaining_amount, 'Hoàn trả khi đóng/xóa ngân sách');
  END IF;

  IF EXISTS (SELECT 1 FROM public.transactions WHERE budget_id = v_budget.id) THEN
    UPDATE public.budgets
    SET remaining_amount = 0, status = 'cancelled', updated_at = now()
    WHERE id = v_budget.id;
    RETURN 'closed';
  END IF;

  DELETE FROM public.budgets WHERE id = v_budget.id;
  RETURN 'deleted';
END;
$$;

-- 5. Các hàm RPC quản lý Mục tiêu tiết kiệm & Giao dịch định kỳ
CREATE OR REPLACE FUNCTION public.adjust_goal_funds(
  p_goal_id uuid,
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
  v_goal public.savings_goals%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_check jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED:Chưa đăng nhập.'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT:Số tiền không hợp lệ.';
  END IF;
  SELECT * INTO v_goal FROM public.savings_goals WHERE id = p_goal_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GOAL_FORBIDDEN:Mục tiêu không thuộc tài khoản.'; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_FORBIDDEN:Ví không thuộc tài khoản.'; END IF;

  IF p_direction = 'allocate' THEN
    IF v_goal.source_wallet_id IS NOT NULL AND v_goal.source_wallet_id <> p_wallet_id AND v_goal.reserved_in_wallet > 0 THEN
      RAISE EXCEPTION 'GOAL_WALLET_MISMATCH:Hãy rút hết mục tiêu trước khi đổi ví nguồn.';
    END IF;
    IF v_goal.current_amount + p_amount > v_goal.target_amount THEN
      RAISE EXCEPTION 'GOAL_LIMIT:Số tiền nạp vượt mục tiêu tiết kiệm.';
    END IF;
    v_check := public.check_wallet_available_balance(p_wallet_id, p_amount);
    IF NOT (v_check->>'allowed')::boolean THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE:Ví không đủ số dư khả dụng.'; END IF;
    PERFORM set_config('app.finance_rpc', 'on', true);
    UPDATE public.savings_goals SET
      current_amount = current_amount + p_amount,
      reserved_in_wallet = reserved_in_wallet + p_amount,
      source_wallet_id = p_wallet_id,
      updated_at = now()
    WHERE id = p_goal_id;
    UPDATE public.wallets SET reserved_amount = reserved_amount + p_amount, updated_at = now() WHERE id = p_wallet_id;
    INSERT INTO public.fund_allocations(user_id, type, wallet_id, goal_id, amount, note)
    VALUES (v_user_id, 'wallet_to_goal', p_wallet_id, p_goal_id, p_amount, 'Phân bổ mục tiêu');
  ELSIF p_direction = 'return' THEN
    IF v_goal.source_wallet_id <> p_wallet_id THEN RAISE EXCEPTION 'GOAL_WALLET_MISMATCH:Mục tiêu không liên kết ví nguồn này.'; END IF;
    IF p_amount > v_goal.current_amount OR p_amount > v_goal.reserved_in_wallet THEN
      RAISE EXCEPTION 'INSUFFICIENT_GOAL:Số tiền rút vượt số dư mục tiêu.';
    END IF;
    PERFORM set_config('app.finance_rpc', 'on', true);
    UPDATE public.savings_goals SET
      current_amount = current_amount - p_amount,
      reserved_in_wallet = reserved_in_wallet - p_amount,
      updated_at = now()
    WHERE id = p_goal_id;
    UPDATE public.wallets SET reserved_amount = GREATEST(0, reserved_amount - p_amount), updated_at = now() WHERE id = p_wallet_id;
    INSERT INTO public.fund_allocations(user_id, type, wallet_id, goal_id, amount, note)
    VALUES (v_user_id, 'goal_to_wallet', p_wallet_id, p_goal_id, p_amount, 'Rút tiền khỏi mục tiêu');
  ELSE
    RAISE EXCEPTION 'INVALID_DIRECTION:Hướng điều chỉnh không hợp lệ.';
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_goal_with_allocation(
  p_title text,
  p_target_amount numeric,
  p_initial_deposit numeric DEFAULT 0,
  p_wallet_id uuid DEFAULT NULL,
  p_deadline date DEFAULT NULL,
  p_color text DEFAULT '#D9F45F'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_goal_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED:Chưa đăng nhập.'; END IF;
  IF btrim(COALESCE(p_title, '')) = '' OR length(p_title) > 120 THEN RAISE EXCEPTION 'INVALID_NAME:Tên mục tiêu không hợp lệ.'; END IF;
  IF p_target_amount IS NULL OR p_target_amount <= 0 OR p_target_amount > 1000000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT:Số tiền mục tiêu không hợp lệ.';
  END IF;
  IF p_initial_deposit IS NULL OR p_initial_deposit < 0 OR p_initial_deposit > p_target_amount THEN
    RAISE EXCEPTION 'INVALID_AMOUNT:Khoản gửi ban đầu không hợp lệ.';
  END IF;
  IF p_initial_deposit > 0 AND p_wallet_id IS NULL THEN RAISE EXCEPTION 'WALLET_REQUIRED:Hãy chọn ví nguồn.'; END IF;
  INSERT INTO public.savings_goals(
    user_id, title, target_amount, current_amount, reserved_in_wallet,
    source_wallet_id, deadline, color
  ) VALUES (
    v_user_id, btrim(p_title), p_target_amount, 0, 0,
    p_wallet_id, p_deadline, left(COALESCE(p_color, '#D9F45F'), 20)
  ) RETURNING id INTO v_goal_id;
  IF p_initial_deposit > 0 THEN
    PERFORM public.adjust_goal_funds(v_goal_id, p_wallet_id, p_initial_deposit, 'allocate');
  END IF;
  RETURN v_goal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_recurring_transaction(
  p_recurring_id uuid,
  p_occurred_at timestamptz,
  p_next_run_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_schedule public.recurring_transactions%ROWTYPE;
  v_category text;
  v_transaction_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED:Chưa đăng nhập.'; END IF;
  SELECT * INTO v_schedule FROM public.recurring_transactions
  WHERE id = p_recurring_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND OR NOT v_schedule.active THEN RAISE EXCEPTION 'RECURRING_UNAVAILABLE:Lịch định kỳ không tồn tại hoặc đã tắt.'; END IF;
  IF p_next_run_at IS NULL OR p_next_run_at <= v_schedule.next_run_at THEN
    RAISE EXCEPTION 'INVALID_NEXT_RUN:Lần chạy tiếp theo phải sau lần hiện tại.';
  END IF;
  SELECT name INTO v_category FROM public.categories WHERE id = v_schedule.category_id AND user_id = v_user_id;
  INSERT INTO public.transactions(
    user_id, title, amount, type, category, category_id, wallet_id, occurred_at, note, recurrence_id
  ) VALUES (
    v_user_id, v_schedule.title, v_schedule.amount, v_schedule.type,
    COALESCE(v_category, CASE WHEN v_schedule.type = 'income' THEN 'Thu khác' ELSE 'Khác' END),
    v_schedule.category_id, v_schedule.wallet_id, COALESCE(p_occurred_at, v_schedule.next_run_at),
    v_schedule.note, v_schedule.id
  ) RETURNING id INTO v_transaction_id;
  UPDATE public.recurring_transactions
  SET next_run_at = p_next_run_at, last_processed_at = now(), updated_at = now()
  WHERE id = v_schedule.id;
  RETURN v_transaction_id;
END;
$$;

-- 6. Cấp quyền thực thi cho người dùng đã đăng nhập (authenticated)
REVOKE ALL ON FUNCTION public.get_true_wallet_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_true_wallet_balances() TO authenticated;

REVOKE ALL ON FUNCTION public.adjust_budget_funds(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_budget_funds(uuid, uuid, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_budget_with_allocation(text, numeric, uuid, uuid, text, date, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_budget_with_allocation(text, numeric, uuid, uuid, text, date, integer, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.update_budget_limit(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_budget_limit(uuid, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.close_budget(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_budget(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.adjust_goal_funds(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_goal_funds(uuid, uuid, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_goal_with_allocation(text, numeric, numeric, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_goal_with_allocation(text, numeric, numeric, uuid, date, text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_recurring_transaction(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_recurring_transaction(uuid, timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

