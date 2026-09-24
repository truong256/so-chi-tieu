-- Migration 011: Admin System Settings Configuration
-- Configures dynamic feature flags and operational switches without exposing system secrets.

CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_settings_read ON public.system_settings;
CREATE POLICY system_settings_read ON public.system_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS system_settings_admin_modify ON public.system_settings;
CREATE POLICY system_settings_admin_modify ON public.system_settings
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Seed default flags idempotently
INSERT INTO public.system_settings (key, value, description)
VALUES
  ('ai_enabled', 'true'::jsonb, 'Bật/tắt tính năng Trợ lý AI và phân tích thông minh'),
  ('receipt_scan_enabled', 'true'::jsonb, 'Bật/tắt tính năng quét và trích xuất hóa đơn tự động'),
  ('maintenance_mode', 'false'::jsonb, 'Chế độ bảo trì hệ thống')
ON CONFLICT (key) DO NOTHING;

-- Prevent storing secret keys in system_settings
CREATE OR REPLACE FUNCTION public.trg_protect_system_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(NEW.key) LIKE '%key%' OR lower(NEW.key) LIKE '%secret%' OR lower(NEW.key) LIKE '%token%' OR lower(NEW.key) LIKE '%password%' THEN
    RAISE EXCEPTION 'FORBIDDEN_KEY:Không được lưu trữ khóa bảo mật hoặc secret vào bảng cấu hình hệ thống.';
  END IF;

  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_settings ON public.system_settings;
CREATE TRIGGER trg_protect_system_settings
  BEFORE INSERT OR UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.trg_protect_system_settings();
