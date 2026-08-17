-- =============================================================
-- SO CHI TIEU -- Migration: Tính tổng số dư thực tế
-- Chạy script này trong Supabase Dashboard > SQL Editor
-- =============================================================

CREATE OR REPLACE FUNCTION get_true_wallet_balances()
RETURNS TABLE (
  wallet_id uuid,
  true_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    w.id AS wallet_id,
    w.balance + 
    COALESCE((SELECT SUM(amount) FROM transactions WHERE wallet_id = w.id AND type = 'income'), 0) -
    COALESCE((SELECT SUM(t.amount) FROM transactions t 
              LEFT JOIN budgets b ON t.budget_id = b.id
              WHERE (t.wallet_id = w.id OR (t.payment_source_type = 'budget' AND b.source_wallet_id = w.id))
              AND t.type = 'expense'), 0) +
    COALESCE((SELECT SUM(amount) FROM transfers WHERE to_wallet_id = w.id), 0) -
    COALESCE((SELECT SUM(amount) FROM transfers WHERE from_wallet_id = w.id), 0) AS true_balance
  FROM wallets w
  WHERE w.user_id = auth.uid();
END;
$$;
