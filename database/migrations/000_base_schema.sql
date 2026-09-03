-- Base schema for a new Supabase project.
-- Safe for an existing project: every table is created only when it is absent.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE,
  full_name text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'VND',
  language text NOT NULL DEFAULT 'vi' CHECK (language IN ('vi', 'en')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('cash', 'bank', 'ewallet')),
  balance numeric NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved_amount numeric NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0),
  currency text NOT NULL DEFAULT 'VND',
  color text NOT NULL DEFAULT '#D9F45F',
  icon text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income', 'expense')),
  parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  icon text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#98A1A5',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name, kind)
);

CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  allocated_amount numeric NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  spent_amount numeric NOT NULL DEFAULT 0 CHECK (spent_amount >= 0),
  remaining_amount numeric NOT NULL DEFAULT 0 CHECK (remaining_amount >= 0),
  source_wallet_id uuid REFERENCES public.wallets(id) ON DELETE SET NULL,
  period text NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly', 'monthly', 'yearly')),
  period_start date NOT NULL DEFAULT CURRENT_DATE,
  start_date date,
  end_date date,
  alert_percent integer NOT NULL DEFAULT 80 CHECK (alert_percent BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.savings_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  target_amount numeric NOT NULL CHECK (target_amount > 0),
  current_amount numeric NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  reserved_in_wallet numeric NOT NULL DEFAULT 0 CHECK (reserved_in_wallet >= 0),
  source_wallet_id uuid REFERENCES public.wallets(id) ON DELETE SET NULL,
  deadline date,
  color text NOT NULL DEFAULT '#D9F45F',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recurring_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id uuid REFERENCES public.wallets(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  title text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semi-annually', 'yearly', 'custom')),
  next_run_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  auto_create boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  amount_type text NOT NULL DEFAULT 'fixed' CHECK (amount_type IN ('fixed', 'estimated')),
  estimated_amount numeric,
  processing_mode text NOT NULL DEFAULT 'remind' CHECK (processing_mode IN ('remind', 'confirm', 'auto')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  "interval" integer NOT NULL DEFAULT 1 CHECK ("interval" > 0),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_type text NOT NULL DEFAULT 'never' CHECK (end_type IN ('never', 'date', 'occurrences')),
  end_date date,
  occurrence_limit integer CHECK (occurrence_limit IS NULL OR occurrence_limit > 0),
  reminder_days integer NOT NULL DEFAULT 0 CHECK (reminder_days >= 0),
  month_end_mode text NOT NULL DEFAULT 'last_day' CHECK (month_end_mode IN ('last_day', 'next_month')),
  last_processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  category text NOT NULL DEFAULT 'Khác',
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  wallet_id uuid REFERENCES public.wallets(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL DEFAULT '',
  receipt_path text,
  recurrence_id uuid REFERENCES public.recurring_transactions(id) ON DELETE SET NULL,
  budget_id uuid REFERENCES public.budgets(id) ON DELETE SET NULL,
  goal_id uuid REFERENCES public.savings_goals(id) ON DELETE SET NULL,
  payment_source_type text NOT NULL DEFAULT 'wallet' CHECK (payment_source_type IN ('wallet', 'budget')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  to_wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_wallet_id <> to_wallet_id)
);
