-- =============================================================
-- SO CHI TIEU -- Reserved Money Migration
-- Chay script nay trong Supabase Dashboard > SQL Editor
-- =============================================================

-- ─── 1. WALLET: Them reserved_amount ─────────────────────────
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS reserved_amount NUMERIC NOT NULL DEFAULT 0
    CHECK (reserved_amount >= 0);

-- ─── 2. BUDGETS: Them cac cot phan bo tien ────────────────────
ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS allocated_amount    NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spent_amount        NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount    NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_wallet_id    UUID REFERENCES wallets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','completed','cancelled')),
  ADD COLUMN IF NOT EXISTS start_date          DATE,
  ADD COLUMN IF NOT EXISTS end_date            DATE;

-- Dong bo du lieu cu: budget cu khong co phan bo tien thi remaining = amount
UPDATE budgets
SET
  allocated_amount = amount,
  remaining_amount = amount
WHERE allocated_amount = 0 AND amount > 0;

-- ─── 3. SAVINGS_GOALS: Them source va reserved ────────────────
ALTER TABLE savings_goals
  ADD COLUMN IF NOT EXISTS source_wallet_id    UUID REFERENCES wallets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reserved_in_wallet  NUMERIC NOT NULL DEFAULT 0;

-- Dong bo du lieu cu: goals cu co current_amount > 0 → dat reserved_in_wallet = current_amount
UPDATE savings_goals
SET reserved_in_wallet = current_amount
WHERE reserved_in_wallet = 0 AND current_amount > 0;

-- ─── 4. TRANSACTIONS: Them budget_id, payment_source_type ─────
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS budget_id             UUID REFERENCES budgets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS goal_id               UUID REFERENCES savings_goals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_source_type   TEXT NOT NULL DEFAULT 'wallet'
    CHECK (payment_source_type IN ('wallet','budget'));

-- ─── 5. BANG FUND_ALLOCATIONS (Lich su phan bo noi bo) ────────
CREATE TABLE IF NOT EXISTS fund_allocations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL CHECK (type IN (
                'wallet_to_budget',
                'budget_to_wallet',
                'wallet_to_goal',
                'goal_to_wallet'
              )),
  wallet_id   UUID        REFERENCES wallets(id) ON DELETE SET NULL,
  budget_id   UUID        REFERENCES budgets(id) ON DELETE SET NULL,
  goal_id     UUID        REFERENCES savings_goals(id) ON DELETE SET NULL,
  amount      NUMERIC     NOT NULL CHECK (amount > 0),
  note        TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fund_allocations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'fund_allocations'
    AND policyname = 'Users can manage own fund allocations'
  ) THEN
    CREATE POLICY "Users can manage own fund allocations"
      ON fund_allocations
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fund_allocations_user_id_created_at_idx
  ON fund_allocations (user_id, created_at DESC);

-- ─── 6. INDEX bo sung ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS transactions_budget_id_idx
  ON transactions (budget_id) WHERE budget_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS budgets_source_wallet_id_idx
  ON budgets (source_wallet_id) WHERE source_wallet_id IS NOT NULL;
