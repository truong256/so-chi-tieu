-- Security and consistency hardening.
-- Apply after 000-005. This migration does not delete financial data.

-- Never auto-confirm email addresses at database level.
DROP TRIGGER IF EXISTS tr_auto_confirm_new_user ON auth.users;
DROP FUNCTION IF EXISTS public.auto_confirm_new_user();

-- Auth trigger only creates the profile. Wallets/categories are provisioned after
-- the verified user signs in, so every financial write has a real auth.uid().
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles(id, username, full_name, currency, language)
  VALUES (
    NEW.id,
    NULLIF(left(lower(btrim(COALESCE(NEW.raw_user_meta_data->>'username', ''))), 24), ''),
    left(COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1), 'Bạn'), 120),
    'VND',
    'vi'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Username-to-email lookup enables account enumeration. Login now accepts email only.
DO $$
BEGIN
  IF to_regprocedure('public.get_email_by_username(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_email_by_username(text) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- Obsolete RPC performed an unlocked check-then-insert and inherited PUBLIC
-- execution. All transaction writes now pass through the validation trigger.
DROP TRIGGER IF EXISTS trg_prevent_insufficient_expense ON public.transactions;
DROP FUNCTION IF EXISTS public.create_expense_transaction(
  text, numeric, text, uuid, uuid, timestamptz, text, text, uuid, text
);
DROP FUNCTION IF EXISTS public.trg_check_expense_balance();

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
  IF p_expense_amount IS NULL OR p_expense_amount <= 0 OR p_expense_amount::text = 'NaN' OR p_expense_amount > 1000000000000000 THEN
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

REVOKE ALL ON FUNCTION public.check_wallet_available_balance(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_wallet_available_balance(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_validate_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_check jsonb;
  v_available numeric;
  v_old_contribution numeric := 0;
  v_budget public.budgets%ROWTYPE;
BEGIN
  IF v_user_id IS NULL OR NEW.user_id <> v_user_id THEN
    RAISE EXCEPTION 'AUTH_FORBIDDEN:Không được ghi giao dịch cho tài khoản khác.';
  END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 OR NEW.amount::text = 'NaN' OR NEW.amount > 1000000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT:Số tiền giao dịch không hợp lệ.';
  END IF;
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories WHERE id = NEW.category_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'CATEGORY_FORBIDDEN:Danh mục không thuộc tài khoản.';
  END IF;
  IF NEW.goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.savings_goals WHERE id = NEW.goal_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'GOAL_FORBIDDEN:Mục tiêu không thuộc tài khoản.';
  END IF;
  IF NEW.recurrence_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.recurring_transactions WHERE id = NEW.recurrence_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'RECURRING_FORBIDDEN:Giao dịch định kỳ không thuộc tài khoản.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.payment_source_type = 'budget' AND (
    NEW.amount IS DISTINCT FROM OLD.amount OR
    NEW.type IS DISTINCT FROM OLD.type OR
    NEW.budget_id IS DISTINCT FROM OLD.budget_id OR
    NEW.payment_source_type IS DISTINCT FROM OLD.payment_source_type
  ) THEN
    RAISE EXCEPTION 'BUDGET_TRANSACTION_IMMUTABLE:Không thể đổi số tiền hoặc nguồn của giao dịch ngân sách.';
  END IF;

  IF NEW.payment_source_type = 'budget' THEN
    IF NEW.type <> 'expense' OR NEW.budget_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_BUDGET_PAYMENT:Nguồn ngân sách chỉ dùng cho khoản chi.';
    END IF;
    NEW.wallet_id := NULL;
    IF TG_OP = 'INSERT' THEN
      SELECT * INTO v_budget FROM public.budgets
      WHERE id = NEW.budget_id AND user_id = v_user_id
      FOR UPDATE;
      IF NOT FOUND OR v_budget.status <> 'active' THEN
        RAISE EXCEPTION 'BUDGET_UNAVAILABLE:Ngân sách không tồn tại hoặc đã kết thúc.';
      END IF;
      IF NEW.amount > v_budget.remaining_amount THEN
        RAISE EXCEPTION 'INSUFFICIENT_BUDGET:Ngân sách không đủ số dư.';
      END IF;
      PERFORM set_config('app.finance_rpc', 'on', true);
      UPDATE public.budgets SET
        spent_amount = spent_amount + NEW.amount,
        remaining_amount = remaining_amount - NEW.amount,
        status = CASE WHEN remaining_amount - NEW.amount <= 0 THEN 'completed' ELSE status END,
        updated_at = now()
      WHERE id = v_budget.id;
      IF v_budget.source_wallet_id IS NOT NULL THEN
        UPDATE public.wallets SET
          reserved_amount = GREATEST(0, reserved_amount - NEW.amount),
          updated_at = now()
        WHERE id = v_budget.source_wallet_id AND user_id = v_user_id;
      END IF;
    END IF;
  ELSE
    NEW.budget_id := NULL;
    IF NEW.wallet_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.wallets WHERE id = NEW.wallet_id AND user_id = v_user_id FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'WALLET_FORBIDDEN:Ví không tồn tại hoặc không thuộc tài khoản.';
    END IF;
    IF NEW.type = 'expense' THEN
      v_check := public.check_wallet_available_balance(NEW.wallet_id, NEW.amount);
      v_available := (v_check->>'available_balance')::numeric;
      IF TG_OP = 'UPDATE' AND OLD.wallet_id = NEW.wallet_id AND OLD.payment_source_type = 'wallet' THEN
        v_old_contribution := CASE WHEN OLD.type = 'income' THEN OLD.amount ELSE -OLD.amount END;
      END IF;
      IF NEW.amount > v_available - v_old_contribution THEN
        RAISE EXCEPTION 'INSUFFICIENT_BALANCE:Ví không đủ số dư khả dụng.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_insufficient_expense ON public.transactions;
DROP TRIGGER IF EXISTS trg_validate_transaction ON public.transactions;
CREATE TRIGGER trg_validate_transaction
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_transaction();

CREATE OR REPLACE FUNCTION public.trg_restore_budget_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet_id uuid;
BEGIN
  IF OLD.payment_source_type = 'budget' AND OLD.budget_id IS NOT NULL THEN
    PERFORM set_config('app.finance_rpc', 'on', true);
    UPDATE public.budgets SET
      spent_amount = GREATEST(0, spent_amount - OLD.amount),
      remaining_amount = remaining_amount + OLD.amount,
      status = CASE WHEN status = 'completed' THEN 'active' ELSE status END,
      updated_at = now()
    WHERE id = OLD.budget_id AND user_id = auth.uid()
    RETURNING source_wallet_id INTO v_wallet_id;
    IF v_wallet_id IS NOT NULL THEN
      UPDATE public.wallets SET reserved_amount = reserved_amount + OLD.amount, updated_at = now()
      WHERE id = v_wallet_id AND user_id = auth.uid();
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_restore_budget_transaction ON public.transactions;
CREATE TRIGGER trg_restore_budget_transaction
  AFTER DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_restore_budget_transaction();

CREATE OR REPLACE FUNCTION public.trg_validate_transfer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_count integer;
  v_check jsonb;
  v_available numeric;
  v_old_contribution numeric := 0;
BEGIN
  IF v_user_id IS NULL OR NEW.user_id <> v_user_id THEN
    RAISE EXCEPTION 'AUTH_FORBIDDEN:Không được chuyển tiền cho tài khoản khác.';
  END IF;
  IF NEW.from_wallet_id = NEW.to_wallet_id THEN
    RAISE EXCEPTION 'SAME_WALLET:Ví nhận phải khác ví chuyển.';
  END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 OR NEW.amount::text = 'NaN' OR NEW.amount > 1000000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT:Số tiền chuyển không hợp lệ.';
  END IF;
  PERFORM id FROM public.wallets
  WHERE id IN (NEW.from_wallet_id, NEW.to_wallet_id) AND user_id = v_user_id
  ORDER BY id FOR UPDATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'WALLET_FORBIDDEN:Một trong hai ví không thuộc tài khoản.';
  END IF;
  v_check := public.check_wallet_available_balance(NEW.from_wallet_id, NEW.amount);
  v_available := (v_check->>'available_balance')::numeric;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.from_wallet_id = NEW.from_wallet_id THEN v_old_contribution := v_old_contribution - OLD.amount; END IF;
    IF OLD.to_wallet_id = NEW.from_wallet_id THEN v_old_contribution := v_old_contribution + OLD.amount; END IF;
  END IF;
  IF NEW.amount > v_available - v_old_contribution THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE:Ví chuyển không đủ số dư khả dụng.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_transfer ON public.transfers;
CREATE TRIGGER trg_validate_transfer
  BEFORE INSERT OR UPDATE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_transfer();

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
      amount = allocated_amount + p_amount,
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
      allocated_amount = allocated_amount - p_amount,
      remaining_amount = remaining_amount - p_amount,
      amount = allocated_amount - p_amount,
      status = CASE WHEN remaining_amount - p_amount <= 0 THEN 'completed' ELSE status END,
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
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount::text = 'NaN' OR p_amount > 1000000000000000 THEN
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

CREATE OR REPLACE FUNCTION public.create_budget_with_allocation(
  p_name text,
  p_amount numeric,
  p_wallet_id uuid,
  p_category_id uuid DEFAULT NULL,
  p_period text DEFAULT 'monthly',
  p_period_start date DEFAULT CURRENT_DATE,
  p_alert_percent integer DEFAULT 80
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_budget_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED:Chưa đăng nhập.'; END IF;
  IF btrim(COALESCE(p_name, '')) = '' OR length(p_name) > 120 THEN RAISE EXCEPTION 'INVALID_NAME:Tên ngân sách không hợp lệ.'; END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories WHERE id = p_category_id AND user_id = v_user_id
  ) THEN RAISE EXCEPTION 'CATEGORY_FORBIDDEN:Danh mục không thuộc tài khoản.'; END IF;
  IF p_period NOT IN ('weekly', 'monthly', 'yearly') OR p_alert_percent NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'INVALID_BUDGET:Chu kỳ hoặc ngưỡng cảnh báo không hợp lệ.';
  END IF;
  INSERT INTO public.budgets(
    user_id, name, amount, allocated_amount, spent_amount, remaining_amount,
    category_id, source_wallet_id, period, period_start, alert_percent, status
  ) VALUES (
    v_user_id, btrim(p_name), 0, 0, 0, 0,
    p_category_id, p_wallet_id, p_period, p_period_start, p_alert_percent, 'active'
  ) RETURNING id INTO v_budget_id;
  PERFORM public.adjust_budget_funds(v_budget_id, p_wallet_id, p_amount, 'allocate');
  RETURN v_budget_id;
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

  IF EXISTS (SELECT 1 FROM public.transactions WHERE budget_id = v_budget.id) THEN
    PERFORM set_config('app.finance_rpc', 'on', true);
    IF v_budget.source_wallet_id IS NOT NULL AND v_budget.remaining_amount > 0 THEN
      UPDATE public.wallets
      SET reserved_amount = GREATEST(0, reserved_amount - v_budget.remaining_amount), updated_at = now()
      WHERE id = v_budget.source_wallet_id AND user_id = v_user_id;
    END IF;
    UPDATE public.budgets
    SET allocated_amount = spent_amount, remaining_amount = 0, amount = spent_amount,
        status = 'cancelled', updated_at = now()
    WHERE id = v_budget.id;
    RETURN 'closed';
  END IF;

  DELETE FROM public.budgets WHERE id = v_budget.id;
  RETURN 'deleted';
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_budget_funds(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adjust_goal_funds(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_budget_with_allocation(text, numeric, uuid, uuid, text, date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_goal_with_allocation(text, numeric, numeric, uuid, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_recurring_transaction(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_budget(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_budget_funds(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_goal_funds(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_budget_with_allocation(text, numeric, uuid, uuid, text, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_goal_with_allocation(text, numeric, numeric, uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_recurring_transaction(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_budget(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_guard_financial_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'AUTH_FORBIDDEN:Không được ghi dữ liệu cho tài khoản khác.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'wallets' AND (
      NEW.balance < 0 OR NEW.balance > 1000000000000000 OR NEW.reserved_amount <> 0
    ) THEN
      RAISE EXCEPTION 'INVALID_WALLET_TOTALS:Số dư ví ban đầu không hợp lệ.';
    ELSIF TG_TABLE_NAME = 'budgets' AND (
      NEW.amount <> 0 OR NEW.allocated_amount <> 0 OR NEW.spent_amount <> 0 OR NEW.remaining_amount <> 0
    ) THEN
      RAISE EXCEPTION 'INVALID_BUDGET_TOTALS:Ngân sách mới phải được cấp vốn qua RPC.';
    ELSIF TG_TABLE_NAME = 'savings_goals' AND (
      NEW.current_amount <> 0 OR NEW.reserved_in_wallet <> 0
    ) THEN
      RAISE EXCEPTION 'INVALID_GOAL_TOTALS:Mục tiêu mới phải được cấp vốn qua RPC.';
    END IF;
    RETURN NEW;
  END IF;
  IF current_setting('app.finance_rpc', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'wallets' AND NEW.reserved_amount IS DISTINCT FROM OLD.reserved_amount THEN
    RAISE EXCEPTION 'RESERVED_AMOUNT_IMMUTABLE:Số tiền giữ chỗ chỉ được thay đổi qua nghiệp vụ tài chính.';
  ELSIF TG_TABLE_NAME = 'budgets' AND (
    NEW.amount IS DISTINCT FROM OLD.amount OR NEW.allocated_amount IS DISTINCT FROM OLD.allocated_amount OR
    NEW.spent_amount IS DISTINCT FROM OLD.spent_amount OR NEW.remaining_amount IS DISTINCT FROM OLD.remaining_amount OR
    NEW.source_wallet_id IS DISTINCT FROM OLD.source_wallet_id
  ) THEN
    RAISE EXCEPTION 'BUDGET_TOTALS_IMMUTABLE:Số dư ngân sách chỉ được thay đổi qua nghiệp vụ tài chính.';
  ELSIF TG_TABLE_NAME = 'savings_goals' AND (
    NEW.current_amount IS DISTINCT FROM OLD.current_amount OR NEW.reserved_in_wallet IS DISTINCT FROM OLD.reserved_in_wallet OR
    NEW.source_wallet_id IS DISTINCT FROM OLD.source_wallet_id
  ) THEN
    RAISE EXCEPTION 'GOAL_TOTALS_IMMUTABLE:Số dư mục tiêu chỉ được thay đổi qua nghiệp vụ tài chính.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_wallet_totals ON public.wallets;
CREATE TRIGGER trg_guard_wallet_totals BEFORE INSERT OR UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_financial_totals();
DROP TRIGGER IF EXISTS trg_guard_budget_totals ON public.budgets;
CREATE TRIGGER trg_guard_budget_totals BEFORE INSERT OR UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_financial_totals();
DROP TRIGGER IF EXISTS trg_guard_goal_totals ON public.savings_goals;
CREATE TRIGGER trg_guard_goal_totals BEFORE INSERT OR UPDATE ON public.savings_goals
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_financial_totals();

CREATE OR REPLACE FUNCTION public.trg_validate_owned_relations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR NEW.user_id <> v_user_id THEN
    RAISE EXCEPTION 'AUTH_FORBIDDEN:Không được ghi dữ liệu cho tài khoản khác.';
  END IF;
  IF TG_TABLE_NAME = 'categories' AND NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories WHERE id = NEW.parent_id AND user_id = v_user_id
  ) THEN RAISE EXCEPTION 'CATEGORY_FORBIDDEN:Danh mục cha không thuộc tài khoản.';
  ELSIF TG_TABLE_NAME = 'budgets' THEN
    IF NEW.category_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.categories WHERE id = NEW.category_id AND user_id = v_user_id
    ) THEN RAISE EXCEPTION 'CATEGORY_FORBIDDEN:Danh mục không thuộc tài khoản.'; END IF;
    IF NEW.source_wallet_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.wallets WHERE id = NEW.source_wallet_id AND user_id = v_user_id
    ) THEN RAISE EXCEPTION 'WALLET_FORBIDDEN:Ví nguồn không thuộc tài khoản.'; END IF;
  ELSIF TG_TABLE_NAME = 'savings_goals' AND NEW.source_wallet_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.wallets WHERE id = NEW.source_wallet_id AND user_id = v_user_id
  ) THEN RAISE EXCEPTION 'WALLET_FORBIDDEN:Ví nguồn không thuộc tài khoản.';
  ELSIF TG_TABLE_NAME = 'recurring_transactions' THEN
    IF NEW.wallet_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.wallets WHERE id = NEW.wallet_id AND user_id = v_user_id
    ) THEN RAISE EXCEPTION 'WALLET_FORBIDDEN:Ví không thuộc tài khoản.'; END IF;
    IF NEW.category_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.categories WHERE id = NEW.category_id AND user_id = v_user_id
    ) THEN RAISE EXCEPTION 'CATEGORY_FORBIDDEN:Danh mục không thuộc tài khoản.'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_category_relations ON public.categories;
CREATE TRIGGER trg_validate_category_relations BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_owned_relations();
DROP TRIGGER IF EXISTS trg_validate_budget_relations ON public.budgets;
CREATE TRIGGER trg_validate_budget_relations BEFORE INSERT OR UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_owned_relations();
DROP TRIGGER IF EXISTS trg_validate_goal_relations ON public.savings_goals;
CREATE TRIGGER trg_validate_goal_relations BEFORE INSERT OR UPDATE ON public.savings_goals
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_owned_relations();
DROP TRIGGER IF EXISTS trg_validate_recurring_relations ON public.recurring_transactions;
CREATE TRIGGER trg_validate_recurring_relations BEFORE INSERT OR UPDATE ON public.recurring_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_owned_relations();

REVOKE INSERT, UPDATE, DELETE ON public.fund_allocations FROM authenticated;
GRANT SELECT ON public.fund_allocations TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_release_reserved_funds()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet_id uuid;
  v_amount numeric;
BEGIN
  IF TG_TABLE_NAME = 'budgets' THEN
    v_wallet_id := OLD.source_wallet_id;
    v_amount := OLD.remaining_amount;
  ELSE
    v_wallet_id := OLD.source_wallet_id;
    v_amount := OLD.reserved_in_wallet;
  END IF;
  IF v_wallet_id IS NOT NULL AND v_amount > 0 THEN
    PERFORM set_config('app.finance_rpc', 'on', true);
    UPDATE public.wallets SET reserved_amount = GREATEST(0, reserved_amount - v_amount), updated_at = now()
    WHERE id = v_wallet_id AND user_id = OLD.user_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_budget_funds ON public.budgets;
CREATE TRIGGER trg_release_budget_funds BEFORE DELETE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.trg_release_reserved_funds();
DROP TRIGGER IF EXISTS trg_release_goal_funds ON public.savings_goals;
CREATE TRIGGER trg_release_goal_funds BEFORE DELETE ON public.savings_goals
  FOR EACH ROW EXECUTE FUNCTION public.trg_release_reserved_funds();

-- Backfill the denormalized reserved amount from authoritative budget/goal rows.
UPDATE public.wallets w SET reserved_amount =
  COALESCE((SELECT SUM(b.remaining_amount) FROM public.budgets b
    WHERE b.user_id = w.user_id AND b.source_wallet_id = w.id AND b.status = 'active' AND b.remaining_amount > 0), 0)
  + COALESCE((SELECT SUM(g.reserved_in_wallet) FROM public.savings_goals g
    WHERE g.user_id = w.user_id AND g.source_wallet_id = w.id AND g.reserved_in_wallet > 0), 0);

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

REVOKE ALL ON FUNCTION public.get_true_wallet_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_true_wallet_balances() TO authenticated;
