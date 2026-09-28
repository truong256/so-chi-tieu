-- Fix PL/pgSQL record field mismatch on wallets and categories
-- Caused by shared trigger functions referencing fields not present on all tables.

-- 1. Trigger riêng cho wallets
CREATE OR REPLACE FUNCTION public.trg_guard_wallet_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'AUTH_FORBIDDEN:Không được ghi dữ liệu cho tài khoản khác.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.balance < 0 OR NEW.balance > 1000000000000000 OR COALESCE(NEW.reserved_amount, 0) <> 0 THEN
      RAISE EXCEPTION 'INVALID_WALLET_TOTALS:Số dư ví ban đầu không hợp lệ.';
    END IF;
    RETURN NEW;
  END IF;
  IF current_setting('app.finance_rpc', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.reserved_amount IS DISTINCT FROM OLD.reserved_amount THEN
    RAISE EXCEPTION 'RESERVED_AMOUNT_IMMUTABLE:Số tiền giữ chỗ chỉ được thay đổi qua nghiệp vụ tài chính.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_wallet_totals ON public.wallets;
CREATE TRIGGER trg_guard_wallet_totals BEFORE INSERT OR UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_wallet_totals();

-- 2. Trigger riêng cho categories
CREATE OR REPLACE FUNCTION public.trg_validate_category_relations()
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
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories WHERE id = NEW.parent_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'CATEGORY_FORBIDDEN:Danh mục cha không thuộc tài khoản.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_category_relations ON public.categories;
CREATE TRIGGER trg_validate_category_relations BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_category_relations();
