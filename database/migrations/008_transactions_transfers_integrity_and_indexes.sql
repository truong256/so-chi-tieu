-- Integrity and index enhancements for transactions and transfers.
-- Apply manually after 007_query_performance_indexes.sql.
-- This migration protects wallet balances against negative drift upon deletion and speeds up queries.

-- 1. Prevent deleting income transactions if it causes negative wallet available balance
CREATE OR REPLACE FUNCTION public.trg_validate_transaction_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_check jsonb;
  v_available numeric;
BEGIN
  IF v_user_id IS NULL OR OLD.user_id <> v_user_id THEN
    RAISE EXCEPTION 'AUTH_FORBIDDEN:Không được xóa giao dịch của tài khoản khác.';
  END IF;

  IF OLD.type = 'income' AND OLD.wallet_id IS NOT NULL THEN
    v_check := public.check_wallet_available_balance(OLD.wallet_id, OLD.amount);
    v_available := (v_check->>'available_balance')::numeric;
    IF OLD.amount > v_available THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE:Không thể xóa khoản thu vì số dư khả dụng của ví hiện tại không đủ bù đắp.';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_transaction_delete ON public.transactions;
CREATE TRIGGER trg_validate_transaction_delete
  BEFORE DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_transaction_delete();

-- 2. Prevent deleting transfers if destination wallet has already spent the transferred funds
CREATE OR REPLACE FUNCTION public.trg_validate_transfer_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_check jsonb;
  v_available numeric;
BEGIN
  IF v_user_id IS NULL OR OLD.user_id <> v_user_id THEN
    RAISE EXCEPTION 'AUTH_FORBIDDEN:Không được xóa chuyển tiền của tài khoản khác.';
  END IF;

  -- Deleting a transfer subtracts OLD.amount from OLD.to_wallet_id.
  -- Verify OLD.to_wallet_id currently has at least OLD.amount available.
  v_check := public.check_wallet_available_balance(OLD.to_wallet_id, OLD.amount);
  v_available := (v_check->>'available_balance')::numeric;
  IF OLD.amount > v_available THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE:Không thể xóa chuyển tiền vì ví nhận đã chi tiêu số tiền này.';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_transfer_delete ON public.transfers;
CREATE TRIGGER trg_validate_transfer_delete
  BEFORE DELETE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_transfer_delete();

-- 3. Query indexes for transactions and transfers
CREATE INDEX IF NOT EXISTS transactions_user_id_occurred_at_idx
  ON public.transactions (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS transactions_user_id_wallet_id_idx
  ON public.transactions (user_id, wallet_id);

CREATE INDEX IF NOT EXISTS transfers_user_id_occurred_at_idx
  ON public.transfers (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS transfers_user_id_from_to_idx
  ON public.transfers (user_id, from_wallet_id, to_wallet_id);
