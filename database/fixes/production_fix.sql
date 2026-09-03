-- ============================================================================
-- SỔ CHI TIÊU -- SUPABASE PRODUCTION REPAIR & MIGRATION SCRIPT
-- ============================================================================
-- Chạy toàn bộ script này trong:
--   Supabase Dashboard > SQL Editor > New Query > Bấm "Run"
-- ============================================================================

-- 1. BẢNG PROFILES (Đảm bảo có đủ cột username, full_name, currency, language)
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT UNIQUE,
  full_name   TEXT NOT NULL DEFAULT '',
  currency    TEXT NOT NULL DEFAULT 'VND',
  language    TEXT NOT NULL DEFAULT 'vi',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'VND';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'vi';

-- 2. Không cung cấp lookup username -> email: RPC này cho phép dò tài khoản.
DO $$
BEGIN
  IF to_regprocedure('public.get_email_by_username(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_email_by_username(text) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- 3. TRIGGER TỰ ĐỘNG TẠO PROFILE & DỮ LIỆU BAN ĐẦU KHI CÓ USER MỚI
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name TEXT;
  v_username  TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1), 'Bạn');
  v_username  := NULLIF(TRIM(LOWER(COALESCE(NEW.raw_user_meta_data->>'username', ''))), '');

  -- 1. Tạo hoặc cập nhật Profile
  INSERT INTO public.profiles (id, username, full_name, currency, language)
  VALUES (NEW.id, v_username, v_full_name, 'VND', 'vi')
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      username  = COALESCE(profiles.username, EXCLUDED.username),
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 4. BẬT ROW LEVEL SECURITY & CẤP QUYỀN TRUY CẬP CHO MỌI BẢNG
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.recurring_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.fund_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

-- Cấp quyền bảng cho role authenticated
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can manage own profile') THEN
    CREATE POLICY "Users can manage own profile" ON public.profiles USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'wallets' AND policyname = 'Users can manage own wallets') THEN
    CREATE POLICY "Users can manage own wallets" ON public.wallets USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'categories' AND policyname = 'Users can manage own categories') THEN
    CREATE POLICY "Users can manage own categories" ON public.categories USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users can manage own transactions') THEN
    CREATE POLICY "Users can manage own transactions" ON public.transactions USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transfers' AND policyname = 'Users can manage own transfers') THEN
    CREATE POLICY "Users can manage own transfers" ON public.transfers USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budgets' AND policyname = 'Users can manage own budgets') THEN
    CREATE POLICY "Users can manage own budgets" ON public.budgets USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'savings_goals' AND policyname = 'Users can manage own savings goals') THEN
    CREATE POLICY "Users can manage own savings goals" ON public.savings_goals USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recurring_transactions' AND policyname = 'Users can manage own recurring transactions') THEN
    CREATE POLICY "Users can manage own recurring transactions" ON public.recurring_transactions USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 5. Giữ nguyên quy trình xác minh email của Supabase; không tự xác nhận trong DB.
DROP TRIGGER IF EXISTS tr_auto_confirm_new_user ON auth.users;
DROP FUNCTION IF EXISTS public.auto_confirm_new_user();

-- Nếu chạm rate limit email, cấu hình SMTP riêng trong Supabase thay vì tắt xác minh.
