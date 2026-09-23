-- Migration 009: Admin Audit Trail and AI Telemetry Logging
-- Provides observable system metrics and administrative accountability without logging sensitive user data.

CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  feature text NOT NULL,
  model text NOT NULL,
  success boolean NOT NULL DEFAULT true,
  latency_ms integer NOT NULL DEFAULT 0,
  error_code text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_logs_created_at_idx
  ON public.ai_usage_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_logs_feature_created_at_idx
  ON public.ai_usage_logs (feature, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_logs_user_id_idx
  ON public.ai_usage_logs (user_id);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_logs_admin_select ON public.ai_usage_logs;
CREATE POLICY ai_usage_logs_admin_select ON public.ai_usage_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Immutable Admin Audit Logs
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_at_idx
  ON public.admin_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_action_created_at_idx
  ON public.admin_audit_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_admin_id_idx
  ON public.admin_audit_logs (admin_id);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_audit_logs_admin_select ON public.admin_audit_logs;
CREATE POLICY admin_audit_logs_admin_select ON public.admin_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Function to record audit logs securely
CREATE OR REPLACE FUNCTION public.record_admin_audit(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_log_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'AUTH_FORBIDDEN:Chỉ quản trị viên mới có quyền ghi nhật ký kiểm toán.';
  END IF;

  INSERT INTO public.admin_audit_logs (
    admin_id,
    action,
    target_type,
    target_id,
    metadata
  ) VALUES (
    v_admin_id,
    p_action,
    p_target_type,
    p_target_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_admin_audit(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_admin_audit(text, text, text, jsonb) TO authenticated;
