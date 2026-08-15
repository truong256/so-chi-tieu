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

-- 2. HÀM RPC: LẤY EMAIL BẰNG USERNAME (Hỗ trợ đăng nhập linh hoạt)
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email TEXT;
  v_clean_username TEXT;
BEGIN
  v_clean_username := LOWER(TRIM(p_username));
  
  -- Tìm trong bảng auth.users metadata hoặc email
  SELECT email INTO v_email
  FROM auth.users
  WHERE LOWER(raw_user_meta_data->>'username') = v_clean_username
     OR LOWER(email) = v_clean_username
  LIMIT 1;

  -- Nếu chưa có trong metadata, tìm trong bảng profiles
  IF v_email IS NULL THEN
    SELECT u.email INTO v_email
    FROM auth.users u
    INNER JOIN public.profiles p ON p.id = u.id
    WHERE LOWER(p.username) = v_clean_username
    LIMIT 1;
  END IF;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_by_username(TEXT) TO anon, authenticated;

-- 3. TRIGGER TỰ ĐỘNG TẠO PROFILE & DỮ LIỆU BAN ĐẦU KHI CÓ USER MỚI
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_full_name TEXT;
  v_username  TEXT;
  v_wallet_id UUID;
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

  -- 2. Tạo ví mặc định "Tiền mặt" nếu chưa có ví nào
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = NEW.id) THEN
    INSERT INTO public.wallets (user_id, name, type, balance, reserved_amount, currency, color, icon)
    VALUES (NEW.id, 'Tiền mặt', 'cash', 0, 0, 'VND', '#D9F45F', '💵')
    RETURNING id INTO v_wallet_id;
  END IF;

  -- 3. Tạo danh mục thu/chi mặc định nếu chưa có
  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE user_id = NEW.id) THEN
    INSERT INTO public.categories (user_id, name, kind, icon, color, is_default) VALUES
      (NEW.id, 'Ăn uống', 'expense', '🍜', '#FF9466', true),
      (NEW.id, 'Di chuyển', 'expense', '🛵', '#7C8CFF', true),
      (NEW.id, 'Nhà ở', 'expense', '🏠', '#E5CB54', true),
      (NEW.id, 'Mua sắm', 'expense', '🛍️', '#FF7898', true),
      (NEW.id, 'Giải trí', 'expense', '🎬', '#A47BE8', true),
      (NEW.id, 'Sức khỏe', 'expense', '🩺', '#58B999', true),
      (NEW.id, 'Giáo dục', 'expense', '📚', '#4B9BE8', true),
      (NEW.id, 'Lương', 'income', '💼', '#78B732', true),
      (NEW.id, 'Thưởng', 'income', '🎁', '#8CBF42', true),
      (NEW.id, 'Trợ cấp', 'income', '🤝', '#56B4D3', true),
      (NEW.id, 'Thu khác', 'income', '✨', '#69A9D8', true);
  END IF;

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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;

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

-- 5. TRIGGER TỰ ĐỘNG XÁC THỰC EMAIL (AUTO-CONFIRM) CHO MỌI USER MỚI
-- Giúp người dùng đăng ký là dùng được ngay lập tức, không bị nghẽn bởi rate limit gửi email của Supabase Cloud
CREATE OR REPLACE FUNCTION public.auto_confirm_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN
    NEW.email_confirmed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_auto_confirm_new_user ON auth.users;
CREATE TRIGGER tr_auto_confirm_new_user
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_confirm_new_user();

-- Kích hoạt xác thực cho toàn bộ các user hiện có trong DB đang bị unconfirmed
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email_confirmed_at IS NULL;

-- ============================================================================
-- HƯỚNG DẪN XỬ LÝ LỖI "CHỐNG SPAM / RATE LIMIT" KHI ĐĂNG KÝ TRÊN PRODUCTION:
-- ============================================================================
-- Nguyên nhân: Supabase Cloud giới hạn gửi tối đa 3-4 email/giờ trên gói Free.
-- Cách khắc phục triệt để:
-- 1. Vào Supabase Dashboard > Authentication > Providers > Email
-- 2. BỎ CHỌN (TẮT) mục "Confirm email" (Xác thực email).
-- 3. BỎ CHỌN mục "Secure email change".
-- 4. Bấm nút "Save" ở cuối trang.
--
-- Sau khi tắt "Confirm email", bất kỳ ai cũng có thể tạo tài khoản và đăng nhập
-- ngay lập tức mà không bao giờ bị giới hạn spam rate limit nữa!
-- ============================================================================
