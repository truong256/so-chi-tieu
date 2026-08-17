-- =============================================================
-- SO CHI TIEU -- Migration: Nâng cấp Giao dịch định kỳ (v2)
-- Chạy script này trong Supabase Dashboard > SQL Editor
-- =============================================================

-- 1. Nâng cấp bảng recurring_transactions hiện tại
ALTER TABLE recurring_transactions
  ADD COLUMN IF NOT EXISTS amount_type text DEFAULT 'fixed' CHECK (amount_type IN ('fixed', 'estimated')),
  ADD COLUMN IF NOT EXISTS estimated_amount numeric,
  ADD COLUMN IF NOT EXISTS processing_mode text DEFAULT 'remind' CHECK (processing_mode IN ('remind', 'confirm', 'auto')),
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS "interval" integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS start_date date DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS end_type text DEFAULT 'never' CHECK (end_type IN ('never', 'date', 'occurrences')),
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS occurrence_limit integer,
  ADD COLUMN IF NOT EXISTS reminder_days integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS month_end_mode text DEFAULT 'last_day' CHECK (month_end_mode IN ('last_day', 'next_month')),
  ADD COLUMN IF NOT EXISTS last_processed_at timestamptz;

-- Migration dữ liệu cũ: chuyển đổi active -> status, auto_create -> processing_mode
UPDATE recurring_transactions
SET status = CASE WHEN active = true THEN 'active' ELSE 'paused' END,
    processing_mode = CASE WHEN auto_create = true THEN 'auto' ELSE 'remind' END;

-- 2. Tạo bảng recurring_occurrences để theo dõi từng kỳ và chống lặp
CREATE TABLE IF NOT EXISTS recurring_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recurring_transaction_id uuid NOT NULL REFERENCES recurring_transactions(id) ON DELETE CASCADE,
  scheduled_for date NOT NULL,
  amount numeric NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'skipped', 'failed', 'postponed')),
  transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(recurring_transaction_id, scheduled_for)
);

-- 3. Cập nhật RLS cho recurring_occurrences
ALTER TABLE recurring_occurrences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recurring_occurrences' AND policyname = 'Users can manage own recurring occurrences') THEN
    CREATE POLICY "Users can manage own recurring occurrences" ON recurring_occurrences USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 4. Thêm Index
CREATE INDEX IF NOT EXISTS recurring_occurrences_user_id_idx ON recurring_occurrences (user_id);
CREATE INDEX IF NOT EXISTS recurring_occurrences_recurring_transaction_id_idx ON recurring_occurrences (recurring_transaction_id);
CREATE INDEX IF NOT EXISTS recurring_occurrences_scheduled_for_idx ON recurring_occurrences (scheduled_for);
