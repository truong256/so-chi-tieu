-- Query indexes matching the authenticated dashboard access patterns.
-- Apply manually after 006_finance_integrity_and_security.sql.
-- This migration changes no data and is safe to re-run.

CREATE INDEX IF NOT EXISTS wallets_user_id_created_at_idx
  ON public.wallets (user_id, created_at);

CREATE INDEX IF NOT EXISTS categories_user_id_kind_name_idx
  ON public.categories (user_id, kind, name);

CREATE INDEX IF NOT EXISTS budgets_user_id_created_at_idx
  ON public.budgets (user_id, created_at);

CREATE INDEX IF NOT EXISTS savings_goals_user_id_deadline_idx
  ON public.savings_goals (user_id, deadline);

CREATE INDEX IF NOT EXISTS recurring_transactions_user_id_next_run_at_idx
  ON public.recurring_transactions (user_id, next_run_at);
