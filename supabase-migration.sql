-- =============================================================
-- SO CHI TIEU -- Supabase Migration
-- Chay script nay trong Supabase Dashboard > SQL Editor
-- =============================================================

-- 1. BAT ROW LEVEL SECURITY (RLS) CHO TAT CA BANG
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS recurring_transactions ENABLE ROW LEVEL SECURITY;

-- 2. RLS POLICIES -- profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can manage own profile') THEN
    CREATE POLICY "Users can manage own profile" ON profiles USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- 3. RLS POLICIES -- wallets
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'wallets' AND policyname = 'Users can manage own wallets') THEN
    CREATE POLICY "Users can manage own wallets" ON wallets USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 4. RLS POLICIES -- categories
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'categories' AND policyname = 'Users can manage own categories') THEN
    CREATE POLICY "Users can manage own categories" ON categories USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 5. RLS POLICIES -- transactions
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users can manage own transactions') THEN
    CREATE POLICY "Users can manage own transactions" ON transactions USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 6. RLS POLICIES -- transfers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transfers' AND policyname = 'Users can manage own transfers') THEN
    CREATE POLICY "Users can manage own transfers" ON transfers USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 7. RLS POLICIES -- budgets
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budgets' AND policyname = 'Users can manage own budgets') THEN
    CREATE POLICY "Users can manage own budgets" ON budgets USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 8. RLS POLICIES -- savings_goals
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'savings_goals' AND policyname = 'Users can manage own savings goals') THEN
    CREATE POLICY "Users can manage own savings goals" ON savings_goals USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 9. RLS POLICIES -- recurring_transactions
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recurring_transactions' AND policyname = 'Users can manage own recurring transactions') THEN
    CREATE POLICY "Users can manage own recurring transactions" ON recurring_transactions USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 10. TAO BANG notifications (MOI)
CREATE TABLE IF NOT EXISTS notifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type         text        NOT NULL CHECK (type IN ('budget_near', 'budget_over', 'goal_complete', 'system')),
  title        text        NOT NULL,
  message      text        NOT NULL,
  reference_id uuid,
  is_read      boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can manage own notifications') THEN
    CREATE POLICY "Users can manage own notifications" ON notifications USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS notifications_user_id_created_at_idx ON notifications (user_id, created_at DESC);

-- 11. INDEX HIEU NANG
CREATE INDEX IF NOT EXISTS transactions_user_id_occurred_at_idx ON transactions (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS transactions_user_id_wallet_id_idx ON transactions (user_id, wallet_id);
CREATE INDEX IF NOT EXISTS transactions_user_id_category_id_idx ON transactions (user_id, category_id);
CREATE INDEX IF NOT EXISTS wallets_user_id_idx ON wallets (user_id);
CREATE INDEX IF NOT EXISTS budgets_user_id_idx ON budgets (user_id);
CREATE INDEX IF NOT EXISTS savings_goals_user_id_idx ON savings_goals (user_id);
CREATE INDEX IF NOT EXISTS transfers_user_id_occurred_at_idx ON transfers (user_id, occurred_at DESC);

-- 12. STORAGE BUCKET receipts
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('receipts', 'receipts', false, 8388608, ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Users manage own receipts') THEN
    CREATE POLICY "Users manage own receipts" ON storage.objects
      FOR ALL USING (bucket_id = 'receipts' AND auth.uid()::text = (storage.foldername(name))[1])
      WITH CHECK (bucket_id = 'receipts' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;

-- KIEM TRA:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
-- SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
