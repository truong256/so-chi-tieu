-- =============================================================
-- SO CHI TIEU -- Migration Kiểm Tra Số Dư Khả Dụng & Trigger Chống Số Dư Âm
-- Chạy script này trong Supabase Dashboard > SQL Editor
-- =============================================================

-- ─── 1. FUNCTION KIỂM TRA SỐ DƯ KHẢ DỤNG ────────────────────
CREATE OR REPLACE FUNCTION check_wallet_available_balance(
  p_wallet_id UUID,
  p_expense_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_wallet RECORD;
  v_initial_balance NUMERIC;
  v_reserved_amount NUMERIC;
  v_total_income NUMERIC;
  v_total_expense NUMERIC;
  v_transfers_in NUMERIC;
  v_transfers_out NUMERIC;
  v_current_balance NUMERIC;
  v_available_balance NUMERIC;
  v_missing NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;

  -- Select wallet
  SELECT id, name, user_id, balance, reserved_amount
  INTO v_wallet
  FROM wallets
  WHERE id = p_wallet_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ví không tồn tại hoặc không thuộc quyền sở hữu của bạn.';
  END IF;

  v_initial_balance := COALESCE(v_wallet.balance, 0);

  -- Tính tổng thu nhập vào ví này
  SELECT COALESCE(SUM(amount), 0) INTO v_total_income
  FROM transactions
  WHERE wallet_id = p_wallet_id AND user_id = v_user_id AND type = 'income';

  -- Tính tổng khoản chi từ ví này
  SELECT COALESCE(SUM(amount), 0) INTO v_total_expense
  FROM transactions
  WHERE wallet_id = p_wallet_id AND user_id = v_user_id AND type = 'expense';

  -- Tổng nhận từ điều chuyển
  SELECT COALESCE(SUM(amount), 0) INTO v_transfers_in
  FROM transfers
  WHERE to_wallet_id = p_wallet_id AND user_id = v_user_id;

  -- Tổng chuyển đi từ điều chuyển
  SELECT COALESCE(SUM(amount), 0) INTO v_transfers_out
  FROM transfers
  WHERE from_wallet_id = p_wallet_id AND user_id = v_user_id;

  -- Tổng tiền đang bị giữ chỗ cho ngân sách hoạt động
  SELECT COALESCE(SUM(remaining_amount), 0) INTO v_reserved_amount
  FROM budgets
  WHERE source_wallet_id = p_wallet_id AND user_id = v_user_id AND status = 'active' AND remaining_amount > 0;

  -- Cộng thêm tiền đang bị giữ chỗ cho mục tiêu tiết kiệm
  v_reserved_amount := v_reserved_amount + COALESCE((
    SELECT SUM(reserved_in_wallet)
    FROM savings_goals
    WHERE source_wallet_id = p_wallet_id AND user_id = v_user_id AND reserved_in_wallet > 0
  ), 0);

  v_current_balance := v_initial_balance + v_total_income - v_total_expense + v_transfers_in - v_transfers_out;
  v_available_balance := v_current_balance - v_reserved_amount;

  IF p_expense_amount > v_available_balance THEN
    v_missing := p_expense_amount - v_available_balance;
    RETURN jsonb_build_object(
      'allowed', false,
      'wallet_name', v_wallet.name,
      'available_balance', v_available_balance,
      'missing_amount', v_missing
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'wallet_name', v_wallet.name,
    'available_balance', v_available_balance,
    'missing_amount', 0
  );
END;
$$;

-- ─── 2. TRIGGER TỰ ĐỘNG CHẶN KHOẢN CHI KHI THIẾU SỐ DƯ (DATABASE LEVEL) ─
CREATE OR REPLACE FUNCTION trg_check_expense_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_available NUMERIC;
  v_wallet_name TEXT;
  v_initial_balance NUMERIC;
  v_total_income NUMERIC;
  v_total_expense NUMERIC;
  v_transfers_in NUMERIC;
  v_transfers_out NUMERIC;
  v_reserved NUMERIC;
  v_current_balance NUMERIC;
BEGIN
  -- Chỉ kiểm tra khi là khoản chi có gắn ví
  IF NEW.type = 'expense' AND NEW.wallet_id IS NOT NULL THEN
    SELECT name, balance INTO v_wallet_name, v_initial_balance
    FROM wallets WHERE id = NEW.wallet_id;

    IF v_wallet_name IS NOT NULL THEN
      v_initial_balance := COALESCE(v_initial_balance, 0);

      -- Tổng thu nhập
      SELECT COALESCE(SUM(amount), 0) INTO v_total_income
      FROM transactions
      WHERE wallet_id = NEW.wallet_id AND type = 'income' AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

      -- Tổng chi tiêu (trừ giao dịch đang sửa nếu có)
      SELECT COALESCE(SUM(amount), 0) INTO v_total_expense
      FROM transactions
      WHERE wallet_id = NEW.wallet_id AND type = 'expense' AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

      -- Điều chuyển
      SELECT COALESCE(SUM(amount), 0) INTO v_transfers_in
      FROM transfers WHERE to_wallet_id = NEW.wallet_id;

      SELECT COALESCE(SUM(amount), 0) INTO v_transfers_out
      FROM transfers WHERE from_wallet_id = NEW.wallet_id;

      -- Giữ chỗ ngân sách
      SELECT COALESCE(SUM(remaining_amount), 0) INTO v_reserved
      FROM budgets WHERE source_wallet_id = NEW.wallet_id AND status = 'active' AND remaining_amount > 0;

      -- Giữ chỗ mục tiêu
      v_reserved := v_reserved + COALESCE((
        SELECT SUM(reserved_in_wallet)
        FROM savings_goals WHERE source_wallet_id = NEW.wallet_id AND reserved_in_wallet > 0
      ), 0);

      v_current_balance := v_initial_balance + v_total_income - v_total_expense + v_transfers_in - v_transfers_out;
      v_available := v_current_balance - v_reserved;

      IF NEW.amount > v_available THEN
        RAISE EXCEPTION 'INSUFFICIENT_BALANCE:Ví "%" hiện chỉ có %, thiếu %.',
          v_wallet_name, v_available, (NEW.amount - v_available);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_insufficient_expense ON transactions;
CREATE TRIGGER trg_prevent_insufficient_expense
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION trg_check_expense_balance();

-- ─── 3. FUNCTION TẠO KHOẢN CHI AN TOÀN (ATOMIC RPC) ────────────
CREATE OR REPLACE FUNCTION create_expense_transaction(
  p_title TEXT,
  p_amount NUMERIC,
  p_category TEXT,
  p_category_id UUID,
  p_wallet_id UUID,
  p_occurred_at TIMESTAMPTZ,
  p_note TEXT DEFAULT '',
  p_receipt_path TEXT DEFAULT NULL,
  p_budget_id UUID DEFAULT NULL,
  p_payment_source_type TEXT DEFAULT 'wallet'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_check JSONB;
  v_tx_id UUID;
BEGIN
  IF p_payment_source_type = 'wallet' AND p_wallet_id IS NOT NULL THEN
    v_check := check_wallet_available_balance(p_wallet_id, p_amount);
    IF NOT (v_check->>'allowed')::boolean THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE:Ví "%" hiện chỉ có %, thiếu %.',
        v_check->>'wallet_name',
        v_check->>'available_balance',
        v_check->>'missing_amount';
    END IF;
  END IF;

  INSERT INTO transactions (
    user_id, title, amount, type, category, category_id,
    wallet_id, occurred_at, note, receipt_path, budget_id, payment_source_type
  ) VALUES (
    auth.uid(), p_title, p_amount, 'expense', p_category, p_category_id,
    p_wallet_id, p_occurred_at, p_note, p_receipt_path, p_budget_id, p_payment_source_type
  ) RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object('success', true, 'id', v_tx_id);
END;
$$;
