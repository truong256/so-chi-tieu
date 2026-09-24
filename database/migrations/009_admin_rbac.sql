-- Migration 009: Admin RBAC Schema and Anti Self-Promotion Security
-- Enforces server-verified roles (user, admin) with database-level RLS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.app_role AS ENUM ('user', 'admin');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user'::public.app_role,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_user_id_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS user_roles_user_id_role_idx
  ON public.user_roles (user_id, role);

-- Enable Row Level Security
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Drop obsolete policies if any exist
DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
DROP POLICY IF EXISTS user_roles_insert_prohibited ON public.user_roles;
DROP POLICY IF EXISTS user_roles_update_prohibited ON public.user_roles;
DROP POLICY IF EXISTS user_roles_delete_prohibited ON public.user_roles;

-- Authenticated users can ONLY view their own assigned role.
CREATE POLICY user_roles_select_own ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Anti Self-Promotion: NO INSERT, UPDATE, or DELETE policies exist for authenticated or anon users.
-- Only database superuser, service_role, or administrative functions can modify roles.

-- Security definer helper to check role
CREATE OR REPLACE FUNCTION public.has_role(
  p_user_id uuid,
  p_role public.app_role
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = p_role
  );
$$;

-- Helper to check if current caller is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.has_role(auth.uid(), 'admin'::public.app_role);
$$;

-- Helper to retrieve caller's role with safe fallback to 'user'
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT role::text INTO v_role
  FROM public.user_roles
  WHERE user_id = auth.uid();

  RETURN COALESCE(v_role, 'user');
END;
$$;

-- Protect RPCs from anonymous access
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

-- Update auth trigger to automatically provision 'user' role for every new account
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles(id, username, full_name, currency, language)
  VALUES (
    NEW.id,
    NULLIF(left(lower(btrim(COALESCE(NEW.raw_user_meta_data->>'username', ''))), 24), ''),
    left(COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1), 'Bạn'), 120),
    'VND',
    'vi'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Default provision: strictly 'user'. Never admin.
  INSERT INTO public.user_roles(user_id, role)
  VALUES (NEW.id, 'user'::public.app_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Backfill existing profiles with default 'user' role if missing
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'user'::public.app_role
FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;
